import type {
  CSSProperties,
  FormEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement
} from 'react';
import {
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import type { DiffLineAnnotation, FileDiffOptions, SelectedLineRange } from '@pierre/diffs';
import { FileDiff, PatchDiff, useWorkerPool } from '@pierre/diffs/react';
import { prepareFileTreeInput } from '@pierre/trees';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Columns2,
  Clock3,
  FileCode2,
  FileCog,
  FolderTree,
  GitBranch,
  Loader2,
  MessageSquare,
  PackageOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Rows3,
  Search,
  Reply,
  Send,
  Settings2,
  SkipForward,
  Sparkles,
  TestTube2,
  Trash2,
  X
} from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';

import { createDiffOptionsBase, type DiffStyle } from '@renderer/components/commit/fileDetailUtils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu';
import { ReviewCommentBody } from '@renderer/components/review/ReviewCommentBody';
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
import {
  createReviewContextOptions,
  shareReviewExpansionBoundary
} from './reviewContextExpansion';
import {
  createReviewFileTreeEntries,
  DEFAULT_REVIEW_FILE_TREE_WIDTH,
  findAdjacentReviewFilePath,
  findReviewUnitIdForPath,
  loadReviewFileTreeOpen,
  loadReviewFileTreeWidth,
  MAX_REVIEW_FILE_TREE_WIDTH,
  MIN_REVIEW_FILE_TREE_WIDTH,
  normalizeReviewFileTreeWidth,
  saveReviewFileTreeOpen,
  saveReviewFileTreeWidth
} from './reviewFileTree';
import { rankReviewUnitsByGuide } from './reviewGuidePresentation';
import { normalizeReviewLineSelection } from './reviewLineSelection';
import { ReviewPatternsDialog } from './ReviewPatternsDialog';
import {
  createReviewSearchResults,
  normalizeReviewSearchSelection,
  readReviewSearchSelection,
  type ReviewSearchInclusion,
  type ReviewSearchLine,
  type ReviewSearchResults,
  type ReviewSearchScope
} from './reviewSearch';
import { createReviewSections } from './reviewSections';

type ReviewViewProps = {
  repoPath: string;
  target: GitReviewTarget;
  plan?: GitReviewPlan;
  initialPreferences?: ReviewPreferences;
  reviewGuideProvider?: {
    getState: (sourceFingerprint: string) => Promise<GitReviewGuideState>;
    start: (sourceFingerprint: string) => Promise<GitReviewGuideState>;
  };
  reviewProgressKey?: string;
  lineComments?: ReviewLineComment[];
  onAddDraftLineComment?: (input: ReviewLineCommentInput) => Promise<void>;
  onAddDraftFileComment?: (input: ReviewFileCommentInput) => Promise<void>;
  onAddDraftReply?: (input: ReviewLineReplyInput) => Promise<void>;
  onUpdateComment?: (commentId: number, body: string) => Promise<void>;
  onRemoveDraftComment?: (id: string) => void;
  diffStyle: DiffStyle;
  diffSyntaxTheme: DiffSyntaxTheme;
  onSetDiffStyle: (style: DiffStyle) => void;
  onClose: () => void;
  closeLabel?: string;
  showCloseButton?: boolean;
};

export type ReviewLineComment = {
  id: string | number;
  body: string;
  author: string;
  authorAvatarUrl?: string;
  createdAt: string;
  path: string;
  subjectType: 'line' | 'file';
  line?: number;
  side?: 'left' | 'right';
  inReplyToId?: string | number;
  isDraft?: boolean;
  canEdit?: boolean;
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

export type ReviewFileCommentInput = {
  body: string;
  path: string;
};

type ReviewCommentThread = ReviewLineComment & {
  replies: ReviewLineComment[];
};

type ReviewDiffAnnotation =
  | { kind: 'thread'; thread: ReviewCommentThread }
  | { kind: 'composer' };

type ReviewCommentTarget =
  | { kind: 'line'; chunkId: string; path: string; range: SelectedLineRange }
  | { kind: 'file'; chunkId: string; path: string };

type ReviewLineCollaboration = {
  threads: ReviewCommentThread[];
  selectedChunkId?: string;
  selectedPath?: string;
  selectedSubject?: 'line' | 'file';
  selectedLines: SelectedLineRange | null;
  getBody: () => string;
  isSubmitting: boolean;
  errorMessage?: string;
  onSelectLines: (chunkId: string, path: string, range: SelectedLineRange | null) => void;
  onSelectFile: (chunkId: string, path: string) => void;
  onBodyChange: (body: string) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>, body: string) => void;
  onAddDraftReply?: (input: ReviewLineReplyInput) => Promise<void>;
  onUpdateComment?: (commentId: number, body: string) => Promise<void>;
  onRemoveDraftComment?: (id: string) => void;
};

type ReviewCommentBodyBuffer = {
  get: () => string;
  set: (body: string) => void;
  clear: () => void;
};

type ReviewSearchSession = {
  sourceFingerprint: string;
  query: string;
  scope: ReviewSearchScope;
  inclusion: ReviewSearchInclusion;
};

type ReviewSearchViewState = ReviewSearchSession & {
  activeLocationIndex: number;
  focusSignal: number;
  isSearching: boolean;
  isSelected: boolean;
  preparedDiffs: ReadonlyMap<string, PreparedReviewDiff>;
  results: ReviewSearchResults;
  onActiveLocationIndexChange: (index: number) => void;
  onClose: () => void;
  onInclusionChange: (inclusion: ReviewSearchInclusion) => void;
  onQueryChange: (query: string) => void;
  onScopeChange: (scope: ReviewSearchScope) => void;
  onSelect: () => void;
};

export function ReviewView({
  repoPath,
  target,
  plan: embeddedPlan,
  initialPreferences,
  reviewGuideProvider,
  reviewProgressKey,
  lineComments = [],
  onAddDraftLineComment,
  onAddDraftFileComment,
  onAddDraftReply,
  onUpdateComment,
  onRemoveDraftComment,
  diffStyle,
  diffSyntaxTheme,
  onSetDiffStyle,
  onClose,
  closeLabel = 'Close review',
  showCloseButton = true
}: ReviewViewProps): ReactElement {
  const sectionRef = useRef<HTMLElement>(null);
  const workerPool = useWorkerPool();
  const queryClient = useQueryClient();
  const [preferences, setPreferences] = useState<ReviewPreferences>(() =>
    initialPreferences
      ? { ...initialPreferences, filePatterns: [...initialPreferences.filePatterns] }
      : loadReviewPreferences(window.localStorage, repoPath)
  );
  const [isPatternEditorOpen, setIsPatternEditorOpen] = useState(false);
  const [isFileTreeOpen, setIsFileTreeOpen] = useState(() =>
    loadReviewFileTreeOpen(window.localStorage, repoPath)
  );
  const [selectedUnitId, setSelectedUnitId] = useState<string>();
  const [requestedFilePath, setRequestedFilePath] = useState<string>();
  const [reviewSearch, setReviewSearch] = useState<ReviewSearchSession>();
  const [isReviewSearchSelected, setIsReviewSearchSelected] = useState(false);
  const [reviewSearchFocusSignal, setReviewSearchFocusSignal] = useState(0);
  const [activeReviewSearchLocationIndex, setActiveReviewSearchLocationIndex] = useState(0);
  const [embeddedReviewedChunkIds, setEmbeddedReviewedChunkIds] = useState<string[]>(() =>
    embeddedPlan
      ? loadEmbeddedReviewProgress(window.localStorage, reviewProgressKey, embeddedPlan)
      : []
  );
  const [selectedCommentTarget, setSelectedCommentTarget] = useState<ReviewCommentTarget>();
  const [lineCommentBody] = useState<ReviewCommentBodyBuffer>(createReviewCommentBodyBuffer);
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
  const isReviewGuideEnabled = !embeddedPlan || reviewGuideProvider !== undefined;
  const currentReviewGuideState: GitReviewGuideState | undefined =
    isReviewGuideEnabled && reviewPlan
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
  const selectedFilePath =
    requestedFilePath &&
    selectedUnit?.visibleChunks.some((chunk) => chunk.path === requestedFilePath)
      ? requestedFilePath
      : selectedUnit?.visibleChunks[0]?.path;
  const currentReviewSearch =
    reviewSearch?.sourceFingerprint === reviewPlan?.sourceFingerprint
      ? reviewSearch
      : undefined;
  const reviewSearchScope = currentReviewSearch?.scope;
  const reviewSearchInclusion = currentReviewSearch?.inclusion;
  const deferredReviewSearchQuery = useDeferredValue(currentReviewSearch?.query ?? '');
  const reviewSearchResults = useMemo(
    () =>
      reviewPlan && presentation && reviewSearchScope && reviewSearchInclusion
        ? createReviewSearchResults(
            reviewPlan,
            presentation.units,
            deferredReviewSearchQuery,
            reviewSearchScope,
            reviewSearchInclusion
          )
        : {
            files: [],
            locationCount: 0,
            limitReached: false,
            fullFileFallbackCount: 0
          },
    [
      deferredReviewSearchQuery,
      presentation,
      reviewPlan,
      reviewSearchInclusion,
      reviewSearchScope
    ]
  );
  const preparedDiffCacheKeyPrefix = `${repoPath}:${reviewPlan?.targetKey ?? targetKey(target)}`;
  const selectedPreparedDiffs = useMemo(
    () => prepareReviewUnitDiffs(
      selectedUnit,
      fileContexts,
      preparedDiffCacheKeyPrefix
    ),
    [fileContexts, preparedDiffCacheKeyPrefix, selectedUnit]
  );
  const reviewSearchPreparedDiffs = useMemo(
    () => prepareReviewChunkDiffs(
      reviewSearchResults.files.map((file) => file.chunk),
      fileContexts,
      preparedDiffCacheKeyPrefix
    ),
    [fileContexts, preparedDiffCacheKeyPrefix, reviewSearchResults.files]
  );
  const commentThreads = useMemo(
    () => createReviewCommentThreads(lineComments),
    [lineComments]
  );
  const diffOptions = useMemo<FileDiffOptions<ReviewDiffAnnotation>>(
    () => ({
      ...createDiffOptionsBase<ReviewDiffAnnotation>(diffSyntaxTheme),
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
  const commentMutation = useMutation({
    mutationFn: async (
      input:
        | { kind: 'line'; comment: ReviewLineCommentInput }
        | { kind: 'file'; comment: ReviewFileCommentInput }
    ) => {
      if (input.kind === 'line') {
        if (!onAddDraftLineComment) {
          throw new Error('Line comments are unavailable for this review.');
        }
        await onAddDraftLineComment(input.comment);
        return;
      }
      if (!onAddDraftFileComment) {
        throw new Error('File comments are unavailable for this review.');
      }
      await onAddDraftFileComment(input.comment);
    },
    onSuccess: () => {
      setSelectedCommentTarget(undefined);
      lineCommentBody.clear();
    }
  });

  useEffect(() => {
    sectionRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const sourceFingerprint = reviewPlan?.sourceFingerprint;

    if (!isReviewGuideEnabled || !sourceFingerprint) {
      return;
    }

    let cancelled = false;
    const stateRequest = reviewGuideProvider
      ? reviewGuideProvider.getState(sourceFingerprint)
      : window.api.getReviewGuideState(repoPath, sourceFingerprint);
    void stateRequest
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
  }, [
    isReviewGuideEnabled,
    repoPath,
    reviewGuideProvider,
    reviewPlan?.sourceFingerprint
  ]);

  useEffect(() => {
    if (currentReviewGuideState?.status !== 'running') {
      return;
    }

    const sourceFingerprint = currentReviewGuideState.sourceFingerprint;
    let cancelled = false;
    const refresh = (): void => {
      const stateRequest = reviewGuideProvider
        ? reviewGuideProvider.getState(sourceFingerprint)
        : window.api.getReviewGuideState(repoPath, sourceFingerprint);
      void stateRequest
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
  }, [
    currentReviewGuideState?.sourceFingerprint,
    currentReviewGuideState?.status,
    repoPath,
    reviewGuideProvider
  ]);

  useEffect(() => {
    if (!workerPool || !selectedUnit || !presentation) {
      return;
    }

    const activePreparedDiffs = isReviewSearchSelected
      ? reviewSearchPreparedDiffs
      : selectedPreparedDiffs;

    for (const prepared of activePreparedDiffs.values()) {
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
    isReviewSearchSelected,
    reviewSearchPreparedDiffs,
    selectedPreparedDiffs,
    selectedUnit,
    workerPool
  ]);

  function updatePreferences(next: ReviewPreferences): void {
    if (selectedCommentTarget) {
      return;
    }
    setPreferences(next);
    saveReviewPreferences(window.localStorage, repoPath, next);
  }

  function setFileTreeOpen(isOpen: boolean): void {
    setIsFileTreeOpen(isOpen);
    saveReviewFileTreeOpen(window.localStorage, repoPath, isOpen);
  }

  function cancelCommentComposer(): void {
    setSelectedCommentTarget(undefined);
    lineCommentBody.clear();
    commentMutation.reset();
  }

  function selectReviewUnit(unitId: string): void {
    setIsReviewSearchSelected(false);

    if (
      unitId === selectedUnit?.unit.id ||
      selectedCommentTarget !== undefined ||
      commentMutation.isPending
    ) {
      return;
    }
    setSelectedUnitId(unitId);
  }

  function openReviewSearch(selection = ''): void {
    if (!reviewPlan) {
      return;
    }

    const normalizedSelection = normalizeReviewSearchSelection(selection);

    setReviewSearch((current) => {
      const previous =
        current?.sourceFingerprint === reviewPlan.sourceFingerprint
          ? current
          : undefined;

      return {
        sourceFingerprint: reviewPlan.sourceFingerprint,
        query: normalizedSelection || previous?.query || '',
        scope: previous?.scope ?? 'changed-lines',
        inclusion: previous?.inclusion ?? 'whole-review'
      };
    });
    setIsReviewSearchSelected(true);
    setActiveReviewSearchLocationIndex(0);
    setReviewSearchFocusSignal((signal) => signal + 1);
  }

  function closeReviewSearch(): void {
    setReviewSearch(undefined);
    setIsReviewSearchSelected(false);
    setActiveReviewSearchLocationIndex(0);
    window.requestAnimationFrame(() => sectionRef.current?.focus({ preventScroll: true }));
  }

  function updateReviewSearch(
    next: Partial<Pick<ReviewSearchSession, 'query' | 'scope' | 'inclusion'>>
  ): void {
    setReviewSearch((current) => {
      if (!current || current.sourceFingerprint !== reviewPlan?.sourceFingerprint) {
        return current;
      }

      return { ...current, ...next };
    });
    setActiveReviewSearchLocationIndex(0);
  }

  async function startReviewGuide(): Promise<void> {
    if (!isReviewGuideEnabled || !reviewPlan || currentReviewGuideState?.status === 'running') {
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
      const state = reviewGuideProvider
        ? await reviewGuideProvider.start(sourceFingerprint)
        : await window.api.startReviewGuide(repoPath, target, sourceFingerprint);
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
      { onSuccess: () => nextUnitId && selectReviewUnit(nextUnitId) }
    );
  }

  function navigateUnits(direction: -1 | 1): void {
    const units = presentation?.units ?? [];
    const currentIndex = units.findIndex((candidate) => candidate.unit.id === selectedUnit?.unit.id);
    const nextIndex = currentIndex === -1 ? 0 : currentIndex + direction;
    const nextUnit = units[nextIndex];

    if (nextUnit) {
      selectReviewUnit(nextUnit.unit.id);
    }
  }

  function selectFile(path: string | undefined): void {
    setRequestedFilePath(path);

    if (!path) {
      return;
    }

    const unitId = selectedUnit?.visibleChunks.some((chunk) => chunk.path === path)
      ? selectedUnit.unit.id
      : findReviewUnitIdForPath(presentation?.units ?? [], path);

    if (unitId) {
      selectReviewUnit(unitId);
    }
  }

  function navigateFiles(direction: -1 | 1): void {
    if (
      isReviewSearchSelected ||
      !selectedUnit ||
      selectedCommentTarget !== undefined ||
      commentMutation.isPending
    ) {
      return;
    }

    const path = findAdjacentReviewFilePath(
      selectedUnit.visibleChunks,
      selectedFilePath,
      direction
    );

    if (path) {
      selectFile(path);
    }
  }

  function scrollReviewPage(direction: -1 | 1): void {
    const scroller = sectionRef.current?.querySelector<HTMLElement>('.review-chunks');

    if (!scroller) {
      return;
    }

    scroller.scrollTop +=
      direction * Math.max(1, Math.round(scroller.clientHeight * 0.85));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === 'f'
    ) {
      if (selectedCommentTarget !== undefined || commentMutation.isPending) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (isReviewSearchInput(event.target)) {
        setIsReviewSearchSelected(true);
        setReviewSearchFocusSignal((signal) => signal + 1);
        return;
      }

      openReviewSearch(readSelectedReviewText());
      return;
    }

    if (isReviewSearchSelected && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeReviewSearch();
      return;
    }

    if (
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      isEditableTarget(event.target) ||
      isReviewFileTreeTarget(event.target)
    ) {
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
    } else if (event.key === ']') {
      event.preventDefault();
      navigateFiles(1);
    } else if (event.key === '[') {
      event.preventDefault();
      navigateFiles(-1);
    } else if (
      (event.key === 'PageDown' || event.key === 'PageUp') &&
      !isReviewUnitRowTarget(event.target)
    ) {
      event.preventDefault();
      scrollReviewPage(event.key === 'PageDown' ? 1 : -1);
    } else if (
      event.key === 'Enter' &&
      (event.target === event.currentTarget || isReviewUnitRowTarget(event.target))
    ) {
      event.preventDefault();
      markSelectedUnit(!(selectedUnit?.isViewed ?? false));
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
      if (selectedCommentTarget?.kind === 'line' && selectedCommentTarget.chunkId === chunkId) {
        cancelCommentComposer();
      }
      return;
    }

    setSelectedCommentTarget({ kind: 'line', chunkId, path, range });
    commentMutation.reset();
  }

  function handleSelectCommentFile(chunkId: string, path: string): void {
    setSelectedCommentTarget({ kind: 'file', chunkId, path });
    commentMutation.reset();
  }

  function handleSubmitComment(event: FormEvent<HTMLFormElement>, body: string): void {
    event.preventDefault();
    const trimmedBody = body.trim();

    if (!selectedCommentTarget || !trimmedBody) {
      return;
    }
    if (selectedCommentTarget.kind === 'file') {
      commentMutation.mutate({
        kind: 'file',
        comment: { body: trimmedBody, path: selectedCommentTarget.path }
      });
      return;
    }
    const selection = normalizeReviewLineSelection(selectedCommentTarget.range);

    if (
      !selection ||
      selection.side !== selection.startSide
    ) {
      return;
    }

    commentMutation.mutate({
      kind: 'line',
      comment: {
        body: trimmedBody,
        path: selectedCommentTarget.path,
        line: selection.line,
        side: selection.side,
        startLine: selection.startLine,
        startSide: selection.startLine ? selection.startSide : undefined
      }
    });
  }

  const lineCollaboration: ReviewLineCollaboration | undefined =
    onAddDraftLineComment && onAddDraftFileComment
    ? {
        threads: commentThreads,
        selectedChunkId: selectedCommentTarget?.chunkId,
        selectedPath: selectedCommentTarget?.path,
        selectedSubject: selectedCommentTarget?.kind,
        selectedLines:
          selectedCommentTarget?.kind === 'line' ? selectedCommentTarget.range : null,
        getBody: lineCommentBody.get,
        isSubmitting: commentMutation.isPending,
        errorMessage:
          commentMutation.error instanceof Error
            ? commentMutation.error.message
            : undefined,
        onSelectLines: handleSelectCommentLines,
        onSelectFile: handleSelectCommentFile,
        onBodyChange: lineCommentBody.set,
        onCancel: cancelCommentComposer,
        onSubmit: handleSubmitComment,
        onAddDraftReply,
        onUpdateComment,
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
            disabled={selectedCommentTarget !== undefined}
            onChange={updatePreferences}
            onConfigurePatterns={() => setIsPatternEditorOpen(true)}
          />
          <ReviewProgress presentation={presentation} />
        </div>

        <div className="review-toolbar-actions">
          {isReviewGuideEnabled && reviewPlan?.units.length ? (
            <ReviewGuideControl
              state={currentReviewGuideState}
              onStart={() => void startReviewGuide()}
            />
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
            className="icon-btn icon-btn-compact shrink-0"
            type="button"
            data-active={isFileTreeOpen}
            onClick={() => setFileTreeOpen(!isFileTreeOpen)}
            aria-label={isFileTreeOpen ? 'Hide review file tree' : 'Show review file tree'}
            aria-pressed={isFileTreeOpen}
            title={isFileTreeOpen ? 'Hide file tree' : 'Show file tree'}
          >
            {isFileTreeOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
          </button>
          {showCloseButton ? (
            <button
              className="icon-btn icon-btn-compact shrink-0"
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              title={closeLabel}
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
      </div>

      <ReviewBody
        repoPath={repoPath}
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
        reviewGuide={reviewGuide}
        reviewGuideUnits={reviewGuideUnits}
        isFileTreeOpen={isFileTreeOpen}
        selectedFilePath={selectedFilePath}
        reviewSearch={
          currentReviewSearch
            ? {
                ...currentReviewSearch,
                activeLocationIndex:
                  reviewSearchResults.locationCount === 0
                    ? 0
                    : Math.min(
                        activeReviewSearchLocationIndex,
                        reviewSearchResults.locationCount - 1
                      ),
                focusSignal: reviewSearchFocusSignal,
                isSearching: deferredReviewSearchQuery !== currentReviewSearch.query,
                isSelected: isReviewSearchSelected,
                preparedDiffs: reviewSearchPreparedDiffs,
                results: reviewSearchResults,
                onActiveLocationIndexChange: setActiveReviewSearchLocationIndex,
                onClose: closeReviewSearch,
                onInclusionChange: (inclusion) => updateReviewSearch({ inclusion }),
                onQueryChange: (query) => updateReviewSearch({ query }),
                onScopeChange: (scope) => updateReviewSearch({ scope }),
                onSelect: () => {
                  setIsReviewSearchSelected(true);
                  setReviewSearchFocusSignal((signal) => signal + 1);
                }
              }
            : undefined
        }
        onSelectUnit={selectReviewUnit}
        onSelectFile={selectFile}
        onStartReviewGuide={() => void startReviewGuide()}
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
      <ReviewGuidePopover
        guide={state.guide}
        trigger={(
          <button
            className="btn-subtle btn-compact"
            type="button"
            aria-label="Open AI guide overview"
            title="Open AI guide overview"
          >
            <Sparkles size={12} />
            AI guide
          </button>
        )}
        onStart={onStart}
      />
    );
  }

  if (state?.status === 'failed') {
    return (
      <button
        className="btn-subtle btn-compact text-[var(--danger-text)]"
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
    <button className="btn-subtle btn-compact" type="button" onClick={onStart}>
      Build AI guide
    </button>
  );
}

function ReviewGuidePopover({
  guide,
  guideUnit,
  reviewUnitTitle,
  trigger,
  align = 'end',
  onStart
}: {
  guide: GitReviewGuide;
  guideUnit?: GitReviewGuideUnit;
  reviewUnitTitle?: string;
  trigger: ReactElement;
  align?: 'start' | 'center' | 'end';
  onStart: () => void;
}): ReactElement {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        {trigger}
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          className="review-guide-popover"
          align={align}
          sideOffset={6}
          aria-label="AI guide"
        >
          <header>
            <div>
              <span className="review-guide-kicker">AI guide</span>
              <strong>{guideUnit ? reviewUnitTitle ?? 'Review block' : 'Review overview'}</strong>
            </div>
            <PopoverPrimitive.Close asChild>
              <button
                className="icon-btn icon-btn-compact"
                type="button"
                aria-label="Close AI guide"
                title="Close AI guide"
              >
                <X size={13} />
              </button>
            </PopoverPrimitive.Close>
          </header>

          <section>
            <span className="review-guide-kicker">Change intent</span>
            <p>{guide.summary}</p>
          </section>

          {guideUnit ? (
            <>
              <section className="review-guide-popover-unit">
                <div className="review-guide-popover-unit-heading">
                  <ReviewGuidePriority priority={guideUnit.priority} />
                  <span>This review block</span>
                </div>
                <div className="review-guide-popover-columns">
                  <div>
                    <span className="review-guide-kicker">Why this changed</span>
                    <p>{guideUnit.why}</p>
                  </div>
                  <div>
                    <span className="review-guide-kicker">What changed</span>
                    <p>{guideUnit.what}</p>
                  </div>
                </div>
              </section>
              {guideUnit.confirmedIssues.map((issue) => (
                <section
                  className="review-guide-popover-issue"
                  key={`${issue.path}:${issue.line}`}
                >
                  <AlertTriangle size={13} />
                  <div>
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <strong>AI-confirmed issue</strong>
                      <code>{issue.path}:{issue.line}</code>
                    </div>
                    <p>{issue.summary} {issue.evidence}</p>
                  </div>
                </section>
              ))}
            </>
          ) : null}

          <footer>
            <button className="btn-subtle btn-compact" type="button" onClick={onStart}>
              <Sparkles size={12} />
              Rebuild guide
            </button>
          </footer>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function ReviewFilterMenu({
  preferences,
  activeCount,
  disabled,
  onChange,
  onConfigurePatterns
}: {
  preferences: ReviewPreferences;
  activeCount: number;
  disabled: boolean;
  onChange: (preferences: ReviewPreferences) => void;
  onConfigurePatterns: () => void;
}): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="btn-subtle btn-compact" type="button" disabled={disabled}>
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

function ReviewBody({
  repoPath,
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
  reviewGuide,
  reviewGuideUnits,
  isFileTreeOpen,
  selectedFilePath,
  reviewSearch,
  onSelectUnit,
  onSelectFile,
  onStartReviewGuide,
  onToggleViewed
}: {
  repoPath: string;
  isLoading: boolean;
  errorMessage?: string;
  hasReviewUnits: boolean;
  emptyReviewMessage: string;
  units: VisibleReviewUnit[];
  selectedUnit?: VisibleReviewUnit;
  preparedDiffs: ReadonlyMap<string, PreparedReviewDiff>;
  diffOptions: FileDiffOptions<ReviewDiffAnnotation>;
  isMutating: boolean;
  mutationError?: string;
  lineCollaboration?: ReviewLineCollaboration;
  reviewGuide?: GitReviewGuide;
  reviewGuideUnits: ReadonlyMap<string, GitReviewGuideUnit>;
  isFileTreeOpen: boolean;
  selectedFilePath?: string;
  reviewSearch?: ReviewSearchViewState;
  onSelectUnit: (unitId: string) => void;
  onSelectFile: (path: string | undefined) => void;
  onStartReviewGuide: () => void;
  onToggleViewed: () => void;
}): ReactElement {
  const reviewChunksRef = useRef<HTMLDivElement>(null);
  const [collapsedFileKeys, setCollapsedFileKeys] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const selectedGuideUnit = selectedUnit
    ? reviewGuideUnits.get(selectedUnit.unit.id)
    : undefined;

  useEffect(() => {
    reviewChunksRef.current?.scrollTo({ top: 0 });
  }, [selectedUnit?.unit.id]);

  useLayoutEffect(() => {
    const scroller = reviewChunksRef.current;

    if (!scroller || !selectedFilePath) {
      return;
    }

    const target = scroller.querySelector<HTMLElement>(
      `[data-review-path="${CSS.escape(selectedFilePath)}"]`
    );

    if (!target) {
      return;
    }

    scroller.scrollTo({
      top:
        scroller.scrollTop +
        target.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top
    });
  }, [selectedFilePath, selectedUnit?.unit.id]);

  function toggleFile(fileKey: string, chunks: readonly GitReviewChunk[]): void {
    const isCollapsing = !collapsedFileKeys.has(fileKey);

    if (
      isCollapsing &&
      chunks.some((chunk) => chunk.id === lineCollaboration?.selectedChunkId)
    ) {
      lineCollaboration?.onCancel();
    }

    setCollapsedFileKeys((current) => {
      const next = new Set(current);

      if (next.has(fileKey)) {
        next.delete(fileKey);
      } else {
        next.add(fileKey);
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

  if (units.length === 0 && !reviewSearch) {
    return hasReviewUnits
      ? <ReviewMessage icon={<SkipForward size={16} />} text="All changes are skipped by the current review filters." />
      : <ReviewMessage icon={<Check size={16} />} text={emptyReviewMessage} />;
  }

  return (
    <div className="review-layout">
      <nav className="review-queue" aria-label="Context review units">
        {reviewSearch ? (
          <button
            className="review-unit-row review-search-unit-row"
            type="button"
            data-active={reviewSearch.isSelected}
            disabled={lineCollaboration?.selectedChunkId !== undefined}
            onClick={reviewSearch.onSelect}
          >
            <span className="review-unit-status review-search-unit-status">
              <Search size={12} />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span
                className="block truncate text-xs font-semibold text-[var(--text-1)]"
                title={reviewSearch.query || 'Review search'}
              >
                Search · {compactReviewSearchQuery(reviewSearch.query)}
              </span>
              <span className="mt-0.5 block truncate text-[10.5px] text-[var(--text-3)]">
                {formatReviewSearchResultCount(reviewSearch.results.locationCount)}
              </span>
            </span>
            <span className="badge-mini">temporary</span>
          </button>
        ) : null}
        {units.map((candidate, index) => (
          <button
            key={candidate.unit.id}
            className="review-unit-row"
            type="button"
            data-active={!reviewSearch?.isSelected && candidate.unit.id === selectedUnit?.unit.id}
            disabled={
              lineCollaboration?.selectedChunkId !== undefined &&
              candidate.unit.id !== selectedUnit?.unit.id
            }
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

      <div className="review-content">
        {reviewSearch?.isSelected ? (
          <ReviewSearchPanel
            search={reviewSearch}
            diffOptions={diffOptions}
          />
        ) : selectedUnit ? (
          <>
            <header className="review-unit-header">
              <div className="review-unit-heading">
                <h2 title={selectedUnit.unit.title}>{selectedUnit.unit.title}</h2>
                {reviewGuide && selectedGuideUnit ? (
                  <ReviewGuidePopover
                    guide={reviewGuide}
                    guideUnit={selectedGuideUnit}
                    reviewUnitTitle={selectedUnit.unit.title}
                    align="start"
                    trigger={(
                      <button
                        className="btn-subtle btn-compact review-guide-unit-trigger"
                        type="button"
                        aria-label={`Open AI guide for ${selectedUnit.unit.title}`}
                        title="Open AI guide for this review block"
                      >
                        <Sparkles size={12} />
                        AI
                      </button>
                    )}
                    onStart={onStartReviewGuide}
                  />
                ) : null}
                {selectedGuideUnit ? (
                  <ReviewGuidePriority priority={selectedGuideUnit.priority} />
                ) : null}
                <span className="badge-mini shrink-0" title="Grouping confidence">{selectedUnit.unit.confidence}</span>
                <span
                  className="review-unit-summary"
                  title={`${selectedUnit.unit.reason} · ${selectedUnit.unit.explanation}${selectedUnit.skippedCount > 0 ? ` · ${selectedUnit.skippedCount} skipped by filters` : ''}`}
                >
                  {selectedUnit.unit.reason}
                  {` · ${selectedUnit.unit.explanation}`}
                  {selectedUnit.skippedCount > 0 ? ` · ${selectedUnit.skippedCount} skipped by filters` : ''}
                </span>
              </div>
              <button className={selectedUnit.isViewed ? 'btn-subtle btn-compact' : 'btn-primary btn-compact'} type="button" disabled={isMutating} onClick={onToggleViewed}>
                {isMutating ? <Loader2 size={13} className="animate-spin" /> : selectedUnit.isViewed ? <X size={13} /> : <CheckCheck size={13} />}
                {selectedUnit.isViewed ? 'Mark unviewed' : 'Viewed'}
              </button>
            </header>
            {mutationError ? <p className="border-b border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-2 text-xs text-[var(--danger-text)]">{mutationError}</p> : null}
            <div ref={reviewChunksRef} className="review-chunks">
              {createReviewSections(selectedUnit.visibleChunks).map((section, _sectionIndex, sections) => (
                <section className="review-chunk-section" data-only={sections.length === 1} key={section.key}>
                  {sections.length > 1 ? (
                    <div className="review-section-header">
                      <span>{section.label}</span>
                      <span>{section.files.length}</span>
                    </div>
                  ) : null}
                  {section.files.flatMap((file) => {
                    const isCollapsed = collapsedFileKeys.has(file.key);

                    return file.chunks
                      .filter((_chunk, chunkIndex) => !isCollapsed || chunkIndex === 0)
                      .map((chunk, chunkIndex) => (
                        <ReviewChunk
                          key={chunk.id}
                          chunk={chunk}
                          preparedDiff={preparedDiffs.get(chunk.id)}
                          diffOptions={diffOptions}
                          lineCollaboration={lineCollaboration}
                          showFileComments={chunkIndex === 0}
                          headerAdditions={file.additions}
                          headerDeletions={file.deletions}
                          hideLeadingExpansion={shareReviewExpansionBoundary(
                            chunkIndex > 0
                              ? preparedDiffs.get(file.chunks[chunkIndex - 1]!.id)?.expandable
                              : undefined,
                            preparedDiffs.get(chunk.id)?.expandable
                          )}
                          isCollapsed={isCollapsed}
                          onToggleCollapsed={() => toggleFile(file.key, file.chunks)}
                        />
                      ));
                  })}
                </section>
              ))}
            </div>
          </>
        ) : null}
      </div>

      {isFileTreeOpen ? (
        <ReviewFileTree
          key={repoPath}
          repoPath={repoPath}
          units={units}
          selectedPath={selectedFilePath}
          onSelectPath={onSelectFile}
        />
      ) : null}
    </div>
  );
}

function ReviewSearchPanel({
  search,
  diffOptions
}: {
  search: ReviewSearchViewState;
  diffOptions: FileDiffOptions<ReviewDiffAnnotation>;
}): ReactElement {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [collapsedChunkIds, setCollapsedChunkIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const indexedFiles = useMemo(() => {
    let index = 0;

    return search.results.files.map((file) => ({
      file,
      locations: file.locations.map((location) => ({
        index: index++,
        location
      }))
    }));
  }, [search.results.files]);
  const activeResult = useMemo(
    () =>
      indexedFiles
        .flatMap(({ file, locations }) =>
          locations.map(({ index, location }) => ({ file, index, location }))
        )
        .find(({ index }) => index === search.activeLocationIndex),
    [indexedFiles, search.activeLocationIndex]
  );

  useEffect(() => {
    const input = inputRef.current;

    if (!input) {
      return;
    }

    input.focus({ preventScroll: true });
    input.select();
  }, [search.focusSignal]);

  useEffect(() => {
    const input = inputRef.current;

    if (!input) {
      return;
    }

    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 68)}px`;
  }, [search.query]);

  useEffect(() => {
    if (!activeResult) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const result = resultsRef.current?.querySelector<HTMLElement>(
        `[data-review-search-result="${CSS.escape(activeResult.file.id)}"]`
      );
      result?.scrollIntoView({ block: 'nearest' });

      const matchedLine = activeResult.location.lines.find((line) => line.isMatch);
      const diffRoot = result?.querySelector<HTMLElement>('.gg-diff')?.shadowRoot;

      if (matchedLine && diffRoot) {
        diffRoot
          .querySelector<HTMLElement>(createReviewSearchLineSelector(matchedLine))
          ?.scrollIntoView({ block: 'center' });
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeResult]);

  function toggleChunk(chunkId: string): void {
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

  function navigate(direction: -1 | 1): void {
    if (search.results.locationCount === 0) {
      return;
    }

    search.onActiveLocationIndexChange(
      (
        search.activeLocationIndex +
        direction +
        search.results.locationCount
      ) % search.results.locationCount
    );
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === 'f'
    ) {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.select();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      search.onClose();
      return;
    }

    if (event.key === 'Enter' && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      navigate(event.shiftKey ? -1 : 1);
    }
  }

  const resultPosition =
    search.results.locationCount === 0
      ? 0
      : Math.min(search.activeLocationIndex + 1, search.results.locationCount);

  return (
    <>
      <header className="review-unit-header review-search-header">
        <div className="review-unit-heading">
          <h2>Search results</h2>
          <span className="badge-mini review-search-temporary-badge">temporary block</span>
          <span className="review-unit-summary">
            {formatReviewSearchResultCount(search.results.locationCount)}
            {search.results.limitReached ? ' · first 200 shown' : ''}
          </span>
        </div>
        <button
          className="icon-btn icon-btn-compact"
          type="button"
          aria-label="Close review search"
          title="Close review search"
          onClick={search.onClose}
        >
          <X size={14} />
        </button>
      </header>

      <div className="review-search-controls" role="search" aria-label="Search review">
        <div className="review-search-query-row">
          <Search size={14} aria-hidden="true" />
          <textarea
            ref={inputRef}
            value={search.query}
            rows={1}
            spellCheck={false}
            aria-label="Search identifier or selected code"
            placeholder="Identifier or selected code…"
            onChange={(event) => search.onQueryChange(event.currentTarget.value)}
            onKeyDown={handleInputKeyDown}
          />
          <span className="review-search-position" aria-live="polite">
            {resultPosition} of {search.results.locationCount}
          </span>
          <button
            className="review-search-nav-button"
            type="button"
            disabled={search.results.locationCount === 0}
            aria-label="Previous review search result"
            title="Previous result (Shift Enter)"
            onClick={() => navigate(-1)}
          >
            <ChevronUp size={13} />
          </button>
          <button
            className="review-search-nav-button"
            type="button"
            disabled={search.results.locationCount === 0}
            aria-label="Next review search result"
            title="Next result (Enter)"
            onClick={() => navigate(1)}
          >
            <ChevronDown size={13} />
          </button>
        </div>

        <div className="review-search-scope-row">
          <label>
            <span>Search in</span>
            <select
              value={search.scope}
              aria-label="Review search scope"
              onChange={(event) => search.onScopeChange(event.currentTarget.value as ReviewSearchScope)}
            >
              <option value="changed-lines">Changed lines</option>
              <option value="full-files">Full changed files</option>
            </select>
          </label>
          <label>
            <span>Include</span>
            <select
              value={search.inclusion}
              aria-label="Review search inclusion"
              onChange={(event) =>
                search.onInclusionChange(event.currentTarget.value as ReviewSearchInclusion)
              }
            >
              <option value="visible-blocks">Visible blocks</option>
              <option value="whole-review">Whole PR</option>
            </select>
          </label>
          <span className="review-search-shortcut-hint">⌘F from selected text or code</span>
        </div>
      </div>

      {search.results.fullFileFallbackCount > 0 && search.scope === 'full-files' ? (
        <p className="review-search-notice">
          {search.results.fullFileFallbackCount} changed
          {search.results.fullFileFallbackCount === 1 ? ' file has' : ' files have'} no full-text
          context, so changed lines are shown instead.
        </p>
      ) : null}

      <div ref={resultsRef} className="review-chunks review-search-results">
        {search.isSearching ? (
          <ReviewMessage
            icon={<Loader2 size={16} className="animate-spin" />}
            text="Searching review…"
          />
        ) : !search.query.trim() ? (
          <ReviewMessage
            icon={<Search size={16} />}
            text="Select an identifier or code, then press ⌘F."
          />
        ) : indexedFiles.length === 0 ? (
          <ReviewMessage
            icon={<Search size={16} />}
            text="No matches in the selected review scope."
          />
        ) : (
          indexedFiles.map(({ file, locations }) => {
            const matchedLines = locations.flatMap(({ location }) =>
              location.lines.filter((line) => line.isMatch)
            );

            return (
              <section
                className="review-search-file"
                data-active={locations.some(
                  ({ index }) => index === search.activeLocationIndex
                )}
                data-review-search-result={file.id}
                key={file.id}
              >
                <div className="review-search-file-context">
                  <span title={file.ownerUnitTitle}>{file.ownerUnitTitle}</span>
                  <span title={file.relationship}>{file.relationship}</span>
                  {file.isFiltered ? <span className="badge-mini">filtered</span> : null}
                  {file.usedChangedLinesFallback
                    ? <span className="badge-mini">changed lines</span>
                    : null}
                  <span>{formatReviewSearchResultCount(file.locations.length)}</span>
                </div>
                <ReviewChunk
                  chunk={file.chunk}
                  preparedDiff={search.preparedDiffs.get(file.chunk.id)}
                  diffOptions={diffOptions}
                  showFileComments={false}
                  isCollapsed={collapsedChunkIds.has(file.chunk.id)}
                  searchHighlights={matchedLines}
                  onToggleCollapsed={() => toggleChunk(file.chunk.id)}
                />
              </section>
            );
          })
        )}
      </div>
    </>
  );
}

function createReviewSearchLineSelector(line: ReviewSearchLine): string {
  const lineType = line.kind === 'addition'
    ? '[data-line-type="change-addition"]'
    : line.kind === 'deletion'
      ? '[data-line-type="change-deletion"]'
      : '';

  return `[data-line="${line.number}"]${lineType}`;
}

function createReviewSearchHighlightCSS(
  lines: readonly ReviewSearchLine[] | undefined
): string {
  if (!lines?.length) {
    return '';
  }

  const lineSelectors = new Set<string>();
  const gutterSelectors = new Set<string>();

  for (const line of lines) {
    const lineType = line.kind === 'addition'
      ? '[data-line-type="change-addition"]'
      : line.kind === 'deletion'
        ? '[data-line-type="change-deletion"]'
        : '';

    lineSelectors.add(`[data-line="${line.number}"]${lineType}`);
    gutterSelectors.add(`[data-column-number="${line.number}"]${lineType}`);
  }

  const selectors = [...lineSelectors, ...gutterSelectors].join(',\n');

  return `
    ${selectors} {
      background-color: light-dark(rgb(214 159 34 / 0.24), rgb(235 182 60 / 0.2)) !important;
    }

    ${[...lineSelectors].join(',\n')} {
      box-shadow: inset 3px 0 0 var(--diffs-modified-base);
    }
  `;
}

function ReviewFileTree({
  repoPath,
  units,
  selectedPath,
  onSelectPath
}: {
  repoPath: string;
  units: VisibleReviewUnit[];
  selectedPath?: string;
  onSelectPath: (path: string | undefined) => void;
}): ReactElement {
  const isSyncingSelectionRef = useRef(false);
  const resizeStateRef = useRef<
    { startX: number; startWidth: number; width: number } | undefined
  >(undefined);
  const [width, setWidth] = useState(() =>
    loadReviewFileTreeWidth(window.localStorage, repoPath)
  );
  const [isResizing, setIsResizing] = useState(false);
  const entries = useMemo(() => createReviewFileTreeEntries(units), [units]);
  const paths = useMemo(() => entries.map((entry) => entry.path), [entries]);
  const pathSet = useMemo(() => new Set(paths), [paths]);
  const preparedInput = useMemo(
    () => prepareFileTreeInput(paths, { flattenEmptyDirectories: true }),
    [paths]
  );
  const { model } = useFileTree({
    preparedInput,
    gitStatus: entries,
    initialExpansion: 'open',
    initialSelectedPaths: selectedPath ? [selectedPath] : [],
    onSelectionChange(selectedPaths) {
      if (isSyncingSelectionRef.current) {
        return;
      }

      onSelectPath(selectedPaths.find((path) => pathSet.has(path)));
    },
    search: entries.length > 8,
    unsafeCSS: `
      :host {
        --trees-selected-bg-override: var(--select-bg);
        --trees-border-color-override: var(--border);
        --trees-fg-override: var(--text-2);
        --trees-muted-fg-override: var(--text-3);
        --trees-bg-override: transparent;
        --trees-hover-bg-override: var(--bg-hover);
        font-size: 12px;
      }
    `
  });

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function handlePointerMove(event: PointerEvent): void {
      const state = resizeStateRef.current;

      if (!state) {
        return;
      }

      const nextWidth = normalizeReviewFileTreeWidth(
        state.startWidth + state.startX - event.clientX
      );
      state.width = nextWidth;
      setWidth(nextWidth);
    }

    function stopResize(): void {
      const nextWidth = resizeStateRef.current?.width;
      resizeStateRef.current = undefined;
      setIsResizing(false);

      if (typeof nextWidth === 'number') {
        saveReviewFileTreeWidth(window.localStorage, repoPath, nextWidth);
      }
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizing, repoPath]);

  useEffect(() => {
    const selectedPaths = model.getSelectedPaths();
    const currentSelectedPath = selectedPaths.find((path) => pathSet.has(path));

    if (
      currentSelectedPath === selectedPath &&
      selectedPaths.length <= (selectedPath ? 1 : 0)
    ) {
      return;
    }

    isSyncingSelectionRef.current = true;

    try {
      for (const path of selectedPaths) {
        if (path !== selectedPath) {
          model.getItem(path)?.deselect();
        }
      }

      if (selectedPath && pathSet.has(selectedPath)) {
        const selectedItem = model.getItem(selectedPath);

        if (!selectedItem?.isSelected()) {
          selectedItem?.select();
        }

        model.scrollToPath(selectedPath, { focus: false });
      }
    } finally {
      isSyncingSelectionRef.current = false;
    }
  }, [model, pathSet, selectedPath]);

  function handleResizeStart(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: width,
      width
    };
    setIsResizing(true);
  }

  function resizeAndSave(nextWidth: number): void {
    const normalizedWidth = normalizeReviewFileTreeWidth(nextWidth);
    setWidth(normalizedWidth);
    saveReviewFileTreeWidth(window.localStorage, repoPath, normalizedWidth);
  }

  const panelStyle: CSSProperties & Record<'--review-file-tree-width', string> = {
    '--review-file-tree-width': `${width}px`
  };

  return (
    <aside
      className="review-file-tree-panel"
      style={panelStyle}
      aria-label="Review files"
    >
      <ReviewFileTreeResizeHandle
        width={width}
        isActive={isResizing}
        onPointerDown={handleResizeStart}
        onResize={resizeAndSave}
      />
      <header>
        <span>
          <FolderTree size={13} />
          Files
          <span className="badge-mini">{entries.length}</span>
        </span>
      </header>
      <div className="review-file-tree-body">
        <FileTree className="review-file-tree" model={model} />
      </div>
    </aside>
  );
}

function ReviewFileTreeResizeHandle({
  width,
  isActive,
  onPointerDown,
  onResize
}: {
  width: number;
  isActive: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onResize: (width: number) => void;
}): ReactElement {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const step = event.shiftKey ? 48 : 16;

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onResize(width + step);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      onResize(width - step);
    } else if (event.key === 'Home') {
      event.preventDefault();
      onResize(MIN_REVIEW_FILE_TREE_WIDTH);
    } else if (event.key === 'End') {
      event.preventDefault();
      onResize(MAX_REVIEW_FILE_TREE_WIDTH);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onResize(DEFAULT_REVIEW_FILE_TREE_WIDTH);
    }
  }

  return (
    <div
      className="review-file-tree-resizer"
      role="separator"
      tabIndex={0}
      aria-label="Resize review file tree"
      aria-orientation="vertical"
      aria-valuemin={MIN_REVIEW_FILE_TREE_WIDTH}
      aria-valuemax={MAX_REVIEW_FILE_TREE_WIDTH}
      aria-valuenow={width}
      data-active={isActive ? 'true' : undefined}
      title="Drag to resize. Double-click to reset."
      onPointerDown={onPointerDown}
      onDoubleClick={() => onResize(DEFAULT_REVIEW_FILE_TREE_WIDTH)}
      onKeyDown={handleKeyDown}
    />
  );
}

function ReviewChunk({
  chunk,
  preparedDiff,
  diffOptions,
  lineCollaboration,
  showFileComments,
  headerAdditions,
  headerDeletions,
  hideLeadingExpansion = false,
  isCollapsed,
  searchHighlights,
  onToggleCollapsed
}: {
  chunk: GitReviewChunk;
  preparedDiff?: PreparedReviewDiff;
  diffOptions: FileDiffOptions<ReviewDiffAnnotation>;
  lineCollaboration?: ReviewLineCollaboration;
  showFileComments: boolean;
  headerAdditions?: number;
  headerDeletions?: number;
  hideLeadingExpansion?: boolean;
  isCollapsed: boolean;
  searchHighlights?: readonly ReviewSearchLine[];
  onToggleCollapsed: () => void;
}): ReactElement {
  const fileComposerId = useId();
  const expandableDiff = preparedDiff?.expandable;
  const contextualDiffOptions = useMemo<FileDiffOptions<ReviewDiffAnnotation>>(
    () => {
      const options = expandableDiff
        ? createReviewContextOptions(
            diffOptions,
            expandableDiff,
            chunk.path,
            hideLeadingExpansion
          )
        : diffOptions;
      const highlightCSS = createReviewSearchHighlightCSS(searchHighlights);

      return highlightCSS
        ? { ...options, unsafeCSS: `${options.unsafeCSS ?? ''}\n${highlightCSS}` }
        : options;
    },
    [chunk.path, diffOptions, expandableDiff, hideLeadingExpansion, searchHighlights]
  );
  const selectedLines =
    lineCollaboration?.selectedChunkId === chunk.id &&
    lineCollaboration.selectedSubject === 'line'
      ? lineCollaboration.selectedLines
      : null;
  const normalizedSelection = normalizeReviewLineSelection(selectedLines);
  const lineAnnotations = useMemo<DiffLineAnnotation<ReviewDiffAnnotation>[]>(
    () => [
      ...(lineCollaboration?.threads.flatMap((thread) =>
        thread.subjectType === 'line' &&
        thread.path === chunk.path &&
        thread.line &&
        thread.side &&
        patchContainsLine(chunk.patch, thread.line, thread.side)
          ? [{
              lineNumber: thread.line,
              side: thread.side === 'right' ? 'additions' as const : 'deletions' as const,
              metadata: { kind: 'thread' as const, thread }
            }]
          : []
      ) ?? []),
      ...(normalizedSelection
        ? [{
            lineNumber: normalizedSelection.line,
            side: normalizedSelection.side === 'right' ? 'additions' as const : 'deletions' as const,
            metadata: { kind: 'composer' as const }
          }]
        : [])
    ],
    [chunk.patch, chunk.path, lineCollaboration?.threads, normalizedSelection]
  );
  const fileThreads = showFileComments
    ? lineCollaboration?.threads.filter(
        (thread) => thread.subjectType === 'file' && thread.path === chunk.path
      ) ?? []
    : [];
  const isFileComposerOpen =
    lineCollaboration?.selectedChunkId === chunk.id &&
    lineCollaboration.selectedSubject === 'file';
  const interactiveDiffOptions: FileDiffOptions<ReviewDiffAnnotation> = lineCollaboration
    ? {
        ...contextualDiffOptions,
        enableLineSelection: true,
        controlledSelection: true,
        lineHoverHighlight: 'both',
        enableGutterUtility: lineCollaboration.selectedChunkId === undefined,
        onGutterUtilityClick: (range) =>
          lineCollaboration.onSelectLines(chunk.id, chunk.path, range),
        onLineSelected: (range) =>
          lineCollaboration.onSelectLines(chunk.id, chunk.path, range)
      }
    : contextualDiffOptions;

  return (
    <section
      className="review-chunk"
      data-collapsed={isCollapsed}
      data-review-path={chunk.path}
    >
      <div className="review-chunk-header">
        <button
          className="review-chunk-toggle"
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
          <span className="text-[var(--success-text)]">+{headerAdditions ?? chunk.additions}</span>
          <span className="text-[var(--danger-text)]">-{headerDeletions ?? chunk.deletions}</span>
        </button>
        {lineCollaboration && showFileComments ? (
          <button
            className="review-comment-action review-file-comment-action"
            type="button"
            data-active={isFileComposerOpen}
            aria-controls={fileComposerId}
            aria-expanded={isFileComposerOpen}
            onClick={() => {
              if (isFileComposerOpen) {
                lineCollaboration.onCancel();
                return;
              }
              if (isCollapsed) {
                onToggleCollapsed();
              }
              lineCollaboration.onSelectFile(chunk.id, chunk.path);
            }}
          >
            <MessageSquare size={11} />
            Comment on file
          </button>
        ) : null}
      </div>
      {!isCollapsed && showFileComments && (fileThreads.length > 0 || isFileComposerOpen) ? (
        <div className="review-file-comments">
          {fileThreads.map((thread) => (
            <ReviewCommentAnnotation
              key={thread.id}
              thread={thread}
              onAddDraftReply={lineCollaboration?.onAddDraftReply}
              onUpdateComment={lineCollaboration?.onUpdateComment}
              onRemoveDraftComment={lineCollaboration?.onRemoveDraftComment}
            />
          ))}
          {isFileComposerOpen && lineCollaboration ? (
            <div id={fileComposerId}>
              <ReviewInlineComposer collaboration={lineCollaboration} />
            </div>
          ) : null}
        </div>
      ) : null}
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
          <FileDiff<ReviewDiffAnnotation>
            className="gg-diff"
            fileDiff={preparedDiff.fileDiff}
            options={interactiveDiffOptions}
            lineAnnotations={lineAnnotations}
            selectedLines={selectedLines}
            renderAnnotation={(annotation) => (
              annotation.metadata.kind === 'composer' && lineCollaboration
                ? <ReviewInlineComposer collaboration={lineCollaboration} />
                : annotation.metadata.kind === 'thread'
                  ? <ReviewCommentAnnotation
                      thread={annotation.metadata.thread}
                      onAddDraftReply={lineCollaboration?.onAddDraftReply}
                      onUpdateComment={lineCollaboration?.onUpdateComment}
                      onRemoveDraftComment={lineCollaboration?.onRemoveDraftComment}
                    />
                  : null
            )}
          />
        ) : (
          <PatchDiff<ReviewDiffAnnotation>
            className="gg-diff"
            patch={chunk.patch}
            options={interactiveDiffOptions}
            lineAnnotations={lineAnnotations}
            selectedLines={selectedLines}
            renderAnnotation={(annotation) => (
              annotation.metadata.kind === 'composer' && lineCollaboration
                ? <ReviewInlineComposer collaboration={lineCollaboration} />
                : annotation.metadata.kind === 'thread'
                  ? <ReviewCommentAnnotation
                      thread={annotation.metadata.thread}
                      onAddDraftReply={lineCollaboration?.onAddDraftReply}
                      onUpdateComment={lineCollaboration?.onUpdateComment}
                      onRemoveDraftComment={lineCollaboration?.onRemoveDraftComment}
                    />
                  : null
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
  const [initialBody] = useState(collaboration.getBody);
  const [hasBody, setHasBody] = useState(() => Boolean(initialBody.trim()));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const normalizedSelection = normalizeReviewLineSelection(collaboration.selectedLines);
  const canSubmitSelection = Boolean(
    collaboration.selectedSubject === 'file' ||
      (normalizedSelection && normalizedSelection.side === normalizedSelection.startSide)
  );
  const canSubmitLineComment = hasBody && canSubmitSelection;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <form
      className="review-inline-composer"
      data-subject-type={collaboration.selectedSubject}
      onSubmit={(event) => collaboration.onSubmit(event, collaboration.getBody())}
    >
      <div className="review-inline-composer-label">
        <MessageSquare size={13} />
        {collaboration.selectedSubject === 'file'
          ? `Draft comment on file ${collaboration.selectedPath}`
          : normalizedSelection
          ? `Draft comment on ${collaboration.selectedPath}:${formatReviewLineSelection(normalizedSelection)}`
          : 'Select lines from only one side of the diff to comment.'}
      </div>
      <textarea
        ref={textareaRef}
        rows={3}
        defaultValue={initialBody}
        placeholder={collaboration.selectedSubject === 'file'
          ? 'Leave a whole-file review comment…'
          : 'Leave an inline review comment…'}
        aria-label={collaboration.selectedSubject === 'file'
          ? 'File review comment'
          : 'Inline review comment'}
        onChange={(event) => {
          const nextBody = event.target.value;
          const nextHasBody = Boolean(nextBody.trim());

          collaboration.onBodyChange(nextBody);
          if (nextHasBody !== hasBody) {
            setHasBody(nextHasBody);
          }
        }}
      />
      <p className="review-inline-composer-hint">
        Saved in Git Gud only. Nothing is posted until you submit the review.
      </p>
      {collaboration.errorMessage ? (
        <p className="review-inline-comment-error">{collaboration.errorMessage}</p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <button
          className="btn-subtle btn-compact"
          type="button"
          disabled={collaboration.isSubmitting}
          onClick={collaboration.onCancel}
        >
          Cancel
        </button>
        <button
          className="btn-primary btn-compact"
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

function ReviewCommentAnnotation({
  thread,
  onAddDraftReply,
  onUpdateComment,
  onRemoveDraftComment
}: {
  thread: ReviewCommentThread;
  onAddDraftReply?: (input: ReviewLineReplyInput) => Promise<void>;
  onUpdateComment?: (commentId: number, body: string) => Promise<void>;
  onRemoveDraftComment?: (id: string) => void;
}): ReactElement {
  const articleRef = useRef<HTMLElement>(null);
  const [isReplying, setIsReplying] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<number>();
  const [editBody, setEditBody] = useState('');
  const [restoreFocusId, setRestoreFocusId] = useState<number>();
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
  const editMutation = useMutation({
    mutationFn: async ({ commentId, body }: { commentId: number; body: string }) => {
      if (!body.trim() || !onUpdateComment) {
        throw new Error('Editing is unavailable for this comment.');
      }
      await onUpdateComment(commentId, body.trim());
    },
    onSuccess: (_result, { commentId }) => {
      setRestoreFocusId(commentId);
      setEditingCommentId(undefined);
      setEditBody('');
    }
  });

  useEffect(() => {
    if (editingCommentId !== undefined || restoreFocusId === undefined) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      articleRef.current
        ?.querySelector<HTMLButtonElement>(`[data-edit-comment-id="${restoreFocusId}"]`)
        ?.focus();
      setRestoreFocusId(undefined);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editingCommentId, restoreFocusId]);

  function startEditing(comment: ReviewLineComment): void {
    if (
      typeof comment.id !== 'number' ||
      editMutation.isPending ||
      replyMutation.isPending
    ) {
      return;
    }
    setIsReplying(false);
    setReplyBody('');
    replyMutation.reset();
    setEditingCommentId(comment.id);
    setEditBody(comment.body);
    editMutation.reset();
  }

  function submitEditing(): void {
    if (editingCommentId !== undefined) {
      editMutation.mutate({ commentId: editingCommentId, body: editBody });
    }
  }

  function cancelEditing(): void {
    setRestoreFocusId(editingCommentId);
    setEditingCommentId(undefined);
    setEditBody('');
    editMutation.reset();
  }

  return (
    <article
      ref={articleRef}
      className="review-line-comment"
      data-draft={thread.isDraft}
      data-subject-type={thread.subjectType}
    >
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
      {editingCommentId === thread.id ? (
        <ReviewCommentEditForm
          author={thread.author}
          body={editBody}
          errorMessage={editMutation.error instanceof Error ? editMutation.error.message : undefined}
          isSaving={editMutation.isPending}
          onBodyChange={setEditBody}
          onCancel={cancelEditing}
          onSubmit={submitEditing}
        />
      ) : (
        <ReviewCommentBody body={thread.body} />
      )}
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
                    className="review-comment-action review-comment-icon-action review-comment-action--danger"
                    type="button"
                    onClick={() => onRemoveDraftComment(String(reply.id))}
                    aria-label="Remove draft reply"
                  >
                    <Trash2 size={11} />
                  </button>
                ) : null}
                {reply.canEdit && onUpdateComment && editingCommentId !== reply.id ? (
                  <button
                    className="review-comment-action"
                    type="button"
                    data-edit-comment-id={reply.id}
                    disabled={editingCommentId !== undefined || isReplying || editMutation.isPending}
                    onClick={() => startEditing(reply)}
                  >
                    <Pencil size={11} />
                    Edit
                  </button>
                ) : null}
              </div>
              {editingCommentId === reply.id ? (
                <ReviewCommentEditForm
                  author={reply.author}
                  body={editBody}
                  errorMessage={editMutation.error instanceof Error ? editMutation.error.message : undefined}
                  isSaving={editMutation.isPending}
                  onBodyChange={setEditBody}
                  onCancel={cancelEditing}
                  onSubmit={submitEditing}
                  compact
                />
              ) : (
                <ReviewCommentBody body={reply.body} compact />
              )}
            </div>
          ))}
        </div>
      ) : null}
      <footer className="review-line-comment-actions">
        {thread.isDraft && onRemoveDraftComment ? (
          <button
            className="review-comment-action review-comment-action--danger"
            type="button"
            onClick={() => onRemoveDraftComment(String(thread.id))}
          >
            <Trash2 size={11} />
            Remove draft
          </button>
        ) : null}
        {thread.canEdit && onUpdateComment && editingCommentId !== thread.id ? (
          <button
            className="review-comment-action"
            type="button"
            data-edit-comment-id={thread.id}
            disabled={editingCommentId !== undefined || isReplying || editMutation.isPending}
            onClick={() => startEditing(thread)}
          >
            <Pencil size={11} />
            Edit
          </button>
        ) : null}
        {canReply ? (
          <button
            className="review-comment-action"
            type="button"
            disabled={replyMutation.isPending || editMutation.isPending || editingCommentId !== undefined}
            aria-expanded={isReplying}
            onClick={() => setIsReplying((current) => !current)}
          >
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
            disabled={replyMutation.isPending}
            onChange={(event) => setReplyBody(event.target.value)}
          />
          <p>Saved as a draft until you submit the review.</p>
          {replyMutation.error instanceof Error ? (
            <span>{replyMutation.error.message}</span>
          ) : null}
          <div>
            <button
              className="btn-subtle btn-compact"
              type="button"
              disabled={replyMutation.isPending}
              onClick={() => {
                setIsReplying(false);
                setReplyBody('');
                replyMutation.reset();
              }}
            >
              Cancel
            </button>
            <button
              className="btn-primary btn-compact"
              type="submit"
              disabled={!replyBody.trim() || replyMutation.isPending}
            >
              {replyMutation.isPending
                ? <Loader2 size={11} className="animate-spin" />
                : <Reply size={11} />}
              Add reply
            </button>
          </div>
        </form>
      ) : null}
    </article>
  );
}

function ReviewCommentEditForm({
  author,
  body,
  errorMessage,
  isSaving,
  onBodyChange,
  onCancel,
  onSubmit,
  compact = false
}: {
  author: string;
  body: string;
  errorMessage?: string;
  isSaving: boolean;
  onBodyChange: (body: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  compact?: boolean;
}): ReactElement {
  return (
    <form
      className="review-comment-edit-form"
      data-compact={compact}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <textarea
        autoFocus
        rows={3}
        value={body}
        aria-label={`Edit ${author}'s review comment`}
        disabled={isSaving}
        onChange={(event) => onBodyChange(event.target.value)}
      />
      {errorMessage ? <span>{errorMessage}</span> : null}
      <div>
        <button className="btn-subtle btn-compact" type="button" disabled={isSaving} onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary btn-compact" type="submit" disabled={!body.trim() || isSaving}>
          {isSaving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          Save comment
        </button>
      </div>
    </form>
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
  return prepareReviewChunkDiffs(
    unit?.visibleChunks ?? [],
    fileContexts,
    cacheKeyPrefix
  );
}

function prepareReviewChunkDiffs(
  chunks: readonly GitReviewChunk[],
  fileContexts: ReadonlyMap<string, GitReviewFileContext>,
  cacheKeyPrefix: string
): Map<string, PreparedReviewDiff> {
  const preparedDiffs = new Map<string, PreparedReviewDiff>();

  for (const chunk of chunks) {
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
): ReviewCommentThread[] {
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

function createReviewCommentBodyBuffer(): ReviewCommentBodyBuffer {
  let body = '';

  return {
    get: () => body,
    set: (nextBody) => {
      body = nextBody;
    },
    clear: () => {
      body = '';
    }
  };
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

function compactReviewSearchQuery(query: string): string {
  const compact = query.trim().replace(/\s+/g, ' ');

  if (!compact) {
    return 'Review';
  }

  return compact.length > 28 ? `${compact.slice(0, 27)}…` : compact;
}

function formatReviewSearchResultCount(count: number): string {
  return `${count} ${count === 1 ? 'match' : 'matches'}`;
}

function readSelectedReviewText(): string {
  return readReviewSearchSelection(window.getSelection());
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function isReviewSearchInput(target: EventTarget | null): boolean {
  return target instanceof HTMLTextAreaElement &&
    target.getAttribute('aria-label') === 'Search identifier or selected code';
}

function isReviewFileTreeTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.review-file-tree-panel') !== null;
}

function isReviewUnitRowTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.review-unit-row') !== null;
}
