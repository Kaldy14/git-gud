import type { KeyboardEvent, ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileDiffOptions } from '@pierre/diffs';
import { FileDiff, PatchDiff, useWorkerPool } from '@pierre/diffs/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Columns2,
  FileCode2,
  FileCog,
  GitBranch,
  Loader2,
  PackageOpen,
  Rows3,
  Settings2,
  SkipForward,
  TestTube2,
  Trash2,
  X
} from 'lucide-react';

import { DIFF_OPTIONS_BASE, type DiffStyle } from '@renderer/components/commit/fileDetailUtils';
import { reviewPlanQueryKey, useReviewPlan } from '@renderer/queries/repository';
import type {
  GitReviewChunk,
  GitReviewFileContext,
  GitReviewTarget
} from '@shared/types';

import {
  createReviewPresentation,
  loadReviewPreferences,
  saveReviewPreferences,
  type ReviewPreferences,
  type VisibleReviewUnit
} from './reviewFilters';
import {
  prepareReviewDiff,
  type PreparedReviewDiff
} from './reviewContextDiff';
import { createReviewContextOptions } from './reviewContextExpansion';
import { ReviewPatternsDialog } from './ReviewPatternsDialog';
import { createReviewContexts } from './reviewSections';

type ReviewViewProps = {
  repoPath: string;
  target: GitReviewTarget;
  diffStyle: DiffStyle;
  onSetDiffStyle: (style: DiffStyle) => void;
  onClose: () => void;
};

export function ReviewView({
  repoPath,
  target: initialTarget,
  diffStyle,
  onSetDiffStyle,
  onClose
}: ReviewViewProps): ReactElement {
  const sectionRef = useRef<HTMLElement>(null);
  const workerPool = useWorkerPool();
  const queryClient = useQueryClient();
  const [wipScope, setWipScope] = useState<'all' | 'staged' | 'unstaged'>(
    initialTarget.kind === 'wip' ? initialTarget.scope : 'all'
  );
  const [preferences, setPreferences] = useState<ReviewPreferences>(() =>
    loadReviewPreferences(window.localStorage, repoPath)
  );
  const [isPatternEditorOpen, setIsPatternEditorOpen] = useState(false);
  const [selectedUnitId, setSelectedUnitId] = useState<string>();
  const target = useMemo<GitReviewTarget>(
    () => (initialTarget.kind === 'wip' ? { kind: 'wip', scope: wipScope } : initialTarget),
    [initialTarget, wipScope]
  );
  const reviewQuery = useReviewPlan(repoPath, target);
  const reviewedChunkIds = useMemo(
    () => new Set(reviewQuery.data?.reviewedChunkIds ?? []),
    [reviewQuery.data?.reviewedChunkIds]
  );
  const presentation = useMemo(
    () => reviewQuery.data ? createReviewPresentation(reviewQuery.data, preferences, reviewedChunkIds) : undefined,
    [preferences, reviewQuery.data, reviewedChunkIds]
  );
  const fileContexts = useMemo(
    () => new Map(reviewQuery.data?.fileContexts.map((context) => [context.id, context]) ?? []),
    [reviewQuery.data?.fileContexts]
  );
  const selectedUnit =
    presentation?.units.find((candidate) => candidate.unit.id === selectedUnitId) ??
    presentation?.units.find((candidate) => !candidate.isViewed) ??
    presentation?.units[0];
  const preparedDiffCacheKeyPrefix = `${repoPath}:${reviewQuery.data?.targetKey ?? targetKey(target)}`;
  const selectedPreparedDiffs = useMemo(
    () => prepareReviewUnitDiffs(
      selectedUnit,
      fileContexts,
      preparedDiffCacheKeyPrefix
    ),
    [fileContexts, preparedDiffCacheKeyPrefix, selectedUnit]
  );
  const diffOptions = useMemo<FileDiffOptions<undefined>>(
    () => ({ ...DIFF_OPTIONS_BASE, diffStyle, disableFileHeader: true }),
    [diffStyle]
  );
  const progressMutation = useMutation({
    mutationFn: async ({ chunkIds, viewed }: { chunkIds: string[]; viewed: boolean }) =>
      window.api.setReviewProgress(repoPath, {
        targetKey: reviewQuery.data?.targetKey ?? targetKey(target),
        chunkIds,
        viewed
      }),
    onSuccess: (nextReviewedChunkIds) => {
      queryClient.setQueryData(reviewPlanQueryKey(repoPath, target), (current) =>
        current ? { ...current, reviewedChunkIds: nextReviewedChunkIds } : current
      );
    }
  });

  useEffect(() => {
    sectionRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!workerPool || !selectedUnit || !presentation) {
      return;
    }

    for (const prepared of selectedPreparedDiffs.values()) {
      workerPool.primeDiffHighlightCache(prepared.fileDiff);
    }

    const selectedIndex = presentation.units.findIndex(
      (candidate) => candidate.unit.id === selectedUnit.unit.id
    );
    const upcomingUnits = presentation.units.slice(selectedIndex + 1, selectedIndex + 3);
    const idleCallback = window.requestIdleCallback(() => {
      for (const unit of upcomingUnits) {
        const preparedDiffs = prepareReviewUnitDiffs(
          unit,
          fileContexts,
          preparedDiffCacheKeyPrefix
        );

        for (const prepared of preparedDiffs.values()) {
          workerPool.primeDiffHighlightCache(prepared.fileDiff);
        }
      }
    }, { timeout: 500 });

    return () => window.cancelIdleCallback(idleCallback);
  }, [
    fileContexts,
    preparedDiffCacheKeyPrefix,
    presentation,
    selectedPreparedDiffs,
    selectedUnit,
    workerPool
  ]);

  function updatePreferences(next: ReviewPreferences): void {
    setPreferences(next);
    saveReviewPreferences(window.localStorage, repoPath, next);
  }

  function markSelectedUnit(viewed: boolean): void {
    if (!selectedUnit || progressMutation.isPending) {
      return;
    }

    const nextUnitId = viewed ? findNextPendingUnitId(presentation?.units ?? [], selectedUnit.unit.id) : undefined;
    progressMutation.mutate(
      { chunkIds: selectedUnit.visibleChunks.map((chunk) => chunk.id), viewed },
      { onSuccess: () => nextUnitId && setSelectedUnitId(nextUnitId) }
    );
  }

  function navigateUnits(direction: -1 | 1): void {
    const units = presentation?.units ?? [];
    const currentIndex = units.findIndex((candidate) => candidate.unit.id === selectedUnit?.unit.id);
    const nextIndex = currentIndex === -1 ? 0 : currentIndex + direction;
    const nextUnit = units[nextIndex];

    if (nextUnit) {
      setSelectedUnitId(nextUnit.unit.id);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || isEditableTarget(event.target)) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'j' || event.key === 'ArrowDown') {
      event.preventDefault();
      navigateUnits(1);
    } else if (event.key === 'k' || event.key === 'ArrowUp') {
      event.preventDefault();
      navigateUnits(-1);
    } else if (event.key === 'v') {
      event.preventDefault();
      markSelectedUnit(!(selectedUnit?.isViewed ?? false));
    }
  }

  return (
    <section ref={sectionRef} className="review-view" tabIndex={0} onKeyDown={handleKeyDown}>
      <div className="review-toolbar">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {target.kind === 'branch' ? (
            <span
              className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-field)] px-2.5 text-[11px] font-semibold text-[var(--text-2)]"
              title={`Review all changes on ${target.name}`}
            >
              <GitBranch size={12} className="shrink-0" />
              <span className="max-w-48 truncate">{target.name}</span>
            </span>
          ) : null}
          {target.kind === 'wip' ? (
            <div className="segmented" aria-label="Working directory review scope">
              {(['all', 'unstaged', 'staged'] as const).map((scope) => (
                <button key={scope} type="button" data-active={wipScope === scope} onClick={() => setWipScope(scope)}>
                  {scope === 'all' ? 'All WIP' : scope === 'unstaged' ? 'Worktree' : 'Staged'}
                </button>
              ))}
            </div>
          ) : null}
          <ReviewFilterToggle
            checked={preferences.skipTests}
            icon={<TestTube2 size={12} />}
            label="Skip tests/specs"
            onChange={(skipTests) => updatePreferences({ ...preferences, skipTests })}
          />
          <ReviewFilterToggle
            checked={preferences.skipImports}
            icon={<PackageOpen size={12} />}
            label="Skip imports"
            onChange={(skipImports) => updatePreferences({ ...preferences, skipImports })}
          />
          <ReviewFilterToggle
            checked={preferences.skipGenerated}
            icon={<FileCog size={12} />}
            label="Skip generated"
            onChange={(skipGenerated) => updatePreferences({ ...preferences, skipGenerated })}
          />
          <ReviewFilterToggle
            checked={preferences.skipDeletions}
            icon={<Trash2 size={12} />}
            label="Skip deletions"
            onChange={(skipDeletions) => updatePreferences({ ...preferences, skipDeletions })}
          />
          <div className="flex items-center gap-1">
            <ReviewFilterToggle
              checked={preferences.skipFilePatterns}
              disabled={preferences.filePatterns.length === 0}
              icon={<Settings2 size={12} />}
              label="Skip patterns"
              onChange={(skipFilePatterns) => updatePreferences({ ...preferences, skipFilePatterns })}
            />
            <button
              className="btn-subtle h-7 min-w-7 px-2 text-[11px]"
              type="button"
              aria-label="Configure repository skip patterns"
              title="Configure repository skip patterns"
              onClick={() => setIsPatternEditorOpen(true)}
            >
              <Settings2 size={12} />
              {preferences.filePatterns.length > 0 ? preferences.filePatterns.length : null}
            </button>
          </div>
        </div>

        <ReviewProgress presentation={presentation} />

        <div className="flex shrink-0 items-center gap-1">
          <div className="segmented shrink-0">
            <button type="button" data-active={diffStyle === 'unified'} onClick={() => onSetDiffStyle('unified')} title="Unified diff">
              <Rows3 size={12} />
            </button>
            <button type="button" data-active={diffStyle === 'split'} onClick={() => onSetDiffStyle('split')} title="Split diff">
              <Columns2 size={12} />
            </button>
          </div>
          <button
            className="icon-btn h-7 w-7 shrink-0"
            type="button"
            onClick={onClose}
            aria-label="Close review"
            title="Close review"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <ReviewBody
        isLoading={reviewQuery.isLoading}
        errorMessage={reviewQuery.error instanceof Error ? reviewQuery.error.message : undefined}
        hasReviewUnits={Boolean(reviewQuery.data?.units.length)}
        emptyReviewMessage={
          target.kind === 'branch'
            ? `${target.name} has no changes compared with the default branch.`
            : 'There are no changes to review.'
        }
        units={presentation?.units ?? []}
        selectedUnit={selectedUnit}
        preparedDiffs={selectedPreparedDiffs}
        diffOptions={diffOptions}
        isMutating={progressMutation.isPending}
        mutationError={progressMutation.error instanceof Error ? progressMutation.error.message : undefined}
        onSelectUnit={setSelectedUnitId}
        onToggleViewed={() => markSelectedUnit(!(selectedUnit?.isViewed ?? false))}
      />

      {isPatternEditorOpen ? (
        <ReviewPatternsDialog
          repoPath={repoPath}
          patterns={preferences.filePatterns}
          onClose={() => setIsPatternEditorOpen(false)}
          onSave={(filePatterns) => {
            updatePreferences({
              ...preferences,
              filePatterns,
              skipFilePatterns: filePatterns.length > 0
            });
            setIsPatternEditorOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}

function ReviewBody({
  isLoading,
  errorMessage,
  hasReviewUnits,
  emptyReviewMessage,
  units,
  selectedUnit,
  preparedDiffs,
  diffOptions,
  isMutating,
  mutationError,
  onSelectUnit,
  onToggleViewed
}: {
  isLoading: boolean;
  errorMessage?: string;
  hasReviewUnits: boolean;
  emptyReviewMessage: string;
  units: VisibleReviewUnit[];
  selectedUnit?: VisibleReviewUnit;
  preparedDiffs: ReadonlyMap<string, PreparedReviewDiff>;
  diffOptions: FileDiffOptions<undefined>;
  isMutating: boolean;
  mutationError?: string;
  onSelectUnit: (unitId: string) => void;
  onToggleViewed: () => void;
}): ReactElement {
  const reviewChunksRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    reviewChunksRef.current?.scrollTo({ top: 0 });
  }, [selectedUnit?.unit.id]);

  if (isLoading) {
    return <ReviewMessage icon={<Loader2 size={16} className="animate-spin" />} text="Building contextual review…" />;
  }

  if (errorMessage) {
    return <ReviewMessage icon={<AlertTriangle size={16} />} text={errorMessage} tone="danger" />;
  }

  if (units.length === 0) {
    return hasReviewUnits
      ? <ReviewMessage icon={<SkipForward size={16} />} text="All changes are skipped by the current review filters." />
      : <ReviewMessage icon={<Check size={16} />} text={emptyReviewMessage} />;
  }

  return (
    <div className="review-layout">
      <nav className="review-queue" aria-label="Context review units">
        {units.map((candidate, index) => (
          <button
            key={candidate.unit.id}
            className="review-unit-row"
            type="button"
            data-active={candidate.unit.id === selectedUnit?.unit.id}
            onClick={() => onSelectUnit(candidate.unit.id)}
          >
            <span className="review-unit-status" data-viewed={candidate.isViewed}>
              {candidate.isViewed ? <Check size={12} /> : index + 1}
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-xs font-semibold text-[var(--text-1)]" title={candidate.unit.explanation}>{candidate.unit.title}</span>
              <span className="mt-0.5 block truncate text-[10.5px] text-[var(--text-3)]">{candidate.unit.reason}</span>
            </span>
            <span className="badge-mini">{candidate.visibleChunks.length}</span>
          </button>
        ))}
      </nav>

      <main className="review-content">
        {selectedUnit ? (
          <>
            <header className="review-unit-header">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <h2 className="truncate text-sm font-semibold text-[var(--text-1)]">{selectedUnit.unit.title}</h2>
                  <span className="badge-mini shrink-0" title="Grouping confidence">{selectedUnit.unit.confidence}</span>
                </div>
                <p className="mt-0.5 text-xs text-[var(--text-3)]">
                  {selectedUnit.unit.reason}
                  {` · ${selectedUnit.unit.explanation}`}
                  {selectedUnit.skippedCount > 0 ? ` · ${selectedUnit.skippedCount} skipped by filters` : ''}
                </p>
              </div>
              <button className={selectedUnit.isViewed ? 'btn-subtle h-8 text-xs' : 'btn-primary h-8 text-xs'} type="button" disabled={isMutating} onClick={onToggleViewed}>
                {isMutating ? <Loader2 size={13} className="animate-spin" /> : selectedUnit.isViewed ? <X size={13} /> : <CheckCheck size={13} />}
                {selectedUnit.isViewed ? 'Mark unviewed' : 'Viewed'}
              </button>
            </header>
            {mutationError ? <p className="border-b border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-2 text-xs text-[var(--danger-text)]">{mutationError}</p> : null}
            <div ref={reviewChunksRef} className="review-chunks">
              {createReviewContexts(selectedUnit.visibleChunks).map((contextGroup, _contextIndex, contexts) => (
                <section className="review-context-group" key={contextGroup.key}>
                  {contexts.length > 1 ? (
                    <div className="review-context-header">
                      <span>{contextGroup.label}</span>
                      <span>{contextGroup.chunkCount}</span>
                    </div>
                  ) : null}
                  {contextGroup.sections.map((section, _sectionIndex, sections) => (
                    <section className="review-chunk-section" data-only={sections.length === 1} key={section.key}>
                      {sections.length > 1 ? (
                        <div className="review-section-header">
                          <span>{section.label}</span>
                          <span>{section.chunks.length}</span>
                        </div>
                      ) : null}
                      {section.chunks.map((chunk) => (
                        <ReviewChunk
                          key={chunk.id}
                          chunk={chunk}
                          preparedDiff={preparedDiffs.get(chunk.id)}
                          diffOptions={diffOptions}
                        />
                      ))}
                    </section>
                  ))}
                </section>
              ))}
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}

function ReviewChunk({
  chunk,
  preparedDiff,
  diffOptions
}: {
  chunk: GitReviewChunk;
  preparedDiff?: PreparedReviewDiff;
  diffOptions: FileDiffOptions<undefined>;
}): ReactElement {
  const expandableDiff = preparedDiff?.expandable;
  const contextualDiffOptions = useMemo<FileDiffOptions<undefined>>(
    () => expandableDiff
      ? createReviewContextOptions(diffOptions, expandableDiff, chunk.path)
      : diffOptions,
    [chunk.path, diffOptions, expandableDiff]
  );

  return (
    <section className="review-chunk">
      <div className="review-chunk-header">
        <FileCode2 size={13} className="shrink-0 text-[var(--accent-2)]" />
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--text-2)]">{chunk.path}</span>
        <span className="badge-mini" title={chunk.relationship}>{chunk.role}</span>
        {chunk.source !== 'commit' ? <span className="badge-mini">{chunk.source}</span> : null}
        <span className="text-[var(--success-text)]">+{chunk.additions}</span>
        <span className="text-[var(--danger-text)]">-{chunk.deletions}</span>
      </div>
      {chunk.omittedReason ? (
        <div className="grid min-h-28 place-items-center px-4 text-center text-xs text-[var(--text-3)]">
          {chunk.omittedReason === 'binary'
            ? 'Binary changes cannot be previewed.'
            : chunk.omittedReason === 'too-large'
              ? 'This change exceeds the review preview limit.'
              : 'No textual diff is available for this change.'}
        </div>
      ) : (
        preparedDiff ? (
          <FileDiff
            className="gg-diff"
            fileDiff={preparedDiff.fileDiff}
            options={expandableDiff ? contextualDiffOptions : diffOptions}
          />
        ) : (
          <PatchDiff className="gg-diff" patch={chunk.patch} options={diffOptions} />
        )
      )}
    </section>
  );
}

function ReviewFilterToggle({
  checked,
  disabled = false,
  icon,
  label,
  onChange
}: {
  checked: boolean;
  disabled?: boolean;
  icon: ReactElement;
  label: string;
  onChange: (checked: boolean) => void;
}): ReactElement {
  return (
    <label className="review-filter-toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      {icon}
      <span>{label}</span>
    </label>
  );
}

function ReviewProgress({ presentation }: { presentation: ReturnType<typeof createReviewPresentation> | undefined }): ReactElement {
  if (!presentation) {
    return <span className="text-xs text-[var(--text-3)]">Preparing review…</span>;
  }

  return (
    <span className="review-progress" role="status" aria-live="polite">
      <strong>{presentation.viewedCount}</strong> viewed
      <span>·</span>
      <strong>{presentation.skippedCount}</strong> skipped
      <span>·</span>
      <strong>{presentation.pendingCount}</strong> remaining
    </span>
  );
}

function ReviewMessage({ icon, text, tone }: { icon: ReactElement; text: string; tone?: 'danger' }): ReactElement {
  return (
    <div className="review-message" data-tone={tone}>
      <span className="flex items-center gap-2">{icon}{text}</span>
    </div>
  );
}

function findNextPendingUnitId(units: VisibleReviewUnit[], currentId: string): string | undefined {
  const currentIndex = units.findIndex((candidate) => candidate.unit.id === currentId);
  const ordered = [...units.slice(currentIndex + 1), ...units.slice(0, currentIndex)];
  return ordered.find((candidate) => !candidate.isViewed)?.unit.id;
}

function targetKey(target: GitReviewTarget): string {
  return target.kind === 'commit'
    ? `commit:${target.sha}`
    : target.kind === 'branch'
      ? `branch:${target.name}`
      : `wip:${target.scope}`;
}

function prepareReviewUnitDiffs(
  unit: VisibleReviewUnit | undefined,
  fileContexts: ReadonlyMap<string, GitReviewFileContext>,
  cacheKeyPrefix: string
): Map<string, PreparedReviewDiff> {
  const preparedDiffs = new Map<string, PreparedReviewDiff>();

  for (const chunk of unit?.visibleChunks ?? []) {
    if (chunk.omittedReason) {
      continue;
    }

    const prepared = prepareReviewDiff(
      chunk,
      chunk.fileContextId ? fileContexts.get(chunk.fileContextId) : undefined,
      cacheKeyPrefix
    );

    if (prepared) {
      preparedDiffs.set(chunk.id, prepared);
    }
  }

  return preparedDiffs;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
