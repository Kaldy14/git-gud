import type { ReactElement, ReactNode } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
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
  ArtifactCleanupCandidate,
  ArtifactCleanupInput,
  ArtifactCleanupPlan,
  ArtifactCleanupResult,
  BranchCleanupCandidate,
  BranchCleanupEvidence,
  BranchCleanupInput,
  BranchCleanupPlan,
  BranchCleanupResult
} from '@shared/maintenance';
import type { GitOperationResult, GitRepositoryOverview } from '@shared/types';

import {
  ARTIFACT_NOUNS,
  buildStashRestoreCommand,
  buildWorktreeRestoreCommand,
  formatAgeSource,
  MAX_CLEANUP_ARTIFACTS
} from './artifactCleanupPresentation';
import {
  buildRestoreCommand,
  formatAge,
  isAnalyzed,
  MAX_AGE_DAYS,
  MAX_CLEANUP_BRANCHES,
  parseAgeDays,
  shortRefName
} from './branchCleanupPresentation';
import type { BranchCriteria, BranchRule, SelectionChange, SimpleRules } from './maintenanceSelection';
import {
  AGE_PRESETS,
  applyRowClick,
  artifactKey,
  AUTO_SCAN_DELAY_MS,
  compareArtifactCandidates,
  compareBranchCandidates,
  DEFAULT_SIMPLE_RULES,
  isArtifactSelectable,
  isBranchSelectable,
  isHeuristicEvidence,
  isSameBranchCriteria,
  isUnverifiedEvidence,
  matchesSearch,
  previewSimpleArtifacts,
  previewSimpleBranches,
  pruneSelection,
  toggleAllVisible
} from './maintenanceSelection';
import { countLabel, errorMessage, EVIDENCE_HINTS, formatList, formatTime, pluralize } from './maintenanceFormat';
import { Badge, CopyButton, EmptyState, EvidenceBadge, FieldLabel, InlineMessage, SectionHeading, Warning } from './maintenanceUi';
import type { SelectionColumn } from './SelectionTable';
import { SelectionTable } from './SelectionTable';

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

type Mode = 'simple' | 'advanced';
type Category = 'branches' | 'stashes' | 'worktrees';
type Step = 'scan' | 'review' | 'result';
type Scope = BranchCleanupCandidate['scope'];
type EvidenceFilter = 'all' | 'merged' | 'likely' | 'unmerged';
type AgeChoice = (typeof AGE_PRESETS)[number] | 'custom';

type CleanupOutcome<R> = { result?: R; error?: string };

type CleanupState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'error'; message: string }
  | {
      status: 'done';
      branches?: CleanupOutcome<BranchCleanupResult> & { candidates: Map<string, BranchCleanupCandidate> };
      artifacts?: CleanupOutcome<ArtifactCleanupResult> & { candidates: Map<string, ArtifactCleanupCandidate> };
    };

const DEFAULT_AGE_DAYS = 30;
const AUTOMATIC_BASE = '';
const CATEGORY_KIND: Record<Exclude<Category, 'branches'>, ArtifactCleanupCandidate['kind']> = {
  stashes: 'stash',
  worktrees: 'worktree'
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
  const customAgeId = useId();
  const baseInputId = useId();
  const searchInputId = useId();
  const acknowledgeId = useId();
  const mountedRef = useRef(true);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [lastKnownRefs, setLastKnownRefs] = useState(refs);
  const [mode, setMode] = useState<Mode>('simple');
  const [category, setCategory] = useState<Category>('branches');
  const [baseRef, setBaseRef] = useState(AUTOMATIC_BASE);
  const [ageChoice, setAgeChoice] = useState<AgeChoice>(DEFAULT_AGE_DAYS);
  const [customAgeText, setCustomAgeText] = useState(String(DEFAULT_AGE_DAYS));
  const [rules, setRules] = useState<SimpleRules>(DEFAULT_SIMPLE_RULES);
  const [scope, setScope] = useState<Scope>('local');
  const [evidenceFilter, setEvidenceFilter] = useState<EvidenceFilter>('all');
  const [includeUnverified, setIncludeUnverified] = useState(false);
  const [showIneligible, setShowIneligible] = useState(false);
  const [search, setSearch] = useState('');
  const [storedBranchSelection, setBranchSelection] = useState<ReadonlySet<string>>(new Set());
  const [storedArtifactSelection, setArtifactSelection] = useState<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = useState<{ id: string; viewKey: string }>();
  const [limitNotice, setLimitNotice] = useState<string>();
  const [step, setStep] = useState<Step>('scan');
  const [acknowledged, setAcknowledged] = useState(false);
  const [cleanup, setCleanup] = useState<CleanupState>({ status: 'idle' });
  const [isRefreshingRemotes, setIsRefreshingRemotes] = useState(false);
  const [notice, setNotice] = useState<string>();

  const branchScan = useLatestScan<BranchCriteria, BranchCleanupPlan>(mountedRef);
  const artifactScan = useLatestScan<number, ArtifactCleanupPlan>(mountedRef);

  if (refs && refs !== lastKnownRefs) {
    setLastKnownRefs(refs);
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const ageDays = ageChoice === 'custom' ? parseAgeDays(customAgeText) : ageChoice;
  const branchCriteria = useMemo(
    () => (ageDays === undefined ? undefined : { baseRef, olderThanDays: ageDays }),
    [baseRef, ageDays]
  );
  const isMutating = cleanup.status === 'running' || isRefreshingRemotes;

  const branchPlan = branchScan.result?.plan;
  const artifactPlan = artifactScan.result?.plan;
  const branchReady = Boolean(branchCriteria && branchScan.pending === undefined && isSameBranchCriteria(branchScan.result?.criteria, branchCriteria)
    && !isSameBranchCriteria(branchScan.error?.criteria, branchCriteria));
  const artifactReady = ageDays !== undefined && artifactScan.pending === undefined && artifactScan.result?.criteria === ageDays
    && artifactScan.error?.criteria !== ageDays;
  const branchError = branchCriteria && !branchScan.pending && isSameBranchCriteria(branchScan.error?.criteria, branchCriteria) ? branchScan.error?.message : undefined;
  const artifactError = ageDays !== undefined && artifactScan.pending === undefined && artifactScan.error?.criteria === ageDays ? artifactScan.error.message : undefined;
  const branchUpdating = Boolean(branchCriteria) && !branchReady && !branchError;
  const artifactUpdating = ageDays !== undefined && !artifactReady && !artifactError;
  const isUpdating = branchUpdating || artifactUpdating;

  function scanBranches(criteria: BranchCriteria): void {
    branchScan.run(criteria, () =>
      window.api.analyzeBranchCleanup(repoPath, { baseRef: criteria.baseRef || undefined, olderThanDays: criteria.olderThanDays })
    , 'Unable to scan branches.');
  }

  function scanArtifacts(olderThanDays: number): void {
    artifactScan.run(olderThanDays, () => window.api.analyzeArtifactCleanup(repoPath, { olderThanDays }), 'Unable to scan stashes and worktrees.');
  }

  function scanAll(): void {
    if (!branchCriteria || isMutating) {
      return;
    }

    setNotice(undefined);
    scanBranches(branchCriteria);
    scanArtifacts(branchCriteria.olderThanDays);
  }

  // Valid criteria edits rescan automatically after a short pause. The first
  // scan starts immediately. Older responses are discarded by `useLatestScan`.
  useEffect(() => {
    if (!branchCriteria) {
      return;
    }

    const hasScanned = Boolean(branchScan.result || branchScan.pending || branchScan.error);
    const timeout = window.setTimeout(() => {
      scanBranches(branchCriteria);

      if (artifactScan.result?.criteria !== branchCriteria.olderThanDays && artifactScan.pending !== branchCriteria.olderThanDays) {
        scanArtifacts(branchCriteria.olderThanDays);
      }
    }, hasScanned ? AUTO_SCAN_DELAY_MS : 0);

    return () => window.clearTimeout(timeout);
    // Only criteria changes schedule a scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchCriteria]);

  // New criteria invalidate any manual selection made against older results.
  function changeBaseRef(next: string): void {
    setBaseRef(next);
    setBranchSelection(new Set());
    setAcknowledged(false);
  }

  function changeAge(choice: AgeChoice, customText = customAgeText): void {
    setAgeChoice(choice);
    setCustomAgeText(customText);
    setBranchSelection(new Set());
    setArtifactSelection(new Set());
    setAcknowledged(false);
  }

  function changeCategory(next: Category): void {
    setCategory(next);
    setSearch('');
    setLimitNotice(undefined);
  }

  const selectableBranchIds = useMemo(
    () => new Set((branchPlan?.branches ?? []).filter((candidate) => isBranchSelectable(candidate, includeUnverified)).map((candidate) => candidate.ref)),
    [branchPlan, includeUnverified]
  );
  const selectableArtifactIds = useMemo(
    () => new Set((artifactPlan?.candidates ?? []).filter(isArtifactSelectable).map(artifactKey)),
    [artifactPlan]
  );

  // A refreshed plan keeps only items that are still eligible.
  const branchSelection = useMemo(() => pruneSelection(storedBranchSelection, selectableBranchIds), [storedBranchSelection, selectableBranchIds]);
  const artifactSelection = useMemo(
    () => pruneSelection(storedArtifactSelection, selectableArtifactIds),
    [storedArtifactSelection, selectableArtifactIds]
  );

  // Ranges are relative to the visible order, so any view change drops the anchor.
  const viewKey = [
    mode,
    category,
    scope,
    evidenceFilter,
    includeUnverified,
    showIneligible,
    search,
    branchPlan?.scannedAt,
    artifactPlan?.scannedAt
  ].join('\0');
  const anchorId = anchor?.viewKey === viewKey ? anchor.id : undefined;

  // Move focus to the step heading so screen readers announce the new step.
  const previousStepRef = useRef(step);
  useEffect(() => {
    if (previousStepRef.current !== step) {
      previousStepRef.current = step;
      titleRef.current?.focus({ preventScroll: true });
    }
  }, [step]);

  const baseOptions = useMemo(
    () => buildBaseOptions(lastKnownRefs, baseRef, branchPlan?.baseRef),
    [lastKnownRefs, baseRef, branchPlan?.baseRef]
  );
  const baseName = branchPlan ? shortRefName(branchPlan.baseRef) : 'the comparison branch';

  // --- Simple mode ---------------------------------------------------------

  const simpleBranches = useMemo(() => previewSimpleBranches(branchPlan?.branches ?? [], rules), [branchPlan, rules]);
  const simpleArtifacts = useMemo(
    () => previewSimpleArtifacts(artifactPlan?.candidates ?? [], rules, MAX_CLEANUP_ARTIFACTS),
    [artifactPlan, rules]
  );
  const anyBranchRule = rules.mergedLocal || rules.likelyLocal || rules.ageOnlyLocal || rules.mergedRemote;
  const anyArtifactRule = rules.stashes || rules.worktrees;

  // --- Selection for review -------------------------------------------------

  const selectedBranches = useMemo(() => {
    if (mode === 'simple') {
      return branchReady ? simpleBranches.selected : [];
    }

    return (branchPlan?.branches ?? []).filter((candidate) => branchSelection.has(candidate.ref)).sort(compareBranchCandidates);
  }, [mode, branchReady, simpleBranches, branchPlan, branchSelection]);
  const selectedArtifacts = useMemo(() => {
    if (mode === 'simple') {
      return artifactReady ? simpleArtifacts.selected : [];
    }

    return (artifactPlan?.candidates ?? []).filter((candidate) => artifactSelection.has(artifactKey(candidate))).sort(compareArtifactCandidates);
  }, [mode, artifactReady, simpleArtifacts, artifactPlan, artifactSelection]);
  const selectedStashes = selectedArtifacts.filter((candidate) => candidate.kind === 'stash');
  const selectedWorktrees = selectedArtifacts.filter((candidate) => candidate.kind === 'worktree');
  const selectedLocal = selectedBranches.filter((candidate) => candidate.scope === 'local');
  const selectedRemote = selectedBranches.filter((candidate) => candidate.scope === 'remote');
  const selectedHeuristic = selectedBranches.filter((candidate) => isHeuristicEvidence(candidate.evidence));
  const selectedUnverified = selectedBranches.filter((candidate) => isUnverifiedEvidence(candidate.evidence));
  const requiresAcknowledgement = selectedBranches.some((candidate) => candidate.evidence !== 'merged');
  const totalSelected = selectedBranches.length + selectedArtifacts.length;
  const needsBranchPlan = mode === 'simple' ? anyBranchRule : branchSelection.size > 0;
  const needsArtifactPlan = mode === 'simple' ? anyArtifactRule : artifactSelection.size > 0;
  const canReview =
    totalSelected > 0 &&
    (!needsBranchPlan || branchReady) &&
    (!needsArtifactPlan || artifactReady) &&
    selectedBranches.length <= MAX_CLEANUP_BRANCHES &&
    selectedArtifacts.length <= MAX_CLEANUP_ARTIFACTS &&
    !isMutating &&
    !isRepositoryBusy;
  const selectionSummary = summarizeSelection(selectedBranches.length, selectedStashes.length, selectedWorktrees.length);

  // --- Advanced mode --------------------------------------------------------

  const artifactKind = category === 'branches' ? undefined : CATEGORY_KIND[category];
  const tableReady = category === 'branches' ? branchReady : artifactReady;
  const tableEnabled = tableReady && !isMutating;
  const showsUnanalyzed = showIneligible && evidenceFilter === 'all';

  const visibleBranches = useMemo(
    () =>
      (branchPlan?.branches ?? [])
        .filter((candidate) => candidate.scope === scope)
        .filter((candidate) => {
          // Protected and recent branches have no merge evidence, so evidence
          // filters do not apply. They appear only in the unfiltered list.
          if (!isAnalyzed(candidate)) {
            return showsUnanalyzed;
          }

          return matchesEvidenceFilter(candidate.evidence, evidenceFilter) && (includeUnverified || !isUnverifiedEvidence(candidate.evidence));
        })
        .filter((candidate) => matchesSearch(search, [candidate.name, candidate.ref]))
        .sort(compareBranchCandidates),
    [branchPlan, scope, evidenceFilter, includeUnverified, showsUnanalyzed, search]
  );
  const visibleArtifacts = useMemo(
    () =>
      (artifactPlan?.candidates ?? [])
        .filter((candidate) => candidate.kind === artifactKind)
        .filter((candidate) => showIneligible || isArtifactSelectable(candidate))
        .filter((candidate) => matchesSearch(search, [candidate.name, candidate.id, candidate.branch]))
        .sort(compareArtifactCandidates),
    [artifactPlan, artifactKind, showIneligible, search]
  );

  const branchCounts = useMemo(() => countBranches(branchPlan?.branches ?? [], scope), [branchPlan, scope]);
  const artifactCounts = useMemo(() => countArtifacts(artifactPlan?.candidates ?? []), [artifactPlan]);
  const isBranchTable = category === 'branches';
  const tableSelection = isBranchTable ? branchSelection : artifactSelection;
  const tableLimit = isBranchTable ? MAX_CLEANUP_BRANCHES : MAX_CLEANUP_ARTIFACTS;
  const tableNoun = isBranchTable ? 'branches' : artifactKind ? ARTIFACT_NOUNS[artifactKind].many : 'items';
  const isTableAtLimit = tableSelection.size >= tableLimit;

  const visibleLimitNotice = isTableAtLimit ? limitNotice : undefined;

  function applySelectionChange(change: SelectionChange, requested: number): void {
    const current = isBranchTable ? branchSelection : artifactSelection;
    const added = change.next.size - current.size;
    (isBranchTable ? setBranchSelection : setArtifactSelection)(change.next);
    setAcknowledged(false);
    setLimitNotice(
      change.skipped > 0
        ? `Selected ${added} of ${requested} ${tableNoun}. A cleanup can delete up to ${tableLimit} ${isBranchTable ? 'branches' : 'stashes and worktrees'}; delete these first, then scan again for the rest.`
        : undefined
    );
  }

  function visibleIdsAndEligible(): { ordered: string[]; eligible: Set<string> } {
    if (isBranchTable) {
      return {
        ordered: visibleBranches.map((candidate) => candidate.ref),
        eligible: new Set(visibleBranches.filter((candidate) => isBranchSelectable(candidate, includeUnverified)).map((candidate) => candidate.ref))
      };
    }

    return {
      ordered: visibleArtifacts.map(artifactKey),
      eligible: new Set(visibleArtifacts.filter(isArtifactSelectable).map(artifactKey))
    };
  }

  function handleRowClick(id: string, shift: boolean): void {
    if (!tableEnabled) {
      return;
    }

    const { ordered, eligible } = visibleIdsAndEligible();
    const change = applyRowClick({ current: tableSelection, orderedIds: ordered, eligibleIds: eligible, anchorId, targetId: id, shift, limit: tableLimit });
    const requested = change.next.size - tableSelection.size + change.skipped;
    applySelectionChange(change, requested);
    setAnchor({ id, viewKey });
  }

  function handleToggleAll(): void {
    if (!tableEnabled) {
      return;
    }

    const { ordered, eligible } = visibleIdsAndEligible();
    const ids = ordered.filter((id) => eligible.has(id));
    const change = toggleAllVisible(tableSelection, ids, tableLimit);
    applySelectionChange(change, ids.filter((id) => !tableSelection.has(id)).length);
    setAnchor(undefined);
  }

  function handleClearSelection(): void {
    setBranchSelection(new Set());
    setArtifactSelection(new Set());
    setAcknowledged(false);
    setLimitNotice(undefined);
    setAnchor(undefined);
  }

  function switchMode(next: Mode): void {
    if (next === mode) {
      return;
    }

    if (next === 'advanced') {
      // Advanced starts from whatever the simple rules currently select.
      const seededBranches = branchReady ? simpleBranches.selected : [];
      setBranchSelection(new Set(seededBranches.map((candidate) => candidate.ref)));
      setArtifactSelection(new Set(artifactReady ? simpleArtifacts.selected.map(artifactKey) : []));

      if (seededBranches.some((candidate) => isUnverifiedEvidence(candidate.evidence))) {
        setIncludeUnverified(true);
      }
    }

    setMode(next);
    setAcknowledged(false);
    setLimitNotice(undefined);
  }

  // --- Mutations ------------------------------------------------------------

  function handleClose(): void {
    if (!isMutating) {
      onClose();
    }
  }

  async function handleRefreshRemotes(): Promise<void> {
    if (isMutating || !branchCriteria) {
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
        setNotice(failure ?? 'Another Git operation is running for this repository. Try again when it finishes.');
        return;
      }
    } finally {
      if (mountedRef.current) {
        setIsRefreshingRemotes(false);
      }
    }

    scanBranches(branchCriteria);
  }

  async function handleConfirmCleanup(): Promise<void> {
    if (!canReview || (requiresAcknowledgement && !acknowledged)) {
      return;
    }

    const branchInput: BranchCleanupInput | undefined = selectedBranches.length > 0 && branchPlan
      ? {
          baseRef: branchPlan.baseRef,
          expectedBaseSha: branchPlan.baseSha,
          olderThanDays: branchPlan.olderThanDays,
          branches: selectedBranches.map((candidate) => ({ ref: candidate.ref, expectedSha: candidate.sha })),
          allowUnverified: requiresAcknowledgement && acknowledged
        }
      : undefined;
    const artifactInput: ArtifactCleanupInput | undefined = selectedArtifacts.length > 0 && artifactPlan
      ? {
          olderThanDays: artifactPlan.olderThanDays,
          items: selectedArtifacts.map((candidate) => ({ kind: candidate.kind, id: candidate.id, expectedSha: candidate.sha }))
        }
      : undefined;
    const branchCandidates = new Map(selectedBranches.map((candidate) => [candidate.ref, candidate]));
    const artifactCandidates = new Map(selectedArtifacts.map((candidate) => [artifactKey(candidate), candidate]));
    const done: Extract<CleanupState, { status: 'done' }> = { status: 'done' };

    setCleanup({ status: 'running' });

    if (branchInput) {
      const count = branchInput.branches.length;
      const outcome = await runCleanup(`Delete ${countLabel(count, 'branch', 'branches')}`, (path) => window.api.cleanupBranches(path, branchInput), 'Unable to delete branches.');

      if (!mountedRef.current) {
        return;
      }

      // Nothing was deleted: stay on the review so nothing else runs unexpectedly.
      if (!outcome.result) {
        setCleanup({ status: 'error', message: `${outcome.error ?? 'Branch cleanup did not run.'} Nothing was deleted.` });
        return;
      }

      done.branches = { ...outcome, candidates: branchCandidates };
    }

    if (artifactInput) {
      const label = summarizeSelection(0, selectedStashes.length, selectedWorktrees.length);
      const outcome = await runCleanup(`Delete ${label}`, (path) => window.api.cleanupArtifacts(path, artifactInput), 'Unable to delete stashes and worktrees.');

      if (!mountedRef.current) {
        return;
      }

      if (!outcome.result && !done.branches) {
        setCleanup({ status: 'error', message: `${outcome.error ?? 'Cleanup did not run.'} Nothing was deleted.` });
        return;
      }

      done.artifacts = { ...outcome, candidates: artifactCandidates };
    }

    handleClearSelection();
    setCleanup(done);
    setStep('result');
  }

  async function runCleanup<R extends GitOperationResult>(
    label: string,
    action: (path: string) => Promise<R>,
    fallback: string
  ): Promise<CleanupOutcome<R>> {
    let result: R | undefined;
    let failure: string | undefined;
    const completed = await runOperation(label, async (path) => {
      try {
        result = await action(path);
        return result;
      } catch (error) {
        failure = errorMessage(error, fallback);
        throw error;
      }
    });

    return result
      ? { result }
      : { error: failure ?? (completed ? 'Cleanup finished without a result.' : 'Another Git operation is running for this repository. Try again when it finishes.') };
  }

  function handleBackToScan(rescan: boolean): void {
    setStep('scan');
    setCleanup({ status: 'idle' });
    setAcknowledged(false);

    if (rescan) {
      scanAll();
    }
  }

  // --- Render ---------------------------------------------------------------

  const title = step === 'review' ? 'Review cleanup' : step === 'result' ? 'Cleanup results' : 'Repository maintenance';
  const warnings = [
    ...(mode === 'simple' || category === 'branches' ? branchPlan?.warnings ?? [] : []),
    ...(mode === 'simple' || category !== 'branches' ? artifactPlan?.warnings ?? [] : [])
  ];

  return (
    <ModalSurface
      labelledBy={titleId}
      describedBy={descriptionId}
      className="flex h-[min(780px,92vh)] w-full max-w-[1040px] flex-col overflow-hidden rounded-md border border-[var(--border-strong)] bg-[var(--bg-panel)] shadow-2xl shadow-black/60"
      backdropClassName="fixed inset-0 z-50 grid place-items-center bg-black/45 px-4 py-4"
      onClose={handleClose}
    >
      <header className="flex min-h-12 items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-graph-header)] px-4 py-2">
        <GitBranch size={17} className="shrink-0 text-[var(--accent-2)]" />
        <div className="min-w-0 flex-1">
          <h2 ref={titleRef} id={titleId} tabIndex={-1} className="text-sm font-semibold text-[var(--text-1)] outline-none">{title}</h2>
          <p id={descriptionId} className="mt-0.5 truncate text-[11px] text-[var(--text-3)]" title={repoPath}>
            Clean up branches, stashes, and worktrees in {repoName ?? repoPath}
          </p>
        </div>
        {step === 'scan' ? (
          <div className="segmented" role="group" aria-label="Maintenance view">
            {(['simple', 'advanced'] as const).map((item) => (
              <button key={item} type="button" data-active={mode === item} aria-pressed={mode === item} disabled={isMutating} onClick={() => switchMode(item)}>
                {item === 'simple' ? 'Simple' : 'Advanced'}
              </button>
            ))}
          </div>
        ) : null}
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
          <div className="flex flex-wrap items-end gap-x-3 gap-y-2 border-b border-[var(--border)] px-4 py-2.5" role="group" aria-label="Cleanup criteria">
            <div>
              <FieldLabel>Older than</FieldLabel>
              <div className="flex items-center gap-2">
                <div
                  className="segmented"
                  role="group"
                  aria-label="Older than"
                  title="Branches: last commit. Stashes: when they were created. Worktrees: last checkout or commit."
                >
                  {AGE_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      data-active={ageChoice === preset}
                      aria-pressed={ageChoice === preset}
                      disabled={isMutating}
                      onClick={() => changeAge(preset)}
                    >
                      {preset} days
                    </button>
                  ))}
                  <button
                    type="button"
                    data-active={ageChoice === 'custom'}
                    aria-pressed={ageChoice === 'custom'}
                    disabled={isMutating}
                    onClick={() => {
                      if (ageChoice !== 'custom') {
                        changeAge('custom', ageDays === undefined ? customAgeText : String(ageDays));
                      }
                    }}
                  >
                    Custom
                  </button>
                </div>
                {ageChoice === 'custom' ? (
                  <span className="relative block w-24">
                    <input
                      id={customAgeId}
                      className="inspector-input h-[31px] pr-10 tabular-nums"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={MAX_AGE_DAYS}
                      step={1}
                      value={customAgeText}
                      disabled={isMutating}
                      aria-label="Custom age in days"
                      aria-invalid={ageDays === undefined}
                      aria-describedby={ageDays === undefined ? `${customAgeId}-error` : undefined}
                      onChange={(event) => changeAge('custom', event.target.value)}
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-2.5 grid place-items-center text-[11px] text-[var(--text-3)]">days</span>
                  </span>
                ) : null}
              </div>
            </div>
            <label className="block min-w-[160px] flex-1" htmlFor={baseInputId}>
              <FieldLabel>Compare branches with</FieldLabel>
              <select
                id={baseInputId}
                className="inspector-input h-[31px]"
                value={baseRef}
                disabled={isMutating}
                onChange={(event) => changeBaseRef(event.target.value)}
              >
                <option value={AUTOMATIC_BASE}>
                  Default branch{branchPlan && branchScan.result?.criteria.baseRef === AUTOMATIC_BASE ? ` (${shortRefName(branchPlan.baseRef)})` : ''}
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
            <button
              className="btn-subtle btn-regular shrink-0"
              type="button"
              disabled={!branchCriteria || isMutating}
              onClick={scanAll}
              title="Scan again with the current criteria. Scanning never changes the repository."
            >
              {isUpdating ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
              Scan again
            </button>
            <button
              className="btn-subtle btn-regular shrink-0"
              type="button"
              disabled={isMutating || isRepositoryBusy || !branchCriteria}
              onClick={() => void handleRefreshRemotes()}
              title="Fetch the branch list from every remote and remove local copies of branches already deleted there. Nothing is deleted on a remote."
            >
              {isRefreshingRemotes ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Update remote branches
            </button>
          </div>

          <ScanStatus
            invalidAge={ageDays === undefined}
            ageErrorId={`${customAgeId}-error`}
            isUpdating={isUpdating}
            isRefreshingRemotes={isRefreshingRemotes}
            branchError={branchError}
            artifactError={artifactError}
            scannedAt={branchReady ? branchPlan?.scannedAt : artifactReady ? artifactPlan?.scannedAt : undefined}
            hasResults={Boolean(branchPlan || artifactPlan)}
            baseName={branchReady ? baseName : undefined}
            onRetry={scanAll}
          />
          {notice ? <InlineMessage tone="error">{notice}</InlineMessage> : null}
          {warnings.length > 0 ? (
            <InlineMessage tone="warning">
              <ul className="grid gap-0.5">
                {Array.from(new Set(warnings)).map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </InlineMessage>
          ) : null}

          {mode === 'simple' ? (
            <SimplePanel
              rules={rules}
              onChangeRules={(next) => {
                setRules(next);
                setAcknowledged(false);
              }}
              disabled={isMutating}
              ageDays={ageDays}
              baseName={baseName}
              branchPlan={branchPlan}
              artifactPlan={artifactPlan}
              branchReady={branchReady}
              artifactReady={artifactReady}
              branchPreview={simpleBranches}
              artifactPreview={simpleArtifacts}
              onOpenAdvanced={(nextCategory) => {
                switchMode('advanced');
                changeCategory(nextCategory);
              }}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--border)] px-4 py-2">
                <div className="segmented" role="group" aria-label="Category">
                  {([
                    ['branches', 'Branches', branchPlan?.branches.length],
                    ['stashes', 'Stashes', artifactCounts.stash.total],
                    ['worktrees', 'Worktrees', artifactCounts.worktree.total]
                  ] as const).map(([id, label, count]) => (
                    <button key={id} type="button" data-active={category === id} aria-pressed={category === id} onClick={() => changeCategory(id)}>
                      {label}
                      {count !== undefined && (id === 'branches' ? branchPlan : artifactPlan) ? (
                        <span className="tabular-nums text-[var(--text-3)]">{count}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
                <label className="relative block w-56 max-w-full" htmlFor={searchInputId}>
                  <span className="sr-only">Search {category}</span>
                  <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-3)]" aria-hidden />
                  <input
                    id={searchInputId}
                    className="inspector-input h-[29px] pl-7"
                    type="search"
                    value={search}
                    placeholder={category === 'branches' ? 'Search branches' : category === 'stashes' ? 'Search message or branch' : 'Search path or branch'}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <span className="flex-1" />
                <label className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-2)]">
                  <input type="checkbox" checked={showIneligible} onChange={(event) => setShowIneligible(event.target.checked)} />
                  Show protected and recent
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--border)] px-4 py-1.5 text-[11px] text-[var(--text-3)]">
                {isBranchTable ? (
                  <>
                    <div className="segmented" role="group" aria-label="Branch location">
                      {(['local', 'remote'] as const).map((item) => (
                        <button key={item} type="button" data-active={scope === item} aria-pressed={scope === item} onClick={() => setScope(item)}>
                          {item === 'local' ? 'Local' : 'Remote'}
                          <span className="tabular-nums text-[var(--text-3)]">
                            {(branchPlan?.branches ?? []).filter((candidate) => candidate.scope === item).length}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="segmented" role="group" aria-label="Filter by merge status">
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
                      Include not merged
                    </label>
                    <HiddenSummary
                      parts={[
                        showsUnanalyzed ? 0 : branchCounts.protectedCount,
                        showsUnanalyzed ? 0 : branchCounts.recentCount,
                        includeUnverified ? 0 : branchCounts.unverifiedCount
                      ]}
                      ageDays={branchPlan?.olderThanDays}
                    />
                  </>
                ) : (
                  <>
                    <span>
                      {category === 'stashes'
                        ? 'Deleting a stash discards its saved changes from the stash list. A recovery ref keeps them restorable.'
                        : 'Removing a worktree deletes its folder. Its branch and commits are kept.'}
                    </span>
                    {artifactKind ? (
                      <HiddenSummary
                        parts={[
                          showIneligible ? 0 : artifactCounts[artifactKind].protectedCount,
                          showIneligible ? 0 : artifactCounts[artifactKind].recentCount,
                          0
                        ]}
                        ageDays={artifactPlan?.olderThanDays}
                      />
                    ) : null}
                  </>
                )}
                <span className="flex-1" />
                <button
                  className="btn-subtle btn-compact"
                  type="button"
                  disabled={branchSelection.size + artifactSelection.size === 0 || isMutating}
                  onClick={handleClearSelection}
                >
                  Clear selection
                </button>
              </div>

              {visibleLimitNotice ? <InlineMessage tone="info">{visibleLimitNotice}</InlineMessage> : null}

              <div
                className={`min-h-0 flex-1 overflow-auto transition-opacity ${tableReady ? '' : 'opacity-60'}`}
                aria-busy={category === 'branches' ? branchUpdating : artifactUpdating}
              >
                {isBranchTable ? (
                  !branchPlan ? (
                    <PlanPlaceholder updating={branchUpdating} error={branchError} noun="branches" />
                  ) : visibleBranches.length === 0 ? (
                    <EmptyState>
                      {search ? `No ${scope} branches match “${search}”.` : `No ${scope} branches match. Try a lower age, another comparison branch, or show more branches.`}
                    </EmptyState>
                  ) : (
                    <SelectionTable
                      items={visibleBranches}
                      columns={branchColumns(baseName)}
                      getId={(candidate) => candidate.ref}
                      getName={(candidate) => candidate.name}
                      pluralNoun="branches"
                      isEligible={(candidate) => isBranchSelectable(candidate, includeUnverified)}
                      isProtected={(candidate) => Boolean(candidate.protectedReason)}
                      selected={branchSelection}
                      disabled={!tableEnabled}
                      isAtLimit={branchSelection.size >= MAX_CLEANUP_BRANCHES}
                      limitTitle={`A cleanup can delete up to ${MAX_CLEANUP_BRANCHES} branches`}
                      onToggleAll={handleToggleAll}
                      onRowClick={handleRowClick}
                    />
                  )
                ) : !artifactPlan ? (
                  <PlanPlaceholder updating={artifactUpdating} error={artifactError} noun={category} />
                ) : visibleArtifacts.length === 0 ? (
                  <EmptyState>
                    {search
                      ? `No ${category} match “${search}”.`
                      : artifactKind && artifactCounts[artifactKind].total > 0
                        ? `No ${category} can be cleaned up with these criteria. Try a lower age or show protected and recent ${category}.`
                        : `This repository has no ${category === 'stashes' ? 'stashes' : 'linked worktrees'}.`}
                  </EmptyState>
                ) : (
                  <SelectionTable
                    items={visibleArtifacts}
                    columns={category === 'stashes' ? STASH_COLUMNS : WORKTREE_COLUMNS}
                    getId={artifactKey}
                    getName={(candidate) => candidate.kind === 'worktree' ? candidate.id : candidate.name}
                    pluralNoun={category}
                    isEligible={isArtifactSelectable}
                    isProtected={(candidate) => Boolean(candidate.protectedReason)}
                    selected={artifactSelection}
                    disabled={!tableEnabled}
                    isAtLimit={artifactSelection.size >= MAX_CLEANUP_ARTIFACTS}
                    limitTitle={`A cleanup can delete up to ${MAX_CLEANUP_ARTIFACTS} stashes and worktrees`}
                    onToggleAll={handleToggleAll}
                    onRowClick={handleRowClick}
                  />
                )}
              </div>
            </>
          )}

          <footer className="flex items-center gap-3 border-t border-[var(--border)] bg-[var(--bg-graph-header)] px-4 py-2.5">
            <p className="min-w-0 flex-1 text-[11.5px] leading-4 text-[var(--text-2)]" role="status" aria-live="polite">
              {footerMessage({
                mode,
                total: totalSelected,
                summary: selectionSummary,
                isUpdating: (needsBranchPlan && branchUpdating) || (needsArtifactPlan && artifactUpdating),
                scanFailed: (needsBranchPlan && Boolean(branchError)) || (needsArtifactPlan && Boolean(artifactError)),
                isRepositoryBusy,
                branchAtLimit: mode === 'advanced' && branchSelection.size >= MAX_CLEANUP_BRANCHES,
                artifactAtLimit: mode === 'advanced' && artifactSelection.size >= MAX_CLEANUP_ARTIFACTS,
                overflow: mode === 'simple' ? simpleBranches.overflow + simpleArtifacts.overflow : 0
              })}
            </p>
            <button className="btn-subtle btn-regular" type="button" onClick={handleClose} disabled={isMutating}>
              Close
            </button>
            <button
              className="btn-primary btn-regular"
              type="button"
              disabled={!canReview}
              onClick={() => {
                setAcknowledged(false);
                setCleanup({ status: 'idle' });
                setStep('review');
              }}
            >
              Review cleanup…
            </button>
          </footer>
        </>
      ) : step === 'review' ? (
        <>
          <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
            <p className="text-xs leading-4 text-[var(--text-2)]">
              Everything is checked again before deletion. Anything that changed since the scan is not deleted, and you need to scan again.
              {selectedBranches.length > 0 && branchPlan ? (
                <>
                  {' '}Branches are compared with <span className="mono">{shortRefName(branchPlan.baseRef)}</span> at{' '}
                  <span className="mono">{branchPlan.baseSha.slice(0, 8)}</span>; a local recovery ref keeps the reviewed commit of every deleted branch.
                  {selectedRemote.length > 0 ? ' Problems on a remote server are reported per branch.' : ''}
                </>
              ) : null}
            </p>

            <div className="mt-3 grid gap-2">
              {selectedRemote.length > 0 ? (
                <Warning tone="danger">
                  {countLabel(selectedRemote.length, 'remote branch is', 'remote branches are')} deleted on the server
                  ({formatList(Array.from(new Set(selectedRemote.map((candidate) => candidate.remote ?? 'remote'))))}). This affects everyone using that remote.
                </Warning>
              ) : null}
              {selectedHeuristic.length > 0 ? (
                <Warning tone="warning">
                  {countLabel(selectedHeuristic.length, 'branch looks', 'branches look')} integrated because matching changes or content are in the
                  comparison branch. This is likely but not proof that no work is lost.
                </Warning>
              ) : null}
              {selectedUnverified.length > 0 ? (
                <Warning tone="danger">
                  {countLabel(selectedUnverified.length, 'branch is', 'branches are')} selected by age only. {pluralize(selectedUnverified.length, 'It', 'They')} may
                  contain work that is not in the comparison branch; afterwards the reviewed commits remain only in local recovery refs.
                </Warning>
              ) : null}
              {selectedStashes.length > 0 ? (
                <Warning tone="warning">
                  {countLabel(selectedStashes.length, 'stash', 'stashes')} with saved changes will be removed from the stash list. A recovery ref keeps each
                  one, and the results show a command that puts it back.
                </Warning>
              ) : null}
              {selectedWorktrees.length > 0 ? (
                <Warning tone="warning">
                  {countLabel(selectedWorktrees.length, 'worktree folder is', 'worktree folders are')} removed from disk, including ignored files such as
                  build output or dependencies. Branches and commits are kept, and a backup ref records each checked-out commit.
                </Warning>
              ) : null}
            </div>

            <ReviewGroup title="Local branches" items={selectedLocal.map((candidate) => ({
              key: candidate.ref,
              name: candidate.name,
              age: formatAge(candidate.ageDays),
              badge: <EvidenceBadge candidate={candidate} />
            }))} />
            <ReviewGroup title="Remote branches" items={selectedRemote.map((candidate) => ({
              key: candidate.ref,
              name: candidate.name,
              age: formatAge(candidate.ageDays),
              badge: <EvidenceBadge candidate={candidate} />
            }))} />
            <ReviewGroup title="Stashes" items={selectedStashes.map((candidate) => ({
              key: artifactKey(candidate),
              name: candidate.name,
              detail: candidate.id,
              age: formatAge(candidate.ageDays)
            }))} />
            <ReviewGroup title="Worktrees" items={selectedWorktrees.map((candidate) => ({
              key: artifactKey(candidate),
              name: candidate.id,
              detail: candidate.branch ? `Keeps branch ${shortRefName(candidate.branch)}` : 'Detached HEAD',
              age: formatAge(candidate.ageDays)
            }))} />

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
              <p className="min-w-0 flex-1 text-[11.5px] text-[var(--text-2)]">
                {selectedBranches.length > 0 ? 'All selected branches are fully merged.' : 'Review the items above before deleting.'}
              </p>
            )}
            <button
              className="btn-subtle btn-regular"
              type="button"
              disabled={isMutating}
              onClick={() => handleBackToScan(cleanup.status === 'error')}
            >
              <ArrowLeft size={13} />
              Back
            </button>
            <button
              className="btn-subtle btn-regular border-[var(--danger-border)] text-[var(--danger-text)]"
              type="button"
              disabled={isMutating || !canReview || cleanup.status === 'error' || (requiresAcknowledgement && !acknowledged)}
              onClick={() => void handleConfirmCleanup()}
            >
              {cleanup.status === 'running' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              {cleanup.status === 'running' ? 'Deleting…' : `Delete ${selectionSummary}`}
            </button>
          </footer>
        </>
      ) : step === 'result' && cleanup.status === 'done' ? (
        <>
          <CleanupResultView state={cleanup} />
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

// --- Scanning ----------------------------------------------------------------

type LatestScan<C, P> = {
  result?: { criteria: C; plan: P };
  /** Criteria of the request in flight. */
  pending?: C;
  error?: { criteria: C; message: string };
  run: (criteria: C, request: () => Promise<P>, fallbackError: string) => void;
};

/** Runs read-only scans, keeping only the response to the latest request. */
function useLatestScan<C, P>(mountedRef: { current: boolean }): LatestScan<C, P> {
  const generationRef = useRef(0);
  const [state, setState] = useState<Omit<LatestScan<C, P>, 'run'>>({});

  function run(criteria: C, request: () => Promise<P>, fallbackError: string): void {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setState((current) => ({ result: current.result, pending: criteria }));

    request().then(
      (plan) => {
        if (mountedRef.current && generationRef.current === generation) {
          setState({ result: { criteria, plan } });
        }
      },
      (error: unknown) => {
        if (mountedRef.current && generationRef.current === generation) {
          setState((current) => ({ result: current.result, error: { criteria, message: errorMessage(error, fallbackError) } }));
        }
      }
    );
  }

  return { ...state, run };
}

function ScanStatus({
  invalidAge,
  ageErrorId,
  isUpdating,
  isRefreshingRemotes,
  branchError,
  artifactError,
  scannedAt,
  hasResults,
  baseName,
  onRetry
}: {
  invalidAge: boolean;
  ageErrorId: string;
  isUpdating: boolean;
  isRefreshingRemotes: boolean;
  branchError?: string;
  artifactError?: string;
  scannedAt?: string;
  hasResults: boolean;
  baseName?: string;
  onRetry: () => void;
}): ReactElement {
  if (invalidAge) {
    return (
      <InlineMessage tone="error">
        <span id={ageErrorId}>Enter a whole number of days from 0 to {MAX_AGE_DAYS}. Results update when the age is valid.</span>
      </InlineMessage>
    );
  }

  const errors = [branchError ? `Branches: ${branchError}` : undefined, artifactError ? `Stashes and worktrees: ${artifactError}` : undefined].filter(Boolean);

  return (
    <>
      {errors.length > 0 ? (
        <InlineMessage tone="error">
          <span className="flex flex-wrap items-center gap-x-2">
            <span>{errors.join(' ')}</span>
            <button className="review-comment-action" type="button" onClick={onRetry}>Retry</button>
          </span>
        </InlineMessage>
      ) : null}
      <div className="flex min-h-7 items-center gap-2 border-b border-[var(--border)] px-4 py-1 text-[11px] text-[var(--text-3)]" role="status" aria-live="polite">
        {isUpdating || isRefreshingRemotes ? (
          <>
            <Loader2 size={12} className="shrink-0 animate-spin text-[var(--accent-2)]" aria-hidden />
            <span>
              {isRefreshingRemotes ? 'Updating remote branches…' : hasResults ? 'Updating results for the current criteria…' : 'Scanning branches, stashes, and worktrees…'}
              {' '}Selection is paused until the scan finishes and resumes automatically.
            </span>
          </>
        ) : scannedAt ? (
          <span>
            Scanned {formatTime(scannedAt)}{baseName ? <> · branches compared with <span className="mono text-[var(--text-2)]">{baseName}</span></> : null}.
            {' '}Scanning is read-only; nothing changes until you review and confirm.
          </span>
        ) : (
          <span>Scanning is read-only; nothing changes until you review and confirm.</span>
        )}
      </div>
    </>
  );
}

function PlanPlaceholder({ updating, error, noun }: { updating: boolean; error?: string; noun: string }): ReactElement {
  return (
    <EmptyState>
      {updating ? (
        <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Scanning {noun}…</span>
      ) : error ? (
        `The ${noun} scan did not complete. Retry or adjust the criteria.`
      ) : (
        `Enter valid criteria to scan ${noun}.`
      )}
    </EmptyState>
  );
}

// --- Simple mode -------------------------------------------------------------

function SimplePanel({
  rules,
  onChangeRules,
  disabled,
  ageDays,
  baseName,
  branchPlan,
  artifactPlan,
  branchReady,
  artifactReady,
  branchPreview,
  artifactPreview,
  onOpenAdvanced
}: {
  rules: SimpleRules;
  onChangeRules: (rules: SimpleRules) => void;
  disabled: boolean;
  ageDays: number | undefined;
  baseName: string;
  branchPlan?: BranchCleanupPlan;
  artifactPlan?: ArtifactCleanupPlan;
  branchReady: boolean;
  artifactReady: boolean;
  branchPreview: ReturnType<typeof previewSimpleBranches>;
  artifactPreview: ReturnType<typeof previewSimpleArtifacts>;
  onOpenAdvanced: (category: Category) => void;
}): ReactElement {
  const ageText = ageDays === undefined ? 'the chosen age' : `${ageDays} ${pluralize(ageDays, 'day', 'days')}`;
  const branchCounts = branchPlan ? countBranches(branchPlan.branches) : undefined;
  const artifactCounts = artifactPlan ? countArtifacts(artifactPlan.candidates) : undefined;
  const branchCount = (rule: BranchRule): number | undefined => (branchReady ? branchPreview.counts[rule] : undefined);

  function toggle(key: keyof SimpleRules, value: boolean): void {
    onChangeRules({ ...rules, [key]: value });
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
      <div className="grid gap-4">
        <section aria-labelledby="maintenance-simple-branches">
          <SimpleSectionHeading id="maintenance-simple-branches" onOpen={() => onOpenAdvanced('branches')} label="branches">
            Branches
          </SimpleSectionHeading>
          <div className="divide-y divide-[var(--border)] rounded border border-[var(--border)]">
            <RuleRow
              checked={rules.mergedLocal}
              disabled={disabled}
              onChange={(value) => toggle('mergedLocal', value)}
              title="Merged local branches"
              description={`Every commit is already in ${baseName}. Safest choice.`}
              count={branchCount('mergedLocal')}
              badge={<Badge tone="success">Recommended</Badge>}
            />
            <RuleRow
              checked={rules.likelyLocal}
              disabled={disabled}
              onChange={(value) => toggle('likelyLocal', value)}
              title="Likely integrated local branches"
              description={`Matching changes or content are in ${baseName}, as after a squash or rebase. Likely, not proven.`}
              count={branchCount('likelyLocal')}
              badge={<Badge tone="warning">Needs confirmation</Badge>}
            />
            <RuleRow
              checked={rules.ageOnlyLocal}
              disabled={disabled}
              onChange={(value) => toggle('ageOnlyLocal', value)}
              title={`Every other local branch older than ${ageText}`}
              description={`Selected by age alone. These may contain work that is not in ${baseName}.`}
              count={branchCount('ageOnlyLocal')}
              badge={<Badge tone="danger">Age only</Badge>}
            />
            <RuleRow
              checked={rules.mergedRemote}
              disabled={disabled}
              onChange={(value) => toggle('mergedRemote', value)}
              title="Merged remote branches"
              description="Deletes the branch on the server for everyone using it. Update remote branches first for current results."
              count={branchCount('mergedRemote')}
              badge={<Badge tone="danger">Shared</Badge>}
            />
          </div>
          {branchCounts ? (
            <NeverIncluded
              parts={[
                branchCounts.protectedCount > 0 ? `${branchCounts.protectedCount} protected` : undefined,
                branchCounts.recentCount > 0 ? `${branchCounts.recentCount} newer than ${ageText}` : undefined
              ]}
            />
          ) : null}
        </section>

        <section aria-labelledby="maintenance-simple-stashes">
          <SimpleSectionHeading id="maintenance-simple-stashes" onOpen={() => onOpenAdvanced('stashes')} label="stashes">
            Stashes
          </SimpleSectionHeading>
          <div className="rounded border border-[var(--border)]">
            <RuleRow
              checked={rules.stashes}
              disabled={disabled}
              onChange={(value) => toggle('stashes', value)}
              title={`Stashes older than ${ageText}`}
              description="Removes their saved changes from the stash list. A recovery ref keeps each one restorable."
              count={artifactReady ? artifactPreview.counts.stash : undefined}
            />
          </div>
          {artifactCounts ? (
            <NeverIncluded parts={[artifactCounts.stash.recentCount > 0 ? `${artifactCounts.stash.recentCount} newer than ${ageText}` : undefined]} />
          ) : null}
        </section>

        <section aria-labelledby="maintenance-simple-worktrees">
          <SimpleSectionHeading id="maintenance-simple-worktrees" onOpen={() => onOpenAdvanced('worktrees')} label="worktrees">
            Worktrees
          </SimpleSectionHeading>
          <div className="rounded border border-[var(--border)]">
            <RuleRow
              checked={rules.worktrees}
              disabled={disabled}
              onChange={(value) => toggle('worktrees', value)}
              title={`Worktrees unused for ${ageText}`}
              description="Removes each worktree folder from disk. Branches and commits are kept. Worktrees with changes are never removed."
              count={artifactReady ? artifactPreview.counts.worktree : undefined}
            />
          </div>
          {artifactCounts ? (
            <NeverIncluded
              parts={[
                artifactCounts.worktree.protectedCount > 0
                  ? `${artifactCounts.worktree.protectedCount} protected (${summarizeReasons(artifactPlan?.candidates.filter((candidate) => candidate.kind === 'worktree') ?? [])})`
                  : undefined,
                artifactCounts.worktree.recentCount > 0 ? `${artifactCounts.worktree.recentCount} used within ${ageText}` : undefined
              ]}
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}

function SimpleSectionHeading({ id, label, onOpen, children }: { id: string; label: string; onOpen: () => void; children: ReactNode }): ReactElement {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <h3 id={id} className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-3)]">{children}</h3>
      <span className="flex-1" />
      <button className="review-comment-action" type="button" onClick={onOpen} aria-label={`Review ${label} individually in Advanced view`}>
        Choose individually
      </button>
    </div>
  );
}

function RuleRow({
  checked,
  disabled,
  onChange,
  title,
  description,
  count,
  badge
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
  title: string;
  description: string;
  /** Undefined while results are updating. */
  count: number | undefined;
  badge?: ReactNode;
}): ReactElement {
  return (
    <label className={`flex items-start gap-2.5 px-3 py-2 ${disabled ? '' : 'cursor-pointer hover:bg-[var(--bg-hover)]'}`}>
      <input className="mt-0.5" type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 text-[12px] font-medium text-[var(--text-1)]">
          {title}
          {badge}
        </span>
        <span className="mt-0.5 block text-[11px] leading-4 text-[var(--text-3)]">{description}</span>
      </span>
      <span
        className={`mt-0.5 min-w-10 shrink-0 text-right text-[12px] tabular-nums ${checked ? 'font-semibold text-[var(--text-1)]' : 'text-[var(--text-3)]'}`}
        aria-label={count === undefined ? 'Count updating' : `${count} found`}
      >
        {count === undefined ? <Loader2 size={12} className="ml-auto animate-spin" aria-hidden /> : count}
      </span>
    </label>
  );
}

function NeverIncluded({ parts }: { parts: Array<string | undefined> }): ReactElement | null {
  const visible = parts.filter(Boolean);
  return visible.length > 0 ? (
    <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--text-3)]">
      <Lock size={11} className="shrink-0" aria-hidden />
      Never included: {visible.join(', ')}.
    </p>
  ) : null;
}

// --- Advanced tables ---------------------------------------------------------

function branchColumns(baseName: string): Array<SelectionColumn<BranchCleanupCandidate>> {
  return [
    {
      id: 'name',
      header: 'Branch',
      render: (candidate) => {
        const reason = candidate.protectedReason ?? (!candidate.oldEnough ? 'Newer than the age threshold' : undefined);
        return (
          <>
            <span className="mono block break-all text-[var(--text-1)]">{candidate.name}</span>
            {reason ? <span className="mt-0.5 block text-[10.5px] text-[var(--text-3)]">{reason}</span> : null}
            {candidate.upstreamGone ? (
              <span className="mt-0.5 block text-[10.5px] text-[var(--text-3)]">Upstream is missing; update remote branches to check.</span>
            ) : null}
          </>
        );
      }
    },
    {
      id: 'age',
      header: 'Last commit',
      className: 'w-24 tabular-nums',
      render: (candidate) => (
        <span title={candidate.tipCommittedAt ? new Date(candidate.tipCommittedAt).toLocaleString() : undefined}>{formatAge(candidate.ageDays)}</span>
      )
    },
    {
      id: 'evidence',
      header: `Merge status vs ${baseName}`,
      className: 'w-[42%]',
      render: (candidate) => (
        <span className="flex min-w-0 items-start gap-2">
          <EvidenceBadge candidate={candidate} />
          <span className="min-w-0 truncate text-[10.5px] leading-[18px] text-[var(--text-3)]" title={candidate.explanation || EVIDENCE_HINTS[candidate.evidence]}>
            {isAnalyzed(candidate) ? candidate.explanation || EVIDENCE_HINTS[candidate.evidence] : 'Merge status was not checked.'}
          </span>
        </span>
      )
    }
  ];
}

function ArtifactStatus({ candidate }: { candidate: ArtifactCleanupCandidate }): ReactElement {
  if (candidate.protectedReason) {
    return <Badge tone="neutral" title={candidate.protectedReason}>Protected</Badge>;
  }

  if (!candidate.oldEnough) {
    return <Badge tone="neutral" title="Newer than the age threshold">Recent</Badge>;
  }

  return <Badge tone="warning">{candidate.kind === 'stash' ? 'Can delete' : 'Can remove'}</Badge>;
}

function ArtifactReason({ candidate }: { candidate: ArtifactCleanupCandidate }): ReactElement | null {
  const reason = candidate.protectedReason ?? (!candidate.oldEnough ? 'Newer than the age threshold' : undefined);
  return reason ? <span className="mt-0.5 block text-[10.5px] text-[var(--text-3)]">{reason}</span> : null;
}

const STASH_COLUMNS: Array<SelectionColumn<ArtifactCleanupCandidate>> = [
  {
    id: 'name',
    header: 'Stash',
    render: (candidate) => (
      <>
        <span className="block break-words text-[var(--text-1)]">{candidate.name}</span>
        <span className="mono mt-0.5 block text-[10.5px] text-[var(--text-3)]">{candidate.id} · {candidate.sha.slice(0, 8)}</span>
        <ArtifactReason candidate={candidate} />
      </>
    )
  },
  {
    id: 'age',
    header: 'Created',
    className: 'w-24 tabular-nums',
    render: (candidate) => <span title={candidate.date ? new Date(candidate.date).toLocaleString() : undefined}>{formatAge(candidate.ageDays)}</span>
  },
  { id: 'status', header: 'Status', className: 'w-28', render: (candidate) => <ArtifactStatus candidate={candidate} /> }
];

const WORKTREE_COLUMNS: Array<SelectionColumn<ArtifactCleanupCandidate>> = [
  {
    id: 'path',
    header: 'Worktree',
    render: (candidate) => (
      <>
        <span className="block break-words text-[var(--text-1)]">{candidate.name}</span>
        <span className="mono mt-0.5 block break-all text-[10.5px] text-[var(--text-3)]">{candidate.id}</span>
        <ArtifactReason candidate={candidate} />
      </>
    )
  },
  {
    id: 'branch',
    header: 'Branch',
    className: 'w-[24%]',
    render: (candidate) => (
      <span className="mono block break-all">{candidate.branch ? shortRefName(candidate.branch) : <span className="text-[var(--text-3)]">Detached</span>}</span>
    )
  },
  {
    id: 'age',
    header: 'Last used',
    className: 'w-24 tabular-nums',
    render: (candidate) => (
      <span title={[formatAgeSource(candidate.ageSource), candidate.date ? new Date(candidate.date).toLocaleString() : undefined].filter(Boolean).join(': ') || undefined}>
        {formatAge(candidate.ageDays)}
      </span>
    )
  },
  { id: 'status', header: 'Status', className: 'w-28', render: (candidate) => <ArtifactStatus candidate={candidate} /> }
];

function HiddenSummary({ parts, ageDays }: { parts: [number, number, number]; ageDays?: number }): ReactElement | null {
  const [protectedCount, recentCount, unverifiedCount] = parts;
  const text = [
    protectedCount > 0 ? `${protectedCount} protected` : undefined,
    recentCount > 0 ? `${recentCount} newer than ${ageDays ?? '?'} ${pluralize(ageDays ?? 0, 'day', 'days')}` : undefined,
    unverifiedCount > 0 ? `${unverifiedCount} not merged` : undefined
  ].filter(Boolean);

  return text.length > 0 ? <span>Hidden: {text.join(', ')}</span> : null;
}

// --- Review and results ------------------------------------------------------

type ReviewItem = { key: string; name: string; detail?: string; age: string; badge?: ReactNode };

function ReviewGroup({ title, items }: { title: string; items: ReviewItem[] }): ReactElement | null {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="mt-4">
      <SectionHeading>{title} · {items.length}</SectionHeading>
      <ul className="divide-y divide-[var(--border)] rounded border border-[var(--border)]">
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-3 px-3 py-1.5 text-[11.5px]">
            <span className="min-w-0 flex-1">
              <span className="mono block break-all text-[var(--text-1)]">{item.name}</span>
              {item.detail ? <span className="block break-all text-[10.5px] text-[var(--text-3)]">{item.detail}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums text-[var(--text-3)]">{item.age}</span>
            {item.badge}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CleanupResultView({ state }: { state: Extract<CleanupState, { status: 'done' }> }): ReactElement {
  const branchOutcomes = state.branches?.result?.outcomes ?? [];
  const artifactOutcomes = state.artifacts?.result?.outcomes ?? [];
  const all = [...branchOutcomes, ...artifactOutcomes];
  const deletedCount = all.filter((outcome) => outcome.status === 'deleted').length;
  const failedCount = all.length - deletedCount;
  const artifactError = state.artifacts && !state.artifacts.result ? state.artifacts.error : undefined;

  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
      <div role="status" aria-live="polite" className="grid gap-2">
        {failedCount === 0 && !artifactError ? (
          <Warning tone="success">Deleted {countLabel(deletedCount, 'item', 'items')}.</Warning>
        ) : (
          <Warning tone={deletedCount > 0 ? 'warning' : 'danger'}>
            Deleted {deletedCount} of {all.length} items. {failedCount > 0 ? `${countLabel(failedCount, 'item', 'items')} reported a failure.` : ''}
            {branchOutcomes.some((outcome) => outcome.status === 'failed' && outcome.ref.startsWith('refs/remotes/'))
              ? ' Update remote branches before retrying a server failure.'
              : ''}
          </Warning>
        )}
        {artifactError ? <Warning tone="danger">Stashes and worktrees were not cleaned up: {artifactError}</Warning> : null}
      </div>
      {all.some((outcome) => outcome.recoveryRef) ? (
        <p className="mt-2 text-[11px] leading-4 text-[var(--text-3)]">
          Reviewed commits and stash changes are preserved by recovery refs. Restore commands recreate branches, stashes, and worktrees;
          removed ignored files are not backed up.
        </p>
      ) : null}

      {branchOutcomes.length > 0 && state.branches ? (
        <ResultGroup
          title="Branches"
          rows={sortOutcomes(branchOutcomes).map((outcome) => {
            const candidate = state.branches?.candidates.get(outcome.ref);
            return {
              key: outcome.ref,
              name: candidate?.name ?? shortRefName(outcome.ref),
              status: outcome.status,
              message: outcome.message,
              recoveryRef: outcome.recoveryRef,
              restoreCommand: outcome.recoveryRef && candidate ? buildRestoreCommand(candidate, outcome.recoveryRef) : undefined
            };
          })}
        />
      ) : null}
      {artifactOutcomes.length > 0 && state.artifacts ? (
        <ResultGroup
          title="Stashes and worktrees"
          rows={sortOutcomes(artifactOutcomes).map((outcome) => {
            const candidate = state.artifacts?.candidates.get(artifactKey(outcome));
            const restoreCommand = outcome.recoveryRef && candidate
              ? candidate.kind === 'stash'
                ? buildStashRestoreCommand(candidate, outcome.recoveryRef)
                : buildWorktreeRestoreCommand(candidate, outcome.recoveryRef)
              : undefined;
            return {
              key: artifactKey(outcome),
              name: candidate ? (candidate.kind === 'stash' ? `${candidate.id} ${candidate.name}` : candidate.id) : outcome.id,
              status: outcome.status,
              message: outcome.message,
              recoveryRef: outcome.recoveryRef,
              restoreCommand
            };
          })}
        />
      ) : null}
    </div>
  );
}

type ResultRow = {
  key: string;
  name: string;
  status: 'deleted' | 'failed';
  message: string;
  recoveryRef?: string;
  restoreCommand?: string;
};

function ResultGroup({ title, rows }: { title: string; rows: ResultRow[] }): ReactElement {
  return (
    <section className="mt-3">
      <SectionHeading>{title}</SectionHeading>
      <ul className="divide-y divide-[var(--border)] rounded border border-[var(--border)]">
        {rows.map((row) => (
          <li key={row.key} className="grid gap-1 px-3 py-2 text-[11.5px]">
            <div className="flex items-center gap-2">
              {row.status === 'deleted' ? (
                <CheckCircle2 size={13} className="shrink-0 text-[var(--success-text)]" aria-hidden />
              ) : (
                <AlertTriangle size={13} className="shrink-0 text-[var(--danger-text)]" aria-hidden />
              )}
              <span className="mono min-w-0 flex-1 break-all text-[var(--text-1)]">{row.name}</span>
              <span className={`shrink-0 text-[11px] ${row.status === 'deleted' ? 'text-[var(--success-text)]' : 'text-[var(--danger-text)]'}`}>
                {row.status === 'deleted' ? 'Deleted' : 'Failed'}
              </span>
            </div>
            {row.message ? <p className="pl-5 text-[11px] text-[var(--text-3)]">{row.message}</p> : null}
            {row.recoveryRef ? (
              <div className="flex flex-wrap items-center gap-2 pl-5">
                <code className="mono min-w-0 flex-1 break-all text-[11px] text-[var(--text-2)]">{row.recoveryRef}</code>
                <CopyButton text={row.recoveryRef} label="Copy ref" accessibleLabel={`Copy recovery ref for ${row.name}`} />
                {row.restoreCommand ? (
                  <CopyButton text={row.restoreCommand} label="Copy restore command" accessibleLabel={`Copy restore command for ${row.name}`} />
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function sortOutcomes<T extends { status: 'deleted' | 'failed' }>(outcomes: T[]): T[] {
  return [...outcomes.filter((outcome) => outcome.status === 'failed'), ...outcomes.filter((outcome) => outcome.status === 'deleted')];
}

// --- Helpers -----------------------------------------------------------------

function footerMessage({
  mode,
  total,
  summary,
  isUpdating,
  scanFailed,
  isRepositoryBusy,
  branchAtLimit,
  artifactAtLimit,
  overflow
}: {
  mode: Mode;
  total: number;
  summary: string;
  isUpdating: boolean;
  scanFailed: boolean;
  isRepositoryBusy: boolean;
  branchAtLimit: boolean;
  artifactAtLimit: boolean;
  overflow: number;
}): string {
  if (isUpdating) {
    return 'Waiting for the scan to finish…';
  }

  if (scanFailed) {
    return 'The scan did not complete. Retry, or turn off the rules or selections that need it.';
  }

  const parts = [
    total === 0
      ? mode === 'simple'
        ? 'Nothing matches the selected rules.'
        : 'Nothing selected. Click rows to select; Shift-click selects a range.'
      : `${mode === 'simple' ? 'Will delete' : 'Selected'} ${summary}.`,
    overflow > 0 ? `${overflow} more match; a cleanup handles up to ${MAX_CLEANUP_BRANCHES} branches and ${MAX_CLEANUP_ARTIFACTS} stashes and worktrees, so run it again for the rest.` : undefined,
    branchAtLimit ? `Branch limit of ${MAX_CLEANUP_BRANCHES} reached; delete these first, then scan again for more.` : undefined,
    artifactAtLimit ? `Limit of ${MAX_CLEANUP_ARTIFACTS} stashes and worktrees reached.` : undefined,
    isRepositoryBusy ? 'Another Git operation is running; review becomes available when it finishes.' : undefined
  ];

  return parts.filter(Boolean).join(' ');
}

function summarizeSelection(branches: number, stashes: number, worktrees: number): string {
  const parts = [
    branches > 0 ? countLabel(branches, 'branch', 'branches') : undefined,
    stashes > 0 ? countLabel(stashes, 'stash', 'stashes') : undefined,
    worktrees > 0 ? countLabel(worktrees, 'worktree', 'worktrees') : undefined
  ].filter((part): part is string => Boolean(part));

  return parts.length === 0 ? 'nothing' : formatList(parts);
}

function summarizeReasons(candidates: ArtifactCleanupCandidate[]): string {
  const reasons = Array.from(new Set(candidates.map((candidate) => candidate.protectedReason).filter((reason): reason is string => Boolean(reason))));
  return reasons.length > 3 ? `${reasons.slice(0, 3).join(', ')}, …` : reasons.join(', ');
}

function countBranches(
  candidates: readonly BranchCleanupCandidate[],
  scope?: Scope
): { protectedCount: number; recentCount: number; unverifiedCount: number } {
  const inScope = scope ? candidates.filter((candidate) => candidate.scope === scope) : candidates;
  return {
    protectedCount: inScope.filter((candidate) => candidate.protectedReason).length,
    recentCount: inScope.filter((candidate) => !candidate.protectedReason && !candidate.oldEnough).length,
    unverifiedCount: inScope.filter((candidate) => isAnalyzed(candidate) && isUnverifiedEvidence(candidate.evidence)).length
  };
}

function countArtifacts(
  candidates: readonly ArtifactCleanupCandidate[]
): Record<ArtifactCleanupCandidate['kind'], { total: number; protectedCount: number; recentCount: number }> {
  const count = (kind: ArtifactCleanupCandidate['kind']) => {
    const ofKind = candidates.filter((candidate) => candidate.kind === kind);
    return {
      total: ofKind.length,
      protectedCount: ofKind.filter((candidate) => candidate.protectedReason).length,
      recentCount: ofKind.filter((candidate) => !candidate.protectedReason && !candidate.oldEnough).length
    };
  };

  return { stash: count('stash'), worktree: count('worktree') };
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
      return isHeuristicEvidence(evidence);
    case 'unmerged':
      return isUnverifiedEvidence(evidence);
  }
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
