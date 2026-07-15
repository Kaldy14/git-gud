import type { KeyboardEvent, ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileDiffOptions } from '@pierre/diffs';
import { FileDiff, PatchDiff, WorkerPoolContext } from '@pierre/diffs/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Columns2,
  FileCode2,
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
  CommitGraphRow,
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
import { createExpandableReviewDiff } from './reviewContextDiff';
import { createReviewContextOptions } from './reviewContextExpansion';
import { ReviewPatternsDialog } from './ReviewPatternsDialog';

type ReviewViewProps = {
  repoPath: string;
  row: CommitGraphRow;
  diffStyle: DiffStyle;
  onSetDiffStyle: (style: DiffStyle) => void;
  onClose: () => void;
};

export function ReviewView({
  repoPath,
  row,
  diffStyle,
  onSetDiffStyle,
  onClose
}: ReviewViewProps): ReactElement {
  const sectionRef = useRef<HTMLElement>(null);
  const queryClient = useQueryClient();
  const [wipScope, setWipScope] = useState<'all' | 'staged' | 'unstaged'>('all');
  const [preferences, setPreferences] = useState<ReviewPreferences>(() =>
    loadReviewPreferences(window.localStorage, repoPath)
  );
  const [isPatternEditorOpen, setIsPatternEditorOpen] = useState(false);
  const [selectedUnitId, setSelectedUnitId] = useState<string>();
  const target = useMemo<GitReviewTarget>(
    () => (row.node.kind === 'wip' ? { kind: 'wip', scope: wipScope } : { kind: 'commit', sha: row.sha }),
    [row.node.kind, row.sha, wipScope]
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
          {row.node.kind === 'wip' ? (
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
        units={presentation?.units ?? []}
        selectedUnit={selectedUnit}
        fileContexts={fileContexts}
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
  units,
  selectedUnit,
  fileContexts,
  diffOptions,
  isMutating,
  mutationError,
  onSelectUnit,
  onToggleViewed
}: {
  isLoading: boolean;
  errorMessage?: string;
  units: VisibleReviewUnit[];
  selectedUnit?: VisibleReviewUnit;
  fileContexts: ReadonlyMap<string, GitReviewFileContext>;
  diffOptions: FileDiffOptions<undefined>;
  isMutating: boolean;
  mutationError?: string;
  onSelectUnit: (unitId: string) => void;
  onToggleViewed: () => void;
}): ReactElement {
  if (isLoading) {
    return <ReviewMessage icon={<Loader2 size={16} className="animate-spin" />} text="Building contextual review…" />;
  }

  if (errorMessage) {
    return <ReviewMessage icon={<AlertTriangle size={16} />} text={errorMessage} tone="danger" />;
  }

  if (units.length === 0) {
    return <ReviewMessage icon={<SkipForward size={16} />} text="All changes are skipped by the current review filters." />;
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
              <span className="block truncate text-xs font-semibold text-[var(--text-1)]">{candidate.unit.title}</span>
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
                <h2 className="truncate text-sm font-semibold text-[var(--text-1)]">{selectedUnit.unit.title}</h2>
                <p className="mt-1 text-xs text-[var(--text-3)]">
                  {selectedUnit.unit.reason}
                  {selectedUnit.skippedCount > 0 ? ` · ${selectedUnit.skippedCount} skipped by filters` : ''}
                </p>
              </div>
              <button className={selectedUnit.isViewed ? 'btn-subtle h-8 text-xs' : 'btn-primary h-8 text-xs'} type="button" disabled={isMutating} onClick={onToggleViewed}>
                {isMutating ? <Loader2 size={13} className="animate-spin" /> : selectedUnit.isViewed ? <X size={13} /> : <CheckCheck size={13} />}
                {selectedUnit.isViewed ? 'Mark unviewed' : 'Viewed & next'}
              </button>
            </header>
            {mutationError ? <p className="border-b border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-2 text-xs text-[var(--danger-text)]">{mutationError}</p> : null}
            <div className="review-chunks">
              {selectedUnit.visibleChunks.map((chunk) => (
                <ReviewChunk
                  key={chunk.id}
                  chunk={chunk}
                  context={chunk.fileContextId ? fileContexts.get(chunk.fileContextId) : undefined}
                  diffOptions={diffOptions}
                />
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
  context,
  diffOptions
}: {
  chunk: GitReviewChunk;
  context?: GitReviewFileContext;
  diffOptions: FileDiffOptions<undefined>;
}): ReactElement {
  const expandableDiff = useMemo(
    () => context ? createExpandableReviewDiff(chunk, context) : undefined,
    [chunk, context]
  );
  const contextualDiffOptions = useMemo<FileDiffOptions<undefined>>(
    () => expandableDiff
      ? createReviewContextOptions(diffOptions, expandableDiff, chunk.path)
      : diffOptions,
    [chunk.path, diffOptions, expandableDiff]
  );

  // Review units mount several diffs together; the shared worker pool can lose lazy language
  // initialization during that burst. Pierre's shared main-thread highlighter stays cached and reliable.
  return (
    <section className="review-chunk">
      <div className="review-chunk-header">
        <FileCode2 size={13} className="shrink-0 text-[var(--accent-2)]" />
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--text-2)]">{chunk.path}</span>
        <span className="badge-mini">{chunk.role}</span>
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
        <WorkerPoolContext.Provider value={undefined}>
          {expandableDiff ? (
            <FileDiff
              className="gg-diff"
              fileDiff={expandableDiff.fileDiff}
              options={contextualDiffOptions}
            />
          ) : (
            <PatchDiff className="gg-diff" patch={chunk.patch} options={diffOptions} />
          )}
        </WorkerPoolContext.Provider>
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
  return target.kind === 'commit' ? `commit:${target.sha}` : `wip:${target.scope}`;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
