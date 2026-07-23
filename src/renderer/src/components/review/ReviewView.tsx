import type { FormEvent, KeyboardEvent, ReactElement, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DiffLineAnnotation, FileDiffOptions, SelectedLineRange } from '@pierre/diffs';
import { FileDiff, PatchDiff, useWorkerPool } from '@pierre/diffs/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Columns2,
  Clock3,
  FileCode2,
  FileCog,
  GitBranch,
  Loader2,
  MessageSquare,
  PackageOpen,
  Rows3,
  Reply,
  Send,
  Settings2,
  SkipForward,
  TestTube2,
  Trash2,
  X
} from 'lucide-react';

import { createDiffOptionsBase, type DiffStyle } from '@renderer/components/commit/fileDetailUtils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu';
import { reviewPlanQueryKey, useReviewPlan } from '@renderer/queries/repository';
import type {
  DiffSyntaxTheme,
  GitReviewChunk,
  GitReviewFileContext,
  GitReviewGuide,
  GitReviewGuidePriority,
  GitReviewGuideState,
  GitReviewGuideUnit,
  GitReviewPlan,
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
import { rankReviewUnitsByGuide } from './reviewGuidePresentation';
import { ReviewPatternsDialog } from './ReviewPatternsDialog';
import { createReviewContexts } from './reviewSections';

type ReviewViewProps = {
  repoPath: string;
  target: GitReviewTarget;
  plan?: GitReviewPlan;
  reviewProgressKey?: string;
  lineComments?: ReviewLineComment[];
  onAddDraftLineComment?: (input: ReviewLineCommentInput) => Promise<void>;
  onAddDraftReply?: (input: ReviewLineReplyInput) => Promise<void>;
  onRemoveDraftComment?: (id: string) => void;
  diffStyle: DiffStyle;
  diffSyntaxTheme: DiffSyntaxTheme;
  onSetDiffStyle: (style: DiffStyle) => void;
  onClose: () => void;
};

export type ReviewLineComment = {
  id: string | number;
  body: string;
  author: string;
  authorAvatarUrl?: string;
  createdAt: string;
  path: string;
  line?: number;
  side?: 'left' | 'right';
  inReplyToId?: string | number;
  isDraft?: boolean;
};

export type ReviewLineCommentInput = {
  body: string;
  path: string;
  line: number;
  side: 'left' | 'right';
  startLine?: number;
  startSide?: 'left' | 'right';
};

export type ReviewLineReplyInput = {
  body: string;
  inReplyToId: number;
};

type ReviewLineCommentThread = ReviewLineComment & {
  replies: ReviewLineComment[];
};

type ReviewLineCollaboration = {
  threads: ReviewLineCommentThread[];
  selectedChunkId?: string;
  selectedPath?: string;
  selectedLines: SelectedLineRange | null;
  body: string;
  isSubmitting: boolean;
  errorMessage?: string;
  onSelectLines: (chunkId: string, path: string, range: SelectedLineRange | null) => void;
  onBodyChange: (body: string) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onAddDraftReply?: (input: ReviewLineReplyInput) => Promise<void>;
  onRemoveDraftComment?: (id: string) => void;
};

export function ReviewView({
  repoPath,
  target,
  plan: embeddedPlan,
  reviewProgressKey,
  lineComments = [],
  onAddDraftLineComment,
  onAddDraftReply,
  onRemoveDraftComment,
  diffStyle,
  diffSyntaxTheme,
  onSetDiffStyle,
  onClose
}: ReviewViewProps): ReactElement {
  const sectionRef = useRef<HTMLElement>(null);
  const workerPool = useWorkerPool();
  const queryClient = useQueryClient();
  const [preferences, setPreferences] = useState<ReviewPreferences>(() =>
    loadReviewPreferences(window.localStorage, repoPath)
  );
  const [isPatternEditorOpen, setIsPatternEditorOpen] = useState(false);
  const [selectedUnitId, setSelectedUnitId] = useState<string>();
  const [embeddedReviewedChunkIds, setEmbeddedReviewedChunkIds] = useState<string[]>(() =>
    embeddedPlan
      ? loadEmbeddedReviewProgress(window.localStorage, reviewProgressKey, embeddedPlan)
      : []
  );
  const [selectedCommentLines, setSelectedCommentLines] = useState<{
    chunkId: string;
    path: string;
    range: SelectedLineRange;
  }>();
  const [lineCommentBody, setLineCommentBody] = useState('');
  const [reviewGuideState, setReviewGuideState] = useState<GitReviewGuideState>();
  const reviewQuery = useReviewPlan(
    embeddedPlan ? undefined : repoPath,
    embeddedPlan ? undefined : target
  );
  const reviewPlan = useMemo<GitReviewPlan | undefined>(() => {
    if (!embeddedPlan) {
      return reviewQuery.data;
    }

    const validChunkIds = new Set(
      embeddedPlan.units.flatMap((unit) => unit.chunks.map((chunk) => chunk.id))
    );
    return {
      ...embeddedPlan,
      reviewedChunkIds: embeddedReviewedChunkIds.filter((chunkId) => validChunkIds.has(chunkId))
    };
  }, [embeddedPlan, embeddedReviewedChunkIds, reviewQuery.data]);
  const reviewedChunkIds = useMemo(
    () => new Set(reviewPlan?.reviewedChunkIds ?? []),
    [reviewPlan?.reviewedChunkIds]
  );
  const currentReviewGuideState: GitReviewGuideState | undefined =
    !embeddedPlan && reviewPlan
      ? reviewGuideState?.sourceFingerprint === reviewPlan.sourceFingerprint
        ? reviewGuideState
        : { status: 'idle', sourceFingerprint: reviewPlan.sourceFingerprint }
      : undefined;
  const basePresentation = useMemo(
    () => reviewPlan ? createReviewPresentation(reviewPlan, preferences, reviewedChunkIds) : undefined,
    [preferences, reviewPlan, reviewedChunkIds]
  );
  const reviewGuide =
    currentReviewGuideState?.status === 'ready'
      ? currentReviewGuideState.guide
      : undefined;
  const presentation = useMemo(
    () => basePresentation
      ? {
          ...basePresentation,
          units: rankReviewUnitsByGuide(
            basePresentation.units,
            reviewGuide,
            reviewPlan?.sourceFingerprint
          )
        }
      : undefined,
    [basePresentation, reviewGuide, reviewPlan?.sourceFingerprint]
  );
  const reviewGuideUnits = useMemo(
    () => new Map(reviewGuide?.units.map((unit) => [unit.unitId, unit]) ?? []),
    [reviewGuide]
  );
  const activeFilterCount = [
    preferences.skipTests,
    preferences.skipImports,
    preferences.skipGenerated,
    preferences.skipDeletions,
    preferences.skipFilePatterns && preferences.filePatterns.length > 0
  ].filter(Boolean).length;
  const fileContexts = useMemo(
    () => new Map(reviewPlan?.fileContexts.map((context) => [context.id, context]) ?? []),
    [reviewPlan?.fileContexts]
  );
  const selectedUnit =
    presentation?.units.find((candidate) => candidate.unit.id === selectedUnitId) ??
    presentation?.units.find((candidate) => !candidate.isViewed) ??
    presentation?.units[0];
  const preparedDiffCacheKeyPrefix = `${repoPath}:${reviewPlan?.targetKey ?? targetKey(target)}`;
  const selectedPreparedDiffs = useMemo(
    () => prepareReviewUnitDiffs(
      selectedUnit,
      fileContexts,
      preparedDiffCacheKeyPrefix
    ),
    [fileContexts, preparedDiffCacheKeyPrefix, selectedUnit]
  );
  const commentThreads = useMemo(
    () => createReviewCommentThreads(lineComments),
    [lineComments]
  );
  const diffOptions = useMemo<FileDiffOptions<ReviewLineCommentThread>>(
    () => ({
      ...createDiffOptionsBase<ReviewLineCommentThread>(diffSyntaxTheme),
      diffStyle,
      disableFileHeader: true
    }),
    [diffStyle, diffSyntaxTheme]
  );
  const progressMutation = useMutation({
    mutationFn: async ({ chunkIds, viewed }: { chunkIds: string[]; viewed: boolean }) => {
      if (embeddedPlan) {
        const nextReviewedChunkIds = new Set(embeddedReviewedChunkIds);
        for (const chunkId of chunkIds) {
          if (viewed) {
            nextReviewedChunkIds.add(chunkId);
          } else {
            nextReviewedChunkIds.delete(chunkId);
          }
        }
        const next = [...nextReviewedChunkIds];
        saveEmbeddedReviewProgress(window.localStorage, reviewProgressKey, next);
        return next;
      }

      return window.api.setReviewProgress(repoPath, {
        targetKey: reviewPlan?.targetKey ?? targetKey(target),
        chunkIds,
        viewed
      });
    },
    onSuccess: (nextReviewedChunkIds) => {
      if (embeddedPlan) {
        setEmbeddedReviewedChunkIds(nextReviewedChunkIds);
        return;
      }

      queryClient.setQueryData(reviewPlanQueryKey(repoPath, target), (current) =>
        current ? { ...current, reviewedChunkIds: nextReviewedChunkIds } : current
      );
    }
  });
  const lineCommentMutation = useMutation({
    mutationFn: async (input: ReviewLineCommentInput) => {
      if (!onAddDraftLineComment) {
        throw new Error('Line comments are unavailable for this review.');
      }
      await onAddDraftLineComment(input);
    },
    onSuccess: () => {
      setSelectedCommentLines(undefined);
      setLineCommentBody('');
    }
  });

  useEffect(() => {
    sectionRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const sourceFingerprint = reviewPlan?.sourceFingerprint;

    if (embeddedPlan || !sourceFingerprint) {
      return;
    }

    let cancelled = false;
    void window.api.getReviewGuideState(repoPath, sourceFingerprint)
      .then((state) => {
        if (!cancelled && state.sourceFingerprint === sourceFingerprint) {
          setReviewGuideState(state);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setReviewGuideState({
            status: 'failed',
            sourceFingerprint,
            errorMessage: error instanceof Error ? error.message : 'Unable to load AI guide status.'
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [embeddedPlan, repoPath, reviewPlan?.sourceFingerprint]);

  useEffect(() => {
    if (currentReviewGuideState?.status !== 'running') {
      return;
    }

    const sourceFingerprint = currentReviewGuideState.sourceFingerprint;
    let cancelled = false;
    const refresh = (): void => {
      void window.api.getReviewGuideState(repoPath, sourceFingerprint)
        .then((state) => {
          if (!cancelled && state.sourceFingerprint === sourceFingerprint) {
            setReviewGuideState(state);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setReviewGuideState({
              status: 'failed',
              sourceFingerprint,
              errorMessage: error instanceof Error ? error.message : 'Unable to load AI guide status.'
            });
          }
        });
    };
    const interval = window.setInterval(refresh, 1_000);
    refresh();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [currentReviewGuideState?.sourceFingerprint, currentReviewGuideState?.status, repoPath]);

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

  async function startReviewGuide(): Promise<void> {
    if (embeddedPlan || !reviewPlan || currentReviewGuideState?.status === 'running') {
      return;
    }

    const sourceFingerprint = reviewPlan.sourceFingerprint;
    setSelectedUnitId(selectedUnit?.unit.id);
    setReviewGuideState({
      status: 'running',
      sourceFingerprint,
      startedAt: new Date().toISOString()
    });

    try {
      const state = await window.api.startReviewGuide(repoPath, target, sourceFingerprint);
      if (state.sourceFingerprint === sourceFingerprint) {
        setReviewGuideState(state);
      }
    } catch (error) {
      setReviewGuideState({
        status: 'failed',
        sourceFingerprint,
        errorMessage: error instanceof Error ? error.message : 'Unable to start the AI guide.'
      });
    }
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

  function handleSelectCommentLines(
    chunkId: string,
    path: string,
    range: SelectedLineRange | null
  ): void {
    if (!range) {
      setSelectedCommentLines((current) =>
        current?.chunkId === chunkId ? undefined : current
      );
      return;
    }

    setSelectedCommentLines({ chunkId, path, range });
    setLineCommentBody('');
  }

  function handleSubmitLineComment(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const selection = normalizeReviewLineSelection(selectedCommentLines?.range ?? null);

    if (
      !selectedCommentLines ||
      !selection ||
      selection.side !== selection.startSide ||
      !lineCommentBody.trim()
    ) {
      return;
    }

    lineCommentMutation.mutate({
      body: lineCommentBody.trim(),
      path: selectedCommentLines.path,
      line: selection.line,
      side: selection.side,
      startLine: selection.startLine,
      startSide: selection.startLine ? selection.startSide : undefined
    });
  }

  const lineCollaboration: ReviewLineCollaboration | undefined = onAddDraftLineComment
    ? {
        threads: commentThreads,
        selectedChunkId: selectedCommentLines?.chunkId,
        selectedPath: selectedCommentLines?.path,
        selectedLines: selectedCommentLines?.range ?? null,
        body: lineCommentBody,
        isSubmitting: lineCommentMutation.isPending,
        errorMessage:
          lineCommentMutation.error instanceof Error
            ? lineCommentMutation.error.message
            : undefined,
        onSelectLines: handleSelectCommentLines,
        onBodyChange: setLineCommentBody,
        onCancel: () => {
          setSelectedCommentLines(undefined);
          setLineCommentBody('');
          lineCommentMutation.reset();
        },
        onSubmit: handleSubmitLineComment,
        onAddDraftReply,
        onRemoveDraftComment
      }
    : undefined;

  return (
    <section ref={sectionRef} className="review-view" tabIndex={0} onKeyDown={handleKeyDown}>
      <div className="review-toolbar">
        <div className="review-toolbar-primary">
          {target.kind === 'branch' ? (
            <span
              className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-field)] px-2.5 text-[11px] font-semibold text-[var(--text-2)]"
              title={`Review all changes on ${target.name}`}
            >
              <GitBranch size={12} className="shrink-0" />
              <span className="max-w-48 truncate">{target.name}</span>
            </span>
          ) : null}
          <ReviewFilterMenu
            preferences={preferences}
            activeCount={activeFilterCount}
            onChange={updatePreferences}
            onConfigurePatterns={() => setIsPatternEditorOpen(true)}
          />
          <ReviewProgress presentation={presentation} />
        </div>

        <div className="review-toolbar-actions">
          {!embeddedPlan && reviewPlan?.units.length ? (
            <ReviewGuideControl state={currentReviewGuideState} onStart={() => void startReviewGuide()} />
          ) : null}
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

      {!embeddedPlan ? <ReviewGuideBanner state={currentReviewGuideState} guide={reviewGuide} /> : null}

      <ReviewBody
        isLoading={embeddedPlan ? false : reviewQuery.isLoading}
        errorMessage={
          !embeddedPlan && reviewQuery.error instanceof Error
            ? reviewQuery.error.message
            : undefined
        }
        hasReviewUnits={Boolean(reviewPlan?.units.length)}
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
        lineCollaboration={lineCollaboration}
        reviewGuideUnits={reviewGuideUnits}
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

function ReviewGuideControl({
  state,
  onStart
}: {
  state: GitReviewGuideState | undefined;
  onStart: () => void;
}): ReactElement {
  if (state?.status === 'running') {
    return (
      <span className="review-guide-control" aria-live="polite">
        <Loader2 size={12} className="animate-spin" />
        AI guide
      </span>
    );
  }

  if (state?.status === 'ready') {
    return (
      <button className="btn-subtle h-7 px-2 text-[11px]" type="button" onClick={onStart}>
        <Check size={12} />
        Rebuild AI guide
      </button>
    );
  }

  if (state?.status === 'failed') {
    return (
      <button
        className="btn-subtle h-7 px-2 text-[11px] text-[var(--danger-text)]"
        type="button"
        title={state.errorMessage}
        onClick={onStart}
      >
        <AlertTriangle size={12} />
        Retry AI guide
      </button>
    );
  }

  return (
    <button className="btn-subtle h-7 px-2 text-[11px]" type="button" onClick={onStart}>
      Build AI guide
    </button>
  );
}

function ReviewFilterMenu({
  preferences,
  activeCount,
  onChange,
  onConfigurePatterns
}: {
  preferences: ReviewPreferences;
  activeCount: number;
  onChange: (preferences: ReviewPreferences) => void;
  onConfigurePatterns: () => void;
}): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="btn-subtle h-7 px-2 text-[11px]" type="button">
          <Settings2 size={12} />
          Filters
          {activeCount > 0 ? <span className="badge-mini">{activeCount}</span> : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64" aria-label="Review filters">
        <DropdownMenuLabel>Skip from review</DropdownMenuLabel>
        <ReviewFilterMenuItem
          checked={preferences.skipTests}
          icon={<TestTube2 size={13} />}
          label="Tests and specs"
          onChange={(skipTests) => onChange({ ...preferences, skipTests })}
        />
        <ReviewFilterMenuItem
          checked={preferences.skipImports}
          icon={<PackageOpen size={13} />}
          label="Import-only changes"
          onChange={(skipImports) => onChange({ ...preferences, skipImports })}
        />
        <ReviewFilterMenuItem
          checked={preferences.skipGenerated}
          icon={<FileCog size={13} />}
          label="Generated files"
          onChange={(skipGenerated) => onChange({ ...preferences, skipGenerated })}
        />
        <ReviewFilterMenuItem
          checked={preferences.skipDeletions}
          icon={<Trash2 size={13} />}
          label="Deletions"
          onChange={(skipDeletions) => onChange({ ...preferences, skipDeletions })}
        />
        <ReviewFilterMenuItem
          checked={preferences.skipFilePatterns}
          disabled={preferences.filePatterns.length === 0}
          icon={<Settings2 size={13} />}
          label="Configured patterns"
          onChange={(skipFilePatterns) => onChange({ ...preferences, skipFilePatterns })}
        />
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onConfigurePatterns}>
          <Settings2 size={13} />
          <span>Configure file patterns…</span>
          {preferences.filePatterns.length > 0 ? (
            <span className="ml-auto text-[10px] text-[var(--text-3)]">
              {preferences.filePatterns.length}
            </span>
          ) : null}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ReviewFilterMenuItem({
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
    <DropdownMenuItem
      role="menuitemcheckbox"
      aria-checked={checked}
      disabled={disabled}
      onSelect={(event) => {
        event.preventDefault();
        onChange(!checked);
      }}
    >
      <span className="review-filter-check" data-checked={checked}>
        {checked ? <Check size={10} /> : null}
      </span>
      {icon}
      <span>{label}</span>
    </DropdownMenuItem>
  );
}

function ReviewGuideBanner({
  state,
  guide
}: {
  state: GitReviewGuideState | undefined;
  guide: GitReviewGuide | undefined;
}): ReactElement | null {
  if (state?.status === 'running') {
    return (
      <div className="review-guide-banner" data-status="running" aria-live="polite">
        <Loader2 size={13} className="animate-spin" />
        <span>AI is ranking these groups. Keep reviewing while it runs.</span>
      </div>
    );
  }

  if (state?.status === 'failed') {
    return (
      <div className="review-guide-banner" data-status="failed" aria-live="polite">
        <AlertTriangle size={13} />
        <span>
          <strong>AI guide unavailable:</strong> {state.errorMessage} Your review is unchanged.
        </span>
      </div>
    );
  }

  if (guide) {
    return (
      <div className="review-guide-banner" data-status="ready" aria-live="polite">
        <span className="review-guide-kicker">Change intent</span>
        <span>{guide.summary}</span>
      </div>
    );
  }

  return null;
}

function ReviewGuidePriority({
  priority
}: {
  priority: GitReviewGuidePriority;
}): ReactElement {
  return (
    <span
      className="review-guide-priority"
      data-priority={priority}
      title={
        priority === 'critical'
          ? 'Must understand before approval'
          : priority === 'review'
            ? 'Read with normal focus'
            : 'Low-risk or mechanical change'
      }
    >
      {priority}
    </span>
  );
}

function ReviewGuideUnitDetails({
  guideUnit
}: {
  guideUnit: GitReviewGuideUnit;
}): ReactElement {
  return (
    <section className="review-guide-unit-details" aria-label="AI guide for this review group">
      <div className="review-guide-unit-priority">
        <ReviewGuidePriority priority={guideUnit.priority} />
      </div>
      <div>
        <span className="review-guide-kicker">Why this changed</span>
        <p>{guideUnit.why}</p>
      </div>
      <div>
        <span className="review-guide-kicker">What changed</span>
        <p>{guideUnit.what}</p>
      </div>
      {guideUnit.confirmedIssues.map((issue) => (
        <div className="review-guide-issue" key={`${issue.path}:${issue.line}`}>
          <AlertTriangle size={13} />
          <div>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <strong>AI-confirmed issue</strong>
              <code>{issue.path}:{issue.line}</code>
            </div>
            <p>{issue.summary} {issue.evidence}</p>
          </div>
        </div>
      ))}
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
  lineCollaboration,
  reviewGuideUnits,
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
  diffOptions: FileDiffOptions<ReviewLineCommentThread>;
  isMutating: boolean;
  mutationError?: string;
  lineCollaboration?: ReviewLineCollaboration;
  reviewGuideUnits: ReadonlyMap<string, GitReviewGuideUnit>;
  onSelectUnit: (unitId: string) => void;
  onToggleViewed: () => void;
}): ReactElement {
  const reviewChunksRef = useRef<HTMLDivElement>(null);
  const [collapsedChunkIds, setCollapsedChunkIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  useEffect(() => {
    reviewChunksRef.current?.scrollTo({ top: 0 });
  }, [selectedUnit?.unit.id]);

  function toggleChunk(chunkId: string): void {
    const isCollapsing = !collapsedChunkIds.has(chunkId);

    if (isCollapsing && lineCollaboration?.selectedChunkId === chunkId) {
      lineCollaboration.onCancel();
    }

    setCollapsedChunkIds((current) => {
      const next = new Set(current);

      if (next.has(chunkId)) {
        next.delete(chunkId);
      } else {
        next.add(chunkId);
      }

      return next;
    });
  }

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
              <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
                {reviewGuideUnits.get(candidate.unit.id) ? (
                  <ReviewGuidePriority priority={reviewGuideUnits.get(candidate.unit.id)!.priority} />
                ) : null}
                <span className="min-w-0 truncate text-[10.5px] text-[var(--text-3)]">{candidate.unit.reason}</span>
              </span>
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
            {reviewGuideUnits.get(selectedUnit.unit.id) ? (
              <ReviewGuideUnitDetails guideUnit={reviewGuideUnits.get(selectedUnit.unit.id)!} />
            ) : null}
            {lineCollaboration?.selectedLines && lineCollaboration.selectedPath ? (
              <ReviewInlineComposer collaboration={lineCollaboration} />
            ) : null}
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
                          lineCollaboration={lineCollaboration}
                          isCollapsed={collapsedChunkIds.has(chunk.id)}
                          onToggleCollapsed={() => toggleChunk(chunk.id)}
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
  diffOptions,
  lineCollaboration,
  isCollapsed,
  onToggleCollapsed
}: {
  chunk: GitReviewChunk;
  preparedDiff?: PreparedReviewDiff;
  diffOptions: FileDiffOptions<ReviewLineCommentThread>;
  lineCollaboration?: ReviewLineCollaboration;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
}): ReactElement {
  const expandableDiff = preparedDiff?.expandable;
  const contextualDiffOptions = useMemo<FileDiffOptions<ReviewLineCommentThread>>(
    () => expandableDiff
      ? createReviewContextOptions(diffOptions, expandableDiff, chunk.path)
      : diffOptions,
    [chunk.path, diffOptions, expandableDiff]
  );
  const selectedLines =
    lineCollaboration?.selectedChunkId === chunk.id
      ? lineCollaboration.selectedLines
      : null;
  const lineAnnotations = useMemo<DiffLineAnnotation<ReviewLineCommentThread>[]>(
    () =>
      lineCollaboration?.threads.flatMap((thread) =>
        thread.path === chunk.path &&
        thread.line &&
        thread.side &&
        patchContainsLine(chunk.patch, thread.line, thread.side)
          ? [{
              lineNumber: thread.line,
              side: thread.side === 'right' ? 'additions' : 'deletions',
              metadata: thread
            }]
          : []
      ) ?? [],
    [chunk.patch, chunk.path, lineCollaboration?.threads]
  );
  const interactiveDiffOptions: FileDiffOptions<ReviewLineCommentThread> = lineCollaboration
    ? {
        ...contextualDiffOptions,
        enableLineSelection: true,
        controlledSelection: true,
        lineHoverHighlight: 'both',
        onLineSelected: (range) =>
          lineCollaboration.onSelectLines(chunk.id, chunk.path, range)
      }
    : contextualDiffOptions;

  return (
    <section className="review-chunk" data-collapsed={isCollapsed}>
      <button
        className="review-chunk-header"
        type="button"
        aria-expanded={!isCollapsed}
        aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${chunk.path}`}
        onClick={onToggleCollapsed}
      >
        {isCollapsed ? (
          <ChevronRight size={13} className="shrink-0 text-[var(--text-3)]" />
        ) : (
          <ChevronDown size={13} className="shrink-0 text-[var(--text-3)]" />
        )}
        <FileCode2 size={13} className="shrink-0 text-[var(--accent-2)]" />
        <span className="min-w-0 flex-1 truncate font-medium text-[var(--text-2)]">{chunk.path}</span>
        <span className="badge-mini" title={chunk.relationship}>{chunk.role}</span>
        {chunk.source !== 'commit' ? <span className="badge-mini">{chunk.source}</span> : null}
        <span className="text-[var(--success-text)]">+{chunk.additions}</span>
        <span className="text-[var(--danger-text)]">-{chunk.deletions}</span>
      </button>
      {!isCollapsed && chunk.omittedReason ? (
        <div className="grid min-h-28 place-items-center px-4 text-center text-xs text-[var(--text-3)]">
          {chunk.omittedReason === 'binary'
            ? 'Binary changes cannot be previewed.'
            : chunk.omittedReason === 'too-large'
              ? 'This change exceeds the review preview limit.'
              : 'No textual diff is available for this change.'}
        </div>
      ) : !isCollapsed ? (
        preparedDiff ? (
          <FileDiff<ReviewLineCommentThread>
            className="gg-diff"
            fileDiff={preparedDiff.fileDiff}
            options={interactiveDiffOptions}
            lineAnnotations={lineAnnotations}
            selectedLines={selectedLines}
            renderAnnotation={(annotation) => (
              <ReviewLineCommentAnnotation
                thread={annotation.metadata}
                onAddDraftReply={lineCollaboration?.onAddDraftReply}
                onRemoveDraftComment={lineCollaboration?.onRemoveDraftComment}
              />
            )}
          />
        ) : (
          <PatchDiff<ReviewLineCommentThread>
            className="gg-diff"
            patch={chunk.patch}
            options={interactiveDiffOptions}
            lineAnnotations={lineAnnotations}
            selectedLines={selectedLines}
            renderAnnotation={(annotation) => (
              <ReviewLineCommentAnnotation
                thread={annotation.metadata}
                onAddDraftReply={lineCollaboration?.onAddDraftReply}
                onRemoveDraftComment={lineCollaboration?.onRemoveDraftComment}
              />
            )}
          />
        )
      ) : null}
    </section>
  );
}

function ReviewInlineComposer({
  collaboration
}: {
  collaboration: ReviewLineCollaboration;
}): ReactElement {
  const normalizedSelection = normalizeReviewLineSelection(collaboration.selectedLines);
  const canSubmitLineComment = Boolean(
    normalizedSelection &&
      normalizedSelection.side === normalizedSelection.startSide &&
      collaboration.body.trim()
  );

  return (
    <form className="review-inline-composer" onSubmit={collaboration.onSubmit}>
      <div className="review-inline-composer-label">
        <MessageSquare size={13} />
        {normalizedSelection
          ? `Draft comment on ${collaboration.selectedPath}:${formatReviewLineSelection(normalizedSelection)}`
          : 'Select lines from only one side of the diff to comment.'}
      </div>
      <textarea
        rows={3}
        value={collaboration.body}
        placeholder="Leave an inline review comment…"
        aria-label="Inline review comment"
        onChange={(event) => collaboration.onBodyChange(event.target.value)}
      />
      <p className="review-inline-composer-hint">
        Saved in Git Gud only. Nothing is posted until you submit the review.
      </p>
      {collaboration.errorMessage ? (
        <p className="review-inline-comment-error">{collaboration.errorMessage}</p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <button
          className="btn-subtle h-7 text-[11px]"
          type="button"
          onClick={collaboration.onCancel}
        >
          Cancel
        </button>
        <button
          className="btn-primary h-7 text-[11px]"
          type="submit"
          disabled={!canSubmitLineComment || collaboration.isSubmitting}
        >
          {collaboration.isSubmitting
            ? <Loader2 size={12} className="animate-spin" />
            : <Send size={12} />}
          Add to review
        </button>
      </div>
    </form>
  );
}

function ReviewLineCommentAnnotation({
  thread,
  onAddDraftReply,
  onRemoveDraftComment
}: {
  thread: ReviewLineCommentThread;
  onAddDraftReply?: (input: ReviewLineReplyInput) => Promise<void>;
  onRemoveDraftComment?: (id: string) => void;
}): ReactElement {
  const [isReplying, setIsReplying] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const replyMutation = useMutation({
    mutationFn: async () => {
      if (
        typeof thread.id !== 'number' ||
        !onAddDraftReply ||
        !replyBody.trim()
      ) {
        throw new Error('Replies are unavailable for this comment.');
      }
      await onAddDraftReply({
        body: replyBody.trim(),
        inReplyToId: thread.id
      });
    },
    onSuccess: () => {
      setReplyBody('');
      setIsReplying(false);
    }
  });
  const canReply =
    !thread.isDraft &&
    typeof thread.id === 'number' &&
    Boolean(onAddDraftReply);

  return (
    <article className="review-line-comment" data-draft={thread.isDraft}>
      <header>
        <ReviewCommentAvatar comment={thread} />
        <strong>{thread.author}</strong>
        {thread.isDraft ? (
          <span className="review-line-comment-draft">
            <Clock3 size={10} />
            Draft
          </span>
        ) : null}
        <time dateTime={thread.createdAt}>{formatReviewCommentDate(thread.createdAt)}</time>
      </header>
      <ReviewCommentBody body={thread.body} />
      {thread.replies.length > 0 ? (
        <div className="review-line-comment-replies">
          {thread.replies.map((reply) => (
            <div className="review-line-comment-reply" data-draft={reply.isDraft} key={reply.id}>
              <div className="review-line-comment-reply-meta">
                <ReviewCommentAvatar comment={reply} />
                <strong>{reply.author}</strong>
                {reply.isDraft ? (
                  <span className="review-line-comment-draft">
                    <Clock3 size={10} />
                    Draft
                  </span>
                ) : (
                  <time dateTime={reply.createdAt}>{formatReviewCommentDate(reply.createdAt)}</time>
                )}
                {reply.isDraft && onRemoveDraftComment ? (
                  <button
                    type="button"
                    onClick={() => onRemoveDraftComment(String(reply.id))}
                    aria-label="Remove draft reply"
                  >
                    <Trash2 size={11} />
                  </button>
                ) : null}
              </div>
              <ReviewCommentBody body={reply.body} compact />
            </div>
          ))}
        </div>
      ) : null}
      <footer className="review-line-comment-actions">
        {thread.isDraft && onRemoveDraftComment ? (
          <button
            type="button"
            onClick={() => onRemoveDraftComment(String(thread.id))}
          >
            <Trash2 size={11} />
            Remove draft
          </button>
        ) : null}
        {canReply ? (
          <button type="button" onClick={() => setIsReplying((current) => !current)}>
            <Reply size={11} />
            Reply
          </button>
        ) : null}
      </footer>
      {isReplying ? (
        <form
          className="review-line-comment-reply-form"
          onSubmit={(event) => {
            event.preventDefault();
            replyMutation.mutate();
          }}
        >
          <textarea
            rows={3}
            value={replyBody}
            placeholder={`Reply to ${thread.author}…`}
            aria-label={`Reply to ${thread.author}`}
            onChange={(event) => setReplyBody(event.target.value)}
          />
          <p>Saved as a draft until you submit the review.</p>
          {replyMutation.error instanceof Error ? (
            <span>{replyMutation.error.message}</span>
          ) : null}
          <div>
            <button
              className="btn-subtle h-7 text-[11px]"
              type="button"
              onClick={() => {
                setIsReplying(false);
                setReplyBody('');
                replyMutation.reset();
              }}
            >
              Cancel
            </button>
            <button
              className="btn-primary h-7 text-[11px]"
              type="submit"
              disabled={!replyBody.trim() || replyMutation.isPending}
            >
              {replyMutation.isPending
                ? <Loader2 size={11} className="animate-spin" />
                : <Reply size={11} />}
              Add reply to review
            </button>
          </div>
        </form>
      ) : null}
    </article>
  );
}

function ReviewCommentAvatar({
  comment
}: {
  comment: ReviewLineComment;
}): ReactElement {
  const [didAvatarFail, setDidAvatarFail] = useState(false);

  return comment.authorAvatarUrl && !didAvatarFail ? (
    <img
      className="review-line-comment-avatar"
      src={comment.authorAvatarUrl}
      alt=""
      aria-hidden="true"
      onError={() => setDidAvatarFail(true)}
    />
  ) : (
    <span className="review-line-comment-avatar" aria-hidden="true">
      {comment.author.slice(0, 1).toUpperCase()}
    </span>
  );
}

function ReviewCommentBody({
  body,
  compact = false
}: {
  body: string;
  compact?: boolean;
}): ReactElement {
  const withoutMetadata = body
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/<details>[\s\S]*?<\/details>/gu, '')
    .trim();
  const visibleBody = withoutMetadata || body.trim();
  const blocks = visibleBody.split(/\n{2,}/gu);

  return (
    <div className="review-line-comment-body" data-compact={compact}>
      {blocks.map((block, index) => (
        <p key={`${index}:${block.slice(0, 24)}`}>
          {renderInlineReviewMarkdown(block)}
        </p>
      ))}
    </div>
  );
}

function renderInlineReviewMarkdown(value: string): ReactNode[] {
  return value
    .split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|_[^_\n]+_)/gu)
    .filter(Boolean)
    .map((part, index) => {
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={`${index}:${part}`}>{part.slice(1, -1)}</code>;
      }
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={`${index}:${part}`}>{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith('_') && part.endsWith('_')) {
        return <em key={`${index}:${part}`}>{part.slice(1, -1)}</em>;
      }
      return part;
    });
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

function loadEmbeddedReviewProgress(
  storage: Storage,
  progressKey: string | undefined,
  plan: GitReviewPlan
): string[] {
  if (!progressKey) {
    return plan.reviewedChunkIds;
  }

  try {
    const value = JSON.parse(storage.getItem(`git-gud:review-progress:${progressKey}`) ?? '[]') as unknown;
    if (!Array.isArray(value) || !value.every((chunkId) => typeof chunkId === 'string')) {
      return plan.reviewedChunkIds;
    }

    const validChunkIds = new Set(
      plan.units.flatMap((unit) => unit.chunks.map((chunk) => chunk.id))
    );
    return value.filter((chunkId) => validChunkIds.has(chunkId));
  } catch {
    return plan.reviewedChunkIds;
  }
}

function saveEmbeddedReviewProgress(
  storage: Storage,
  progressKey: string | undefined,
  reviewedChunkIds: string[]
): void {
  if (progressKey) {
    storage.setItem(
      `git-gud:review-progress:${progressKey}`,
      JSON.stringify(reviewedChunkIds)
    );
  }
}

function normalizeReviewLineSelection(range: SelectedLineRange | null): {
  startLine?: number;
  startSide: 'left' | 'right';
  line: number;
  side: 'left' | 'right';
} | undefined {
  if (!range?.side) {
    return undefined;
  }

  return {
    startLine: range.start === range.end ? undefined : range.start,
    startSide: range.side === 'additions' ? 'right' : 'left',
    line: range.end,
    side: (range.endSide ?? range.side) === 'additions' ? 'right' : 'left'
  };
}

function formatReviewLineSelection(
  selection: ReturnType<typeof normalizeReviewLineSelection>
): string {
  if (!selection) {
    return '';
  }
  return selection.startLine
    ? `${selection.startLine}-${selection.line}`
    : String(selection.line);
}

function createReviewCommentThreads(
  comments: ReviewLineComment[]
): ReviewLineCommentThread[] {
  const repliesByParent = new Map<string, ReviewLineComment[]>();

  for (const comment of comments) {
    if (comment.inReplyToId === undefined) {
      continue;
    }
    const parentId = String(comment.inReplyToId);
    repliesByParent.set(parentId, [
      ...(repliesByParent.get(parentId) ?? []),
      comment
    ]);
  }

  return comments
    .filter((comment) => comment.inReplyToId === undefined)
    .map((comment) => ({
      ...comment,
      replies: repliesByParent.get(String(comment.id)) ?? []
    }));
}

function patchContainsLine(
  patch: string,
  targetLine: number,
  side: 'left' | 'right'
): boolean {
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const line of patch.split('\n')) {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk || line.startsWith('\\')) {
      continue;
    }
    if (line.startsWith('+')) {
      if (side === 'right' && newLine === targetLine) {
        return true;
      }
      newLine += 1;
      continue;
    }
    if (line.startsWith('-')) {
      if (side === 'left' && oldLine === targetLine) {
        return true;
      }
      oldLine += 1;
      continue;
    }
    if (
      (side === 'left' && oldLine === targetLine) ||
      (side === 'right' && newLine === targetLine)
    ) {
      return true;
    }
    oldLine += 1;
    newLine += 1;
  }

  return false;
}

function formatReviewCommentDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
