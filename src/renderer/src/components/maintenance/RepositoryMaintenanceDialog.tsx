import type { FormEvent, ReactElement, ReactNode } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  GitBranch,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  Trash2,
  X
} from 'lucide-react';

import { ModalSurface } from '@renderer/components/accessibility/ModalSurface';
import type {
  BranchCleanupCandidate,
  BranchCleanupEvidence,
  BranchCleanupInput,
  BranchCleanupPlan,
  BranchCleanupResult
} from '@shared/maintenance';
import type { GitOperationResult, GitRepositoryOverview } from '@shared/types';

import {
  addWithinLimit,
  buildRestoreCommand,
  formatAge,
  isAnalyzed,
  MAX_AGE_DAYS,
  MAX_CLEANUP_BRANCHES,
  parseAgeDays,
  shortRefName
} from './branchCleanupPresentation';

export type RepositoryMaintenanceRunOperation = (
  label: string,
  action: (repoPath: string) => Promise<GitOperationResult>
) => Promise<boolean>;

export type RepositoryMaintenanceDialogProps = {
  /** Repository captured when the dialog opened. All requests target this path. */
  repoPath: string;
  repoName?: string;
  /** Refs for `repoPath`; omit when the overview belongs to another repository. */
  refs?: GitRepositoryOverview['refs'];
  /** Another operation is running for this repository. */
  isRepositoryBusy: boolean;
  /** Runs a mutation through the shared repository operation queue. */
  runOperation: RepositoryMaintenanceRunOperation;
  onClose: () => void;
};

type Scope = BranchCleanupCandidate['scope'];
type Step = 'scan' | 'review' | 'result';
type EvidenceFilter = 'all' | 'merged' | 'likely' | 'unmerged';

type ScanState =
  | { status: 'idle' }
  | { status: 'loading'; previous?: BranchCleanupPlan }
  | { status: 'success'; plan: BranchCleanupPlan }
  | { status: 'error'; message: string; previous?: BranchCleanupPlan };

type CleanupState =
  | { status: 'idle' }
  | { status: 'running'; refs: string[] }
  | { status: 'done'; result: BranchCleanupResult; candidates: Map<string, BranchCleanupCandidate> }
  | { status: 'error'; message: string };

const DEFAULT_AGE_DAYS = 30;
const AUTOMATIC_BASE = '';

const EVIDENCE_LABELS: Record<BranchCleanupEvidence, string> = {
  merged: 'Merged',
  'patch-equivalent': 'Equivalent patches',
  'content-integrated': 'Content in base',
  unmerged: 'Not merged',
  unknown: 'Unknown'
};

const EVIDENCE_HINTS: Record<BranchCleanupEvidence, string> = {
  merged: 'Every commit on this branch is already part of the comparison branch.',
  'patch-equivalent':
    'Each commit has an equivalent patch in the comparison branch, as after a rebase or cherry-pick. Whitespace is ignored and reverted changes can still match, so this is limited evidence.',
  'content-integrated': 'Merging would not change the comparison branch, as after a squash merge. Likely integrated, not proven.',
  unmerged: 'The branch may contain changes that are not in the comparison branch. Review it before deleting.',
  unknown: 'Git could not determine whether this branch is integrated.'
};

export function RepositoryMaintenanceDialog({
  repoPath,
  repoName,
  refs,
  isRepositoryBusy,
  runOperation,
  onClose
}: RepositoryMaintenanceDialogProps): ReactElement {
  const titleId = useId();
  const descriptionId = useId();
  const ageInputId = useId();
  const baseInputId = useId();
  const acknowledgeId = useId();
  const scanRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [lastKnownRefs, setLastKnownRefs] = useState(refs);
  const [baseRef, setBaseRef] = useState(AUTOMATIC_BASE);
  const [ageText, setAgeText] = useState(String(DEFAULT_AGE_DAYS));
  const [scope, setScope] = useState<Scope>('local');
  const [evidenceFilter, setEvidenceFilter] = useState<EvidenceFilter>('all');
  const [includeUnverified, setIncludeUnverified] = useState(false);
  const [showIneligible, setShowIneligible] = useState(false);
  const [scan, setScan] = useState<ScanState>({ status: 'idle' });
  const [scannedCriteria, setScannedCriteria] = useState<{ baseRef: string; olderThanDays: number }>();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [step, setStep] = useState<Step>('scan');
  const [acknowledged, setAcknowledged] = useState(false);
  const [cleanup, setCleanup] = useState<CleanupState>({ status: 'idle' });
  const [isRefreshingRemotes, setIsRefreshingRemotes] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'error' | 'info'; message: string }>();
  const [limitNotice, setLimitNotice] = useState<string>();

  useEffect(() => {
    if (refs) {
      setLastKnownRefs(refs);
    }
  }, [refs]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const ageDays = parseAgeDays(ageText);
  const isMutating = cleanup.status === 'running' || isRefreshingRemotes;
  const plan = scan.status === 'success' ? scan.plan : scan.status !== 'idle' ? scan.previous : undefined;
  const isScanning = scan.status === 'loading';
  const criteriaChanged = Boolean(
    plan && scannedCriteria && (scannedCriteria.baseRef !== baseRef || scannedCriteria.olderThanDays !== ageDays)
  );
  const canInteractWithPlan = scan.status === 'success' && !criteriaChanged && !isMutating;

  const baseOptions = useMemo(() => buildBaseOptions(lastKnownRefs, baseRef, plan?.baseRef), [lastKnownRefs, baseRef, plan?.baseRef]);
  const candidatesByRef = useMemo(
    () => new Map((plan?.branches ?? []).map((candidate) => [candidate.ref, candidate])),
    [plan]
  );

  function isEligible(candidate: BranchCleanupCandidate): boolean {
    if (!isAnalyzed(candidate)) {
      return false;
    }

    return !isUnverifiedEvidence(candidate.evidence) || includeUnverified;
  }

  const scopeSummary = useMemo(() => summarizeScopes(plan?.branches ?? []), [plan]);
  const showsUnanalyzed = showIneligible && evidenceFilter === 'all';
  const visibleCandidates = useMemo(() => {
    return (plan?.branches ?? [])
      .filter((candidate) => candidate.scope === scope)
      .filter((candidate) => {
        // Protected and recent branches have no merge evidence, so evidence
        // filters do not apply. They appear only in the unfiltered list.
        if (!isAnalyzed(candidate)) {
          return showsUnanalyzed;
        }

        return (
          matchesEvidenceFilter(candidate.evidence, evidenceFilter) &&
          (includeUnverified || !isUnverifiedEvidence(candidate.evidence))
        );
      })
      .sort(compareCandidates);
  }, [plan, scope, evidenceFilter, includeUnverified, showsUnanalyzed]);
  const hiddenInScope = useMemo(() => {
    const inScope = (plan?.branches ?? []).filter((candidate) => candidate.scope === scope);
    return {
      protectedCount: inScope.filter((candidate) => candidate.protectedReason).length,
      recentCount: inScope.filter((candidate) => !candidate.protectedReason && !candidate.oldEnough).length,
      unverifiedCount: inScope.filter((candidate) => isAnalyzed(candidate) && isUnverifiedEvidence(candidate.evidence)).length
    };
  }, [plan, scope]);

  const selectedCandidates = useMemo(
    () =>
      Array.from(selected)
        .map((ref) => candidatesByRef.get(ref))
        .filter((candidate): candidate is BranchCleanupCandidate => Boolean(candidate))
        .sort(compareCandidates),
    [selected, candidatesByRef]
  );
  const selectedLocal = selectedCandidates.filter((candidate) => candidate.scope === 'local');
  const selectedRemote = selectedCandidates.filter((candidate) => candidate.scope === 'remote');
  const selectedHeuristic = selectedCandidates.filter(
    (candidate) => candidate.evidence === 'patch-equivalent' || candidate.evidence === 'content-integrated'
  );
  const selectedUnverified = selectedCandidates.filter((candidate) => isUnverifiedEvidence(candidate.evidence));
  const requiresAcknowledgement = selectedCandidates.some((candidate) => candidate.evidence !== 'merged');
  const remainingCapacity = Math.max(0, MAX_CLEANUP_BRANCHES - selected.size);
  const isAtLimit = remainingCapacity === 0;
  const isOverLimit = selected.size > MAX_CLEANUP_BRANCHES;
  const unselectedMergedInScope = visibleCandidates.filter(
    (candidate) => candidate.evidence === 'merged' && isEligible(candidate) && !selected.has(candidate.ref)
  );
  const mergedToAdd = Math.min(unselectedMergedInScope.length, remainingCapacity);

  useEffect(() => {
    if (!isAtLimit) {
      setLimitNotice(undefined);
    }
  }, [isAtLimit]);

  // Move focus to the step heading so screen readers announce the new step.
  const previousStepRef = useRef(step);
  useEffect(() => {
    if (previousStepRef.current !== step) {
      previousStepRef.current = step;
      titleRef.current?.focus({ preventScroll: true });
    }
  }, [step]);

  // Initial read-only scan with default criteria.
  useEffect(() => {
    void runScan(AUTOMATIC_BASE, DEFAULT_AGE_DAYS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Changing criteria invalidates the current selection.
  useEffect(() => {
    setSelected(new Set());
    setAcknowledged(false);
  }, [baseRef, ageDays]);

  // Hiding unverified branches removes them from the selection.
  useEffect(() => {
    if (includeUnverified) {
      return;
    }

    setSelected((current) => {
      const next = new Set(Array.from(current).filter((ref) => {
        const candidate = candidatesByRef.get(ref);
        return candidate && !isUnverifiedEvidence(candidate.evidence);
      }));
      return next.size === current.size ? current : next;
    });
  }, [includeUnverified, candidatesByRef]);

  async function runScan(nextBaseRef: string, nextAgeDays: number): Promise<void> {
    const requestId = scanRequestRef.current + 1;
    scanRequestRef.current = requestId;
    setSelected(new Set());
    setAcknowledged(false);
    setNotice(undefined);
    setScan((current) => ({
      status: 'loading',
      previous: current.status === 'success' ? current.plan : current.status !== 'idle' ? current.previous : undefined
    }));

    try {
      const nextPlan = await window.api.analyzeBranchCleanup(repoPath, {
        baseRef: nextBaseRef || undefined,
        olderThanDays: nextAgeDays
      });

      if (!mountedRef.current || scanRequestRef.current !== requestId) {
        return;
      }

      setScan({ status: 'success', plan: nextPlan });
      setScannedCriteria({ baseRef: nextBaseRef, olderThanDays: nextAgeDays });
    } catch (error) {
      if (!mountedRef.current || scanRequestRef.current !== requestId) {
        return;
      }

      setScan((current) => ({
        status: 'error',
        message: errorMessage(error, 'Unable to scan branches.'),
        previous: current.status === 'loading' ? current.previous : undefined
      }));
    }
  }

  function handleScanSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (ageDays === undefined || isMutating) {
      return;
    }

    void runScan(baseRef, ageDays);
  }

  function handleClose(): void {
    if (isMutating) {
      return;
    }

    onClose();
  }

  function toggleCandidate(candidate: BranchCleanupCandidate): void {
    if (!isEligible(candidate) || !canInteractWithPlan) {
      return;
    }

    if (!selected.has(candidate.ref) && isAtLimit) {
      return;
    }

    setAcknowledged(false);
    setSelected((current) => {
      const next = new Set(current);

      if (next.has(candidate.ref)) {
        next.delete(candidate.ref);
      } else if (next.size < MAX_CLEANUP_BRANCHES) {
        next.add(candidate.ref);
      }

      return next;
    });
  }

  function handleSelectMerged(): void {
    if (!canInteractWithPlan) {
      return;
    }

    const { next, skipped } = addWithinLimit(selected, unselectedMergedInScope.map((candidate) => candidate.ref));
    setAcknowledged(false);
    setSelected(next);
    setLimitNotice(
      skipped > 0
        ? `Selected ${next.size - selected.size} of ${unselectedMergedInScope.length} merged branches. A cleanup can delete up to ${MAX_CLEANUP_BRANCHES} branches; scan again afterwards to clean up the rest.`
        : undefined
    );
  }

  function handleClearSelection(): void {
    setAcknowledged(false);
    setSelected(new Set());
    setLimitNotice(undefined);
  }

  async function handleRefreshRemotes(): Promise<void> {
    if (isMutating || ageDays === undefined) {
      return;
    }

    setNotice(undefined);
    setIsRefreshingRemotes(true);
    let failure: string | undefined;

    try {
      const completed = await runOperation('Update remote branch list', async (path) => {
        try {
          return await window.api.refreshMaintenanceRefs(path);
        } catch (error) {
          failure = errorMessage(error, 'Unable to update remote branches.');
          throw error;
        }
      });

      if (!mountedRef.current) {
        return;
      }

      if (!completed) {
        setNotice({
          tone: 'error',
          message: failure ?? 'Another Git operation is running for this repository. Try again when it finishes.'
        });
        return;
      }
    } finally {
      if (mountedRef.current) {
        setIsRefreshingRemotes(false);
      }
    }

    await runScan(baseRef, ageDays);
  }

  async function handleConfirmCleanup(): Promise<void> {
    if (scan.status !== 'success' || selectedCandidates.length === 0 || isMutating) {
      return;
    }

    if (requiresAcknowledgement && !acknowledged) {
      return;
    }

    const capturedPlan = scan.plan;
    const capturedCandidates = new Map(selectedCandidates.map((candidate) => [candidate.ref, candidate]));
    const input: BranchCleanupInput = {
      baseRef: capturedPlan.baseRef,
      expectedBaseSha: capturedPlan.baseSha,
      olderThanDays: capturedPlan.olderThanDays,
      branches: selectedCandidates.map((candidate) => ({ ref: candidate.ref, expectedSha: candidate.sha })),
      allowUnverified: requiresAcknowledgement && acknowledged
    };
    const count = input.branches.length;
    let result: BranchCleanupResult | undefined;
    let failure: string | undefined;

    setCleanup({ status: 'running', refs: input.branches.map((branch) => branch.ref) });

    const completed = await runOperation(`Delete ${count} ${count === 1 ? 'branch' : 'branches'}`, async (path) => {
      try {
        result = await window.api.cleanupBranches(path, input);
        return result;
      } catch (error) {
        failure = errorMessage(error, 'Unable to delete branches.');
        throw error;
      }
    });

    if (!mountedRef.current) {
      return;
    }

    if (result) {
      setCleanup({ status: 'done', result, candidates: capturedCandidates });
      setSelected(new Set());
      setAcknowledged(false);
      setStep('result');
      return;
    }

    setCleanup({
      status: 'error',
      message:
        failure ??
        (completed ? 'Cleanup finished without a result.' : 'Another Git operation is running for this repository. Try again when it finishes.')
    });
  }

  function handleBackToScan(rescan: boolean): void {
    setStep('scan');
    setCleanup({ status: 'idle' });
    setAcknowledged(false);

    if (rescan && ageDays !== undefined) {
      void runScan(baseRef, ageDays);
    }
  }

  const title = step === 'review' ? 'Review branch deletion' : step === 'result' ? 'Cleanup results' : 'Repository maintenance';

  return (
    <ModalSurface
      labelledBy={titleId}
      describedBy={descriptionId}
      className="flex h-[min(780px,90vh)] w-full max-w-[1040px] flex-col overflow-hidden rounded-md border border-[var(--border-strong)] bg-[var(--bg-panel)] shadow-2xl shadow-black/60"
      onClose={handleClose}
    >
      <header className="flex min-h-13 items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-graph-header)] px-4 py-2">
        <GitBranch size={17} className="shrink-0 text-[var(--accent-2)]" />
        <div className="min-w-0 flex-1">
          <h2 ref={titleRef} id={titleId} tabIndex={-1} className="text-sm font-semibold text-[var(--text-1)] outline-none">{title}</h2>
          <p id={descriptionId} className="mt-0.5 truncate text-[11px] text-[var(--text-3)]" title={repoPath}>
            Clean up old branches in {repoName ?? repoPath}
          </p>
        </div>
        <button
          className="icon-btn h-7 w-7"
          type="button"
          onClick={handleClose}
          disabled={isMutating}
          aria-label="Close repository maintenance"
          title={isMutating ? 'Wait for the operation to finish' : 'Close'}
        >
          <X size={14} />
        </button>
      </header>

      {step === 'scan' ? (
        <>
          <form
            className="flex flex-wrap items-end gap-3 border-b border-[var(--border)] px-4 py-3"
            onSubmit={handleScanSubmit}
            aria-label="Scan criteria"
          >
            <label className="block min-w-[220px] flex-1" htmlFor={baseInputId}>
              <FieldLabel>Compare with</FieldLabel>
              <select
                id={baseInputId}
                className="inspector-input"
                value={baseRef}
                disabled={isMutating}
                onChange={(event) => setBaseRef(event.target.value)}
              >
                <option value={AUTOMATIC_BASE}>
                  Default branch{plan && scannedCriteria?.baseRef === AUTOMATIC_BASE ? ` (${shortRefName(plan.baseRef)})` : ''}
                </option>
                {baseOptions.local.length > 0 ? (
                  <optgroup label="Local branches">
                    {baseOptions.local.map((option) => <option key={option.ref} value={option.ref}>{option.label}</option>)}
                  </optgroup>
                ) : null}
                {baseOptions.remote.length > 0 ? (
                  <optgroup label="Remote branches">
                    {baseOptions.remote.map((option) => <option key={option.ref} value={option.ref}>{option.label}</option>)}
                  </optgroup>
                ) : null}
              </select>
            </label>
            <label className="block w-36" htmlFor={ageInputId}>
              <FieldLabel>Last commit older than</FieldLabel>
              <span className="relative block">
                <input
                  id={ageInputId}
                  className="inspector-input pr-11 tabular-nums"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_AGE_DAYS}
                  step={1}
                  value={ageText}
                  disabled={isMutating}
                  aria-invalid={ageDays === undefined}
                  aria-describedby={ageDays === undefined ? `${ageInputId}-error` : undefined}
                  onChange={(event) => setAgeText(event.target.value)}
                />
                <span className="pointer-events-none absolute inset-y-0 right-2.5 grid place-items-center text-[11px] text-[var(--text-3)]">days</span>
              </span>
            </label>
            <button
              className="btn-primary btn-regular shrink-0"
              type="submit"
              disabled={ageDays === undefined || isMutating || isScanning}
            >
              {isScanning ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
              {isScanning ? 'Scanning…' : 'Scan'}
            </button>
            <button
              className="btn-subtle btn-regular shrink-0"
              type="button"
              disabled={isMutating || isScanning || isRepositoryBusy || ageDays === undefined}
              onClick={() => void handleRefreshRemotes()}
              title="Fetch the branch list from every remote and remove local copies of branches already deleted there. Nothing is deleted on a remote."
            >
              {isRefreshingRemotes ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Update remote branches
            </button>
            {ageDays === undefined ? (
              <p id={`${ageInputId}-error`} className="w-full text-[11px] text-[var(--danger-text)]" role="alert">
                Enter a whole number of days from 0 to {MAX_AGE_DAYS}.
              </p>
            ) : null}
            <p className="w-full text-[11px] leading-4 text-[var(--text-3)]">
              Scanning leaves your branches, checkout, and staged files unchanged. Age is measured from each branch's last commit and never proves a branch is safe to delete.
              {' '}Updating remote branches fetches remote branch lists and removes stale local copies only.
            </p>
          </form>

          {notice ? <InlineMessage tone={notice.tone}>{notice.message}</InlineMessage> : null}
          {limitNotice ? <InlineMessage tone="info">{limitNotice}</InlineMessage> : null}
          {scan.status === 'error' ? <InlineMessage tone="error">{scan.message}</InlineMessage> : null}
          {criteriaChanged ? (
            <InlineMessage tone="info">Criteria changed. Scan again to select branches.</InlineMessage>
          ) : null}
          {plan && plan.warnings.length > 0 ? (
            <div className="border-b border-[var(--border)] bg-[var(--warning-bg)] px-4 py-2 text-[11px] text-[var(--warning-text)]" role="status">
              <ul className="grid gap-0.5">
                {plan.warnings.map((warning) => (
                  <li key={warning} className="flex gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {plan ? (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--border)] px-4 py-2">
                <div className="segmented" role="group" aria-label="Branch location">
                  {(['local', 'remote'] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      data-active={scope === item}
                      aria-pressed={scope === item}
                      onClick={() => setScope(item)}
                    >
                      {item === 'local' ? 'Local' : 'Remote'}
                      <span className="tabular-nums text-[var(--text-3)]">{scopeSummary[item].total}</span>
                    </button>
                  ))}
                </div>
                <div className="segmented" role="group" aria-label="Filter by evidence">
                  {evidenceFilterOptions(includeUnverified).map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      data-active={evidenceFilter === option.id}
                      aria-pressed={evidenceFilter === option.id}
                      onClick={() => setEvidenceFilter(option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-2)]">
                  <input
                    type="checkbox"
                    checked={includeUnverified}
                    onChange={(event) => {
                      setIncludeUnverified(event.target.checked);
                      if (!event.target.checked && evidenceFilter === 'unmerged') {
                        setEvidenceFilter('all');
                      }
                    }}
                  />
                  Include branches that are not merged
                </label>
                <label className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-2)]">
                  <input type="checkbox" checked={showIneligible} onChange={(event) => setShowIneligible(event.target.checked)} />
                  Show protected and recent
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-1.5 text-[11px] text-[var(--text-3)]">
                <span>
                  Compared with <span className="mono text-[var(--text-2)]">{shortRefName(plan.baseRef)}</span>
                  {' '}at <span className="mono">{plan.baseSha.slice(0, 8)}</span> · scanned {formatTime(plan.scannedAt)}
                </span>
                <HiddenSummary
                  protectedCount={showsUnanalyzed ? 0 : hiddenInScope.protectedCount}
                  recentCount={showsUnanalyzed ? 0 : hiddenInScope.recentCount}
                  unverifiedCount={includeUnverified ? 0 : hiddenInScope.unverifiedCount}
                  olderThanDays={plan.olderThanDays}
                />
                <span className="flex-1" />
                <button
                  className="btn-subtle btn-compact"
                  type="button"
                  disabled={!canInteractWithPlan || mergedToAdd === 0}
                  onClick={handleSelectMerged}
                  title={`Select merged branches shown in this list, up to ${MAX_CLEANUP_BRANCHES} per cleanup`}
                >
                  <Check size={12} />
                  Select merged ({mergedToAdd})
                </button>
                <button
                  className="btn-subtle btn-compact"
                  type="button"
                  disabled={selected.size === 0 || isMutating}
                  onClick={handleClearSelection}
                >
                  Clear
                </button>
              </div>

              <div className={`min-h-0 flex-1 overflow-auto ${isScanning || criteriaChanged ? 'opacity-60' : ''}`} aria-busy={isScanning}>
                {visibleCandidates.length === 0 ? (
                  <EmptyState>
                    {isScanning
                      ? 'Scanning branches…'
                      : `No ${scope} branches match. Try a lower age, another comparison branch, or show more branches.`}
                  </EmptyState>
                ) : (
                  <CandidateTable
                    candidates={visibleCandidates}
                    selected={selected}
                    disabled={!canInteractWithPlan}
                    baseName={shortRefName(plan.baseRef)}
                    isEligible={isEligible}
                    isAtLimit={isAtLimit}
                    onToggle={toggleCandidate}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="min-h-0 flex-1">
              <EmptyState>
                {isScanning ? (
                  <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Scanning branches…</span>
                ) : scan.status === 'error' ? (
                  'The scan did not complete. Adjust the criteria and scan again.'
                ) : (
                  'Scan to find branches that can be cleaned up.'
                )}
              </EmptyState>
            </div>
          )}

          <footer className="flex items-center gap-3 border-t border-[var(--border)] bg-[var(--bg-graph-header)] px-4 py-2.5">
            <p className="min-w-0 flex-1 text-[11.5px] text-[var(--text-2)]" role="status" aria-live="polite">
              {selectedCandidates.length === 0
                ? 'No branches selected.'
                : `${selectedLocal.length} local and ${selectedRemote.length} remote ${pluralize(selectedCandidates.length, 'branch', 'branches')} selected.`}
              {isAtLimit
                ? ` Limit of ${MAX_CLEANUP_BRANCHES} reached; delete these first, then scan again for more.`
                : null}
            </p>
            <button className="btn-subtle btn-regular" type="button" onClick={handleClose} disabled={isMutating}>
              Close
            </button>
            <button
              className="btn-primary btn-regular"
              type="button"
              disabled={!canInteractWithPlan || selectedCandidates.length === 0 || isOverLimit || isRepositoryBusy}
              onClick={() => {
                setAcknowledged(false);
                setCleanup({ status: 'idle' });
                setStep('review');
              }}
            >
              Review deletion…
            </button>
          </footer>
        </>
      ) : step === 'review' && plan ? (
        <>
          <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
            <p className="text-xs text-[var(--text-2)]">
              Compared with <span className="mono">{shortRefName(plan.baseRef)}</span> at{' '}
              <span className="mono">{plan.baseSha.slice(0, 8)}</span>. Everything is checked again before deletion. If the comparison branch
              or any selected branch has changed since the scan, nothing is deleted and you need to scan again. Problems on a remote server are
              reported per branch. A local recovery ref keeps the reviewed commit of every deleted branch.
            </p>

            <div className="mt-3 grid gap-2">
              {selectedRemote.length > 0 ? (
                <Warning tone="danger">
                  {selectedRemote.length} remote {pluralize(selectedRemote.length, 'branch is', 'branches are')} deleted on the server
                  ({formatList(Array.from(new Set(selectedRemote.map((candidate) => candidate.remote ?? 'remote'))))}). This affects everyone using that remote.
                </Warning>
              ) : null}
              {selectedHeuristic.length > 0 ? (
                <Warning tone="warning">
                  {selectedHeuristic.length} {pluralize(selectedHeuristic.length, 'branch looks', 'branches look')} integrated because matching changes or content are in the
                  comparison branch. This is likely but not proof that no work is lost.
                </Warning>
              ) : null}
              {selectedUnverified.length > 0 ? (
                <Warning tone="danger">
                  {selectedUnverified.length} {pluralize(selectedUnverified.length, 'branch is', 'branches are')} not merged or could not be checked and may
                  contain work that is not in the comparison branch. Deleting {pluralize(selectedUnverified.length, 'it', 'them')} may remove that work from your
                  branches{selectedUnverified.some((candidate) => candidate.scope === 'remote') ? ' and from the remote' : ''}; afterwards the reviewed commits remain only in
                  local recovery refs.
                </Warning>
              ) : null}
            </div>

            <ReviewGroup title="Local branches" candidates={selectedLocal} />
            <ReviewGroup title="Remote branches" candidates={selectedRemote} />

            {cleanup.status === 'error' ? (
              <div className="mt-3"><Warning tone="danger">{cleanup.message}</Warning></div>
            ) : null}
          </div>

          <footer className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] bg-[var(--bg-graph-header)] px-4 py-2.5">
            {requiresAcknowledgement ? (
              <label className="flex min-w-0 flex-1 items-start gap-2 text-[11.5px] leading-4 text-[var(--text-1)]" htmlFor={acknowledgeId}>
                <input
                  id={acknowledgeId}
                  className="mt-0.5"
                  type="checkbox"
                  checked={acknowledged}
                  disabled={isMutating}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                I understand that branches without a confirmed merge may contain work that is not in the comparison branch, and that it will remain
                only in local recovery refs.
              </label>
            ) : (
              <p className="min-w-0 flex-1 text-[11.5px] text-[var(--text-2)]">All selected branches are fully merged.</p>
            )}
            <button
              className="btn-subtle btn-regular"
              type="button"
              disabled={isMutating}
              onClick={() => {
                setCleanup({ status: 'idle' });
                setStep('scan');
              }}
            >
              <ArrowLeft size={13} />
              Back
            </button>
            <button
              className="btn-subtle btn-regular border-[var(--danger-border)] text-[var(--danger-text)]"
              type="button"
              disabled={isMutating || isRepositoryBusy || (requiresAcknowledgement && !acknowledged)}
              onClick={() => void handleConfirmCleanup()}
            >
              {cleanup.status === 'running' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              {cleanup.status === 'running'
                ? 'Deleting…'
                : `Delete ${selectedCandidates.length} ${pluralize(selectedCandidates.length, 'branch', 'branches')}`}
            </button>
          </footer>
        </>
      ) : step === 'result' && cleanup.status === 'done' ? (
        <>
          <CleanupResultView result={cleanup.result} candidates={cleanup.candidates} />
          <footer className="flex items-center gap-3 border-t border-[var(--border)] bg-[var(--bg-graph-header)] px-4 py-2.5">
            <span className="flex-1" />
            <button className="btn-subtle btn-regular" type="button" onClick={() => handleBackToScan(true)}>
              <Search size={13} />
              Scan again
            </button>
            <button className="btn-primary btn-regular" type="button" onClick={onClose}>
              Done
            </button>
          </footer>
        </>
      ) : (
        <div className="min-h-0 flex-1">
          <EmptyState>
            <button className="btn-subtle btn-regular" type="button" onClick={() => handleBackToScan(true)}>Back to scan</button>
          </EmptyState>
        </div>
      )}
    </ModalSurface>
  );
}

function CandidateTable({
  candidates,
  selected,
  disabled,
  baseName,
  isEligible,
  isAtLimit,
  onToggle
}: {
  candidates: BranchCleanupCandidate[];
  selected: ReadonlySet<string>;
  disabled: boolean;
  baseName: string;
  isEligible: (candidate: BranchCleanupCandidate) => boolean;
  isAtLimit: boolean;
  onToggle: (candidate: BranchCleanupCandidate) => void;
}): ReactElement {
  return (
    <table className="w-full border-collapse text-left text-[11.5px]">
      <thead className="sticky top-0 z-[1] bg-[var(--bg-panel)] text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-3)]">
        <tr className="border-b border-[var(--border)]">
          <th className="w-9 px-4 py-1.5"><span className="sr-only">Select</span></th>
          <th className="px-2 py-1.5">Branch</th>
          <th className="w-24 px-2 py-1.5">Last commit</th>
          <th className="px-2 py-1.5">Merge status vs {baseName}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--border)]">
        {candidates.map((candidate) => {
          const eligible = isEligible(candidate);
          const isSelected = selected.has(candidate.ref);
          const inputId = `cleanup-${candidate.ref}`;
          const analyzed = isAnalyzed(candidate);
          const reason = candidate.protectedReason ?? (!candidate.oldEnough ? 'Newer than the age threshold' : undefined);
          const blockedByLimit = eligible && !isSelected && isAtLimit;

          return (
            <tr
              key={candidate.ref}
              className={`align-top ${isSelected ? 'bg-[var(--select-bg)]' : ''} ${eligible ? '' : 'text-[var(--text-3)]'}`}
            >
              <td className="px-4 py-2">
                {candidate.protectedReason ? (
                  <Lock size={13} className="mt-0.5 text-[var(--text-3)]" aria-label="Protected" />
                ) : (
                  <input
                    id={inputId}
                    type="checkbox"
                    className="mt-0.5"
                    checked={isSelected}
                    disabled={!eligible || disabled || blockedByLimit}
                    aria-label={`Select ${candidate.name}`}
                    title={blockedByLimit ? `A cleanup can delete up to ${MAX_CLEANUP_BRANCHES} branches` : undefined}
                    onChange={() => onToggle(candidate)}
                  />
                )}
              </td>
              <td className="min-w-0 px-2 py-2">
                <label htmlFor={candidate.protectedReason ? undefined : inputId} className="block min-w-0">
                  <span className={`mono block break-all ${eligible ? 'text-[var(--text-1)]' : ''}`}>{candidate.name}</span>
                  {reason ? <span className="mt-0.5 block text-[10.5px] text-[var(--text-3)]">{reason}</span> : null}
                  {candidate.upstreamGone ? (
                    <span className="mt-0.5 block text-[10.5px] text-[var(--text-3)]">Upstream tracking ref is missing; update remote branches to check.</span>
                  ) : null}
                </label>
              </td>
              <td className="px-2 py-2 tabular-nums" title={candidate.tipCommittedAt ? new Date(candidate.tipCommittedAt).toLocaleString() : undefined}>
                {formatAge(candidate.ageDays)}
              </td>
              <td className="px-2 py-2">
                <EvidenceBadge candidate={candidate} />
                <span className="mt-0.5 block text-[10.5px] leading-4 text-[var(--text-3)]">
                  {analyzed ? candidate.explanation || EVIDENCE_HINTS[candidate.evidence] : 'Merge status was not checked.'}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ReviewGroup({ title, candidates }: { title: string; candidates: BranchCleanupCandidate[] }): ReactElement | null {
  if (candidates.length === 0) {
    return null;
  }

  return (
    <section className="mt-4">
      <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-3)]">
        {title} · {candidates.length}
      </h3>
      <ul className="divide-y divide-[var(--border)] rounded border border-[var(--border)]">
        {candidates.map((candidate) => (
          <li key={candidate.ref} className="flex items-center gap-3 px-3 py-1.5 text-[11.5px]">
            <span className="mono min-w-0 flex-1 break-all text-[var(--text-1)]">{candidate.name}</span>
            <span className="shrink-0 tabular-nums text-[var(--text-3)]">{formatAge(candidate.ageDays)}</span>
            <EvidenceBadge candidate={candidate} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function CleanupResultView({
  result,
  candidates
}: {
  result: BranchCleanupResult;
  candidates: Map<string, BranchCleanupCandidate>;
}): ReactElement {
  const deleted = result.outcomes.filter((outcome) => outcome.status === 'deleted');
  const failed = result.outcomes.filter((outcome) => outcome.status === 'failed');

  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
      <div role="status" aria-live="polite">
        {failed.length === 0 ? (
          <Warning tone="success">Deleted {deleted.length} {pluralize(deleted.length, 'branch', 'branches')}.</Warning>
        ) : (
          <Warning tone={deleted.length > 0 ? 'warning' : 'danger'}>
            Deleted {deleted.length} of {result.outcomes.length} branches. {failed.length} reported a failure. Update remote branches before retrying a server failure.
          </Warning>
        )}
      </div>
      {deleted.some((outcome) => outcome.recoveryRef) ? (
        <p className="mt-2 text-[11px] leading-4 text-[var(--text-3)]">
          Each deleted branch is preserved by a recovery ref. Copy the restore command to recreate a branch at its previous commit.
        </p>
      ) : null}
      <ul className="mt-3 divide-y divide-[var(--border)] rounded border border-[var(--border)]">
        {[...failed, ...deleted].map((outcome) => {
          const candidate = candidates.get(outcome.ref);
          const restoreCommand = outcome.recoveryRef && candidate ? buildRestoreCommand(candidate, outcome.recoveryRef) : undefined;

          return (
            <li key={outcome.ref} className="grid gap-1 px-3 py-2 text-[11.5px]">
              <div className="flex items-center gap-2">
                {outcome.status === 'deleted' ? (
                  <CheckCircle2 size={13} className="shrink-0 text-[var(--success-text)]" aria-hidden />
                ) : (
                  <AlertTriangle size={13} className="shrink-0 text-[var(--danger-text)]" aria-hidden />
                )}
                <span className="mono min-w-0 flex-1 break-all text-[var(--text-1)]">{candidate?.name ?? shortRefName(outcome.ref)}</span>
                <span className={`shrink-0 text-[11px] ${outcome.status === 'deleted' ? 'text-[var(--success-text)]' : 'text-[var(--danger-text)]'}`}>
                  {outcome.status === 'deleted' ? 'Deleted' : 'Failed'}
                </span>
              </div>
              {outcome.message ? <p className="pl-5 text-[11px] text-[var(--text-3)]">{outcome.message}</p> : null}
              {outcome.recoveryRef ? (
                <div className="flex flex-wrap items-center gap-2 pl-5">
                  <code className="mono min-w-0 flex-1 break-all text-[11px] text-[var(--text-2)]">{outcome.recoveryRef}</code>
                  <CopyButton text={outcome.recoveryRef} label="Copy ref" accessibleLabel={`Copy recovery ref for ${candidate?.name ?? outcome.ref}`} />
                  {restoreCommand ? (
                    <CopyButton text={restoreCommand} label="Copy restore command" accessibleLabel={`Copy restore command for ${candidate?.name ?? outcome.ref}`} />
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CopyButton({ text, label, accessibleLabel }: { text: string; label: string; accessibleLabel: string }): ReactElement {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (status !== 'copied') {
      return;
    }

    const timeout = window.setTimeout(() => setStatus('idle'), 1500);
    return () => window.clearTimeout(timeout);
  }, [status]);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      if (mountedRef.current) {
        setStatus('copied');
      }
    } catch {
      if (mountedRef.current) {
        setStatus('failed');
      }
    }
  }

  return (
    <>
      <button
        className="review-comment-action"
        type="button"
        aria-label={accessibleLabel}
        title={text}
        onClick={() => void handleCopy()}
      >
        {status === 'copied' ? <Check size={12} /> : <Copy size={12} />}
        {status === 'copied' ? 'Copied' : label}
      </button>
      {status === 'failed' ? (
        <p className="w-full text-[11px] text-[var(--danger-text)]" role="alert">
          Could not copy to the clipboard. Select and copy it manually:{' '}
          <code className="mono select-all break-all text-[var(--text-2)]">{text}</code>
        </p>
      ) : null}
    </>
  );
}

function EvidenceBadge({ candidate }: { candidate: BranchCleanupCandidate }): ReactElement {
  const { evidence } = candidate;

  if (!isAnalyzed(candidate)) {
    const label = candidate.protectedReason ? 'Protected' : 'Not analyzed';
    const hint = candidate.protectedReason
      ? `${candidate.protectedReason}. Protected branches are not analyzed and cannot be deleted here.`
      : 'Newer than the age threshold, so merge status was not checked.';

    return (
      <span className="inline-flex shrink-0 items-center rounded border border-[var(--border)] px-1.5 text-[10.5px] font-medium leading-[18px] text-[var(--text-2)]" title={hint}>
        {label}
      </span>
    );
  }

  const tone = evidence === 'merged'
    ? 'border-[var(--success-border)] text-[var(--success-text)]'
    : evidence === 'unmerged' || evidence === 'unknown'
      ? 'border-[var(--danger-border)] text-[var(--danger-text)]'
      : 'border-[color-mix(in_srgb,var(--warning-text)_45%,var(--border))] text-[var(--warning-text)]';

  return (
    <span className={`inline-flex shrink-0 items-center rounded border px-1.5 text-[10.5px] font-medium leading-[18px] ${tone}`} title={EVIDENCE_HINTS[evidence]}>
      {EVIDENCE_LABELS[evidence]}
    </span>
  );
}

function HiddenSummary({
  protectedCount,
  recentCount,
  unverifiedCount,
  olderThanDays
}: {
  protectedCount: number;
  recentCount: number;
  unverifiedCount: number;
  olderThanDays: number;
}): ReactElement | null {
  const parts = [
    protectedCount > 0 ? `${protectedCount} protected` : undefined,
    recentCount > 0 ? `${recentCount} newer than ${olderThanDays} ${pluralize(olderThanDays, 'day', 'days')}` : undefined,
    unverifiedCount > 0 ? `${unverifiedCount} not merged` : undefined
  ].filter(Boolean);

  return parts.length > 0 ? <span>Hidden: {parts.join(', ')}</span> : null;
}

function Warning({ tone, children }: { tone: 'danger' | 'warning' | 'success'; children: ReactNode }): ReactElement {
  const classes = tone === 'danger'
    ? 'border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-text)]'
    : tone === 'warning'
      ? 'border-[color-mix(in_srgb,var(--warning-text)_36%,var(--border))] bg-[var(--warning-bg)] text-[var(--warning-text)]'
      : 'border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-text)]';

  return (
    <div className={`flex gap-2 rounded border px-3 py-2 text-[11.5px] leading-4 ${classes}`}>
      {tone === 'success' ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" aria-hidden /> : <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />}
      <span>{children}</span>
    </div>
  );
}

function InlineMessage({ tone, children }: { tone: 'error' | 'info'; children: ReactNode }): ReactElement {
  return (
    <div
      className={`flex items-center gap-2 border-b px-4 py-1.5 text-[11.5px] ${
        tone === 'error'
          ? 'border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-text)]'
          : 'border-[var(--border)] text-[var(--text-2)]'
      }`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {tone === 'error' ? <AlertTriangle size={13} className="shrink-0" aria-hidden /> : null}
      {children}
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }): ReactElement {
  return <div className="grid h-full min-h-40 place-items-center px-6 text-center text-xs text-[var(--text-3)]">{children}</div>;
}

function FieldLabel({ children }: { children: ReactNode }): ReactElement {
  return <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-3)]">{children}</span>;
}

function evidenceFilterOptions(includeUnverified: boolean): Array<{ id: EvidenceFilter; label: string }> {
  return [
    { id: 'all', label: 'All' },
    { id: 'merged', label: 'Merged' },
    { id: 'likely', label: 'Likely integrated' },
    ...(includeUnverified ? [{ id: 'unmerged' as const, label: 'Not merged' }] : [])
  ];
}

function matchesEvidenceFilter(evidence: BranchCleanupEvidence, filter: EvidenceFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'merged':
      return evidence === 'merged';
    case 'likely':
      return evidence === 'patch-equivalent' || evidence === 'content-integrated';
    case 'unmerged':
      return isUnverifiedEvidence(evidence);
  }
}

function isUnverifiedEvidence(evidence: BranchCleanupEvidence): boolean {
  return evidence === 'unmerged' || evidence === 'unknown';
}

const EVIDENCE_ORDER: Record<BranchCleanupEvidence, number> = {
  merged: 0,
  'patch-equivalent': 1,
  'content-integrated': 2,
  unknown: 3,
  unmerged: 4
};

function compareCandidates(left: BranchCleanupCandidate, right: BranchCleanupCandidate): number {
  return (
    analysisRank(left) - analysisRank(right) ||
    EVIDENCE_ORDER[left.evidence] - EVIDENCE_ORDER[right.evidence] ||
    (right.ageDays ?? -1) - (left.ageDays ?? -1) ||
    left.name.localeCompare(right.name)
  );
}

/** Analyzed branches first, then recent, then protected. */
function analysisRank(candidate: BranchCleanupCandidate): number {
  return candidate.protectedReason ? 2 : candidate.oldEnough ? 0 : 1;
}

function summarizeScopes(candidates: BranchCleanupCandidate[]): Record<Scope, { total: number }> {
  return {
    local: { total: candidates.filter((candidate) => candidate.scope === 'local').length },
    remote: { total: candidates.filter((candidate) => candidate.scope === 'remote').length }
  };
}

type BaseOption = { ref: string; label: string };

function buildBaseOptions(
  refs: GitRepositoryOverview['refs'] | undefined,
  selectedRef: string,
  scannedRef: string | undefined
): { local: BaseOption[]; remote: BaseOption[] } {
  const local: BaseOption[] = (refs?.localBranches ?? []).map((branch) => ({ ref: branch.fullName, label: branch.name }));
  const remote: BaseOption[] = (refs?.remoteBranches ?? [])
    .filter((branch) => !branch.fullName.endsWith('/HEAD'))
    .map((branch) => ({ ref: branch.fullName, label: branch.name }));
  const known = new Set([...local, ...remote].map((option) => option.ref));

  // Keep the chosen or scanned base visible even if refs have since changed.
  for (const ref of [selectedRef, scannedRef]) {
    if (!ref || known.has(ref)) {
      continue;
    }

    known.add(ref);
    (ref.startsWith('refs/remotes/') ? remote : local).push({ ref, label: shortRefName(ref) });
  }

  return { local, remote };
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function formatList(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : fallback;
}
