import type {
  FormEvent,
  KeyboardEvent,
  ReactElement,
  ReactNode
} from 'react';
import { Tooltip } from 'radix-ui';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import type {
  
  
  FileDiffOptions,
  SelectedLineRange
} from '@pierre/diffs';
import { PatchDiff, useWorkerPool } from '@pierre/diffs/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  
  Check,
  CheckCheck,
  ChevronDown,
  
  ChevronUp,
  Columns2,
  Clock3,
  
  
  FileCog,
  
  GitBranch,
  Loader2,
  
  PackageOpen,
  PanelRightClose,
  PanelRightOpen,
  
  Pilcrow,
  
  Rows3,
  Search,
  
  
  Settings2,
  SkipForward,
  Sparkles,
  TestTube2,
  Trash2,
  X
} from 'lucide-react';

import { ModalSurface } from '@renderer/components/accessibility/ModalSurface';
import { useReviewContinuity, type ReviewContinuityIdentity } from './useReviewContinuity';
import { createDiffOptionsBase, type DiffStyle } from '@renderer/components/commit/fileDetailUtils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu';
import { reviewPlanQueryKey, useAgentNotes, useReviewPlan } from '@renderer/queries/repository';
import { reviewGuidePatchChangesLine } from '@shared/reviewGuide';
import type {
  DiffSyntaxTheme,
  GitAgentNote,
  GitReviewChunk,
  GitReviewFileContext,
  GitReviewGuide,
  GitReviewGuideFile,
  
  GitReviewGuideState,
  GitReviewGuideUnit,
  GitReviewPlan,
  GitReviewTarget,
  GitReviewTypeDefinitionResult
} from '@shared/types';

import {
  loadHiddenAgentNoteIds,
  resolveAgentNotes,
  saveHiddenAgentNoteIds
} from './agentNotes';
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
  NO_GUIDE_NOTES,
  ReviewFile,
  type ReviewCommentThread,
  type ReviewDiffAnnotation,
  type ReviewFileCommentInput,
  type ReviewInlineGuideNote,
  type ReviewLineCollaboration,
  type ReviewLineComment,
  type ReviewLineCommentInput,
  type ReviewLineReplyInput,
  type ReviewTypeDefinitionHoverTarget,
  type ReviewTypeDefinitionInteraction,
  type ReviewTypeDefinitionRequest,
  ReviewUnsavedTextContext
} from './ReviewDiffParts';
import { createReviewFileScope } from './reviewFileScope';
import { ReviewFilesView, type ReviewFilesViewHandle } from './ReviewFilesView';
import { ReviewTypeDefinitionDialog } from './ReviewTypeDefinitionDialog';
import {
  createReviewTypeDefinitionInput,
  getReviewTypeDefinitionCharacter,
  isReviewTypeDefinitionGesture,
  isReviewTypeDefinitionModifier,
  isTypeScriptReviewContext,
  
  reviewTypeDefinitionHoverCacheKey,
  setReviewTypeDefinitionHoverAvailable
} from './reviewTypeDefinitionInteraction';
import {
  findAdjacentReviewFilePath,
  findReviewUnitIdForPath,
  loadReviewFileTreeOpen,
  saveReviewFileTreeOpen
} from './reviewFileTree';
import { createReviewGuidePlan, rankReviewChunksByGuide } from './reviewGuidePresentation';
import { createReviewGuideFindings, type ReviewGuideFinding } from './reviewGuideFindings';
import { ReviewGuidePanel, ReviewGuidePriority, ReviewFindingDot, ReviewLayerTooltip } from './ReviewGuidePanel';
import {
  
  normalizeReviewLineSelection
} from './reviewLineSelection';
import { ReviewPatternsDialog } from './ReviewPatternsDialog';
import { ReviewFileTree } from './ReviewFilesPanel';
import {
  createReviewSearchResults,
  normalizeReviewSearchSelection,
  readReviewSearchSelection,
  type ReviewSearchInclusion,
  type ReviewSearchLine,
  type ReviewSearchResults,
  type ReviewSearchScope
} from './reviewSearch';
import { createReviewSections, groupReviewFiles } from './reviewSections';
import {
  createReviewViewState,
  getReviewScrollTopForNavigation,
  type ReviewNavigationReason,
  selectReviewViewUnit,
  setReviewViewScrollTop,
  type ReviewViewState
} from './reviewViewState';

export { AgentNoteAnnotation } from './ReviewDiffParts';
export type {
  ReviewFileCommentInput,
  ReviewInlineGuideNote,
  ReviewLineComment,
  ReviewLineCommentInput,
  ReviewLineReplyInput
} from './ReviewDiffParts';

// An AI brief jump to a file (and line or comment) inside the selected block.
type GuideLocation = { file: GitReviewGuideFile; navigationSignal: number; unitId: string; commentId?: string | number };

type ReviewViewProps = {
  repoPath: string;
  target: GitReviewTarget;
  plan?: GitReviewPlan;
  initialPreferences?: ReviewPreferences;
  initialGuideOpen?: boolean;
  sidebarActions?: ReactNode;
  reviewGuideProvider?: {
    getState: (sourceFingerprint: string) => Promise<GitReviewGuideState>;
    start: (sourceFingerprint: string) => Promise<GitReviewGuideState>;
  };
  reviewProgressKey?: string;
  continuityIdentity?: ReviewContinuityIdentity;
  lineComments?: ReviewLineComment[];
  onAddDraftLineComment?: (input: ReviewLineCommentInput) => Promise<void>;
  onAddDraftFileComment?: (input: ReviewFileCommentInput) => Promise<void>;
  onAddDraftReply?: (input: ReviewLineReplyInput) => Promise<void>;
  onUpdateComment?: (commentId: number, body: string) => Promise<void>;
  onUpdateDraftComment?: (id: string, body: string) => void;
  onRemoveDraftComment?: (id: string) => void;
  diffStyle: DiffStyle;
  diffSyntaxTheme: DiffSyntaxTheme;
  onSetDiffStyle: (style: DiffStyle) => void;
  onClose: () => void;
  closeLabel?: string;
  showCloseButton?: boolean;
  layout?: 'standard' | 'pull-request';
  initialViewState?: ReviewViewState;
  onViewStateChange?: (state: ReviewViewState) => void;
  // Opens a file (optionally a line range) from outside the review, such as a Tour point or an Overview
  // thread. Bump signal to repeat the same request. `commentId` lands on that thread (scrolled to and
  // focused), not just its line.
  navigationRequest?: { path: string; line?: number; endLine?: number; side?: 'left' | 'right'; commentId?: number; signal: number };
  // Notes from the pull-request Tour, shown inline at their lines with a link back to their step.
  guideReferences?: readonly ReviewInlineGuideNote[];
  // The props below apply to the pull-request layout only.
  // Which files this instance shows and in what order. No `paths`: every file of the plan in tree order, with
  // the Show filters and since-last-review scope applied. With `paths`: exactly those files in that order,
  // never hidden by filters. Scroll position and the current file are remembered per `key`.
  fileScope?: { key: string; paths?: readonly string[] };
  // Replaces the files panel with the caller's own panel, in the same resizable column.
  sidebar?: ReactNode;
  // Shrinks the caller's panel to a slim strip (no resize handle); the caller draws the strip.
  sidebarCollapsed?: boolean;
  // Replaces "File N of M · X viewed" and the viewed bar in the progress strip.
  progressLead?: ReactNode;
  // False while the tab showing this instance is hidden: ignore every shortcut and never take focus.
  active?: boolean;
  // A line or file comment composer is open.
  onComposerOpenChange?: (open: boolean) => void;
  // Some editor here (composer, reply, comment edit) holds typed, unsaved text.
  onUnsavedTextChange?: (unsaved: boolean) => void;
  // A change was refused because it would hide a composer or typed text (the caller explains why).
  onScopeLockRefused?: () => void;
  // Files of the current scope in display order, for the caller's own panel.
  onFilesChange?: (files: ReadonlyArray<ReviewScopeFileSummary>) => void;
};

export type ReviewScopeFileSummary = { path: string; additions: number; deletions: number; viewed: boolean; hidden: boolean };

const ALL_FILES_SCOPE = { key: 'all' } as const;
// Diff keys that still work while focus is on the pull request rail (it owns the arrows itself).
const RAIL_FORWARDED_DIFF_KEYS: ReadonlySet<string> = new Set(['[', ']', 'v', 'c']);
const NO_PREPARED_DIFFS: ReadonlyMap<string, PreparedReviewDiff> = new Map();
// Sticky file headers never cover a line scrolled into view (line cursor, jumps).
const PULL_REQUEST_DIFF_CSS = '[data-line], [data-column-number] { scroll-margin-top: 40px; scroll-margin-bottom: 8px; }';


const NO_GUIDE_FINDINGS: readonly ReviewGuideFinding[] = [];


/** An inline AI note; Guide notes also carry their letter key, title, and a way back to their stop. */

const NO_AGENT_NOTES: readonly GitAgentNote[] = [];
const NO_HIDDEN_AGENT_NOTE_IDS: ReadonlySet<string> = new Set();

function ignoreAgentNoteHiddenChange(): void {}

type ReviewCommentTarget =
  | { kind: 'line'; chunkId: string; path: string; range: SelectedLineRange }
  | { kind: 'file'; chunkId: string; path: string };


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

type ReviewTypeDefinitionPreview = {
  token: string;
  sourcePath: string;
  sourceFingerprint: string;
  isLoading: boolean;
  result?: GitReviewTypeDefinitionResult;
  errorMessage?: string;
};


export function ReviewView({
  repoPath,
  target,
  plan: embeddedPlan,
  initialPreferences,
  initialGuideOpen = false,
  sidebarActions,
  reviewGuideProvider,
  reviewProgressKey,
  continuityIdentity,
  lineComments = [],
  onAddDraftLineComment,
  onAddDraftFileComment,
  onAddDraftReply,
  onUpdateComment,
  onUpdateDraftComment,
  onRemoveDraftComment,
  diffStyle,
  diffSyntaxTheme,
  onSetDiffStyle,
  onClose,
  closeLabel = 'Close review',
  showCloseButton = true,
  layout = 'standard',
  initialViewState,
  onViewStateChange,
  navigationRequest,
  guideReferences = NO_GUIDE_NOTES,
  fileScope = ALL_FILES_SCOPE,
  sidebar,
  sidebarCollapsed = false,
  progressLead,
  active = true,
  onComposerOpenChange,
  onUnsavedTextChange,
  onScopeLockRefused,
  onFilesChange
}: ReviewViewProps): ReactElement {
  const isPullRequest = layout === 'pull-request';
  const sectionRef = useRef<HTMLElement>(null);
  const viewStateRef = useRef(createReviewViewState(initialViewState));
  const workerPool = useWorkerPool();
  const queryClient = useQueryClient();
  const [preferences, setPreferences] = useState<ReviewPreferences>(() =>
    initialPreferences
      ? { ...initialPreferences, filePatterns: [...initialPreferences.filePatterns] }
      : loadReviewPreferences(window.localStorage, repoPath)
  );
  const continuity = useReviewContinuity(continuityIdentity, embeddedPlan, preferences, sectionRef);
  const [isPreviousReviewOpen, setPreviousReviewOpen] = useState(false);
  const previousReviewTitleId = useId();
  const [isPatternEditorOpen, setIsPatternEditorOpen] = useState(false);
  const [revealedFilePath, setRevealedFilePath] = useState<string>();
  const [isFileTreeOpen, setIsFileTreeOpen] = useState(() =>
    loadReviewFileTreeOpen(window.localStorage, repoPath)
  );
  const [hiddenAgentNotesState, setHiddenAgentNotesState] = useState<{
    repoPath: string;
    ids: ReadonlySet<string>;
  }>(() =>
    ({ repoPath, ids: loadHiddenAgentNoteIds(window.localStorage, repoPath) })
  );
  const storedHiddenAgentNoteIds = useMemo(
    () => loadHiddenAgentNoteIds(window.localStorage, repoPath),
    [repoPath]
  );
  const hiddenAgentNoteIds = hiddenAgentNotesState.repoPath === repoPath
    ? hiddenAgentNotesState.ids
    : storedHiddenAgentNoteIds;
  const [selectedUnitId, setSelectedUnitId] = useState<string | undefined>(
    () => initialViewState?.selectedUnitId ?? continuity.initialUnitId
  );
  const [requestedFilePath, setRequestedFilePath] = useState<string | undefined>(
    () => initialViewState?.requestedFilePath
  );
  const [fileNavigationSignal, setFileNavigationSignal] = useState(0);
  const [scrollRestoration, setScrollRestoration] = useState<
    { scrollTop: number; unitId: string } | undefined
  >(() => {
    const unitId = initialViewState?.selectedUnitId;
    const scrollTop = unitId
      ? initialViewState?.scrollTopByUnit[unitId]
      : undefined;

    return unitId !== undefined && scrollTop !== undefined
      ? { scrollTop, unitId }
      : undefined;
  });
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
  const [isGuideOpen, setIsGuideOpen] = useState(initialGuideOpen);
  const [previousGuide, setPreviousGuide] = useState<GitReviewGuide>();
  const [typeDefinitionPreview, setTypeDefinitionPreview] = useState<ReviewTypeDefinitionPreview>();
  const typeDefinitionRequestRef = useRef(0);
  const typeDefinitionHoverRef = useRef<ReviewTypeDefinitionHoverTarget | undefined>(undefined);
  const typeDefinitionHoverRequestRef = useRef(0);
  const typeDefinitionHoverTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const typeDefinitionHoverCacheRef = useRef(new Map<string, boolean>());
  const isTypeDefinitionModifierPressedRef = useRef(false);
  const reviewQuery = useReviewPlan(
    embeddedPlan ? undefined : repoPath,
    embeddedPlan ? undefined : target
  );
  const agentNotesQuery = useAgentNotes(repoPath);
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
  const agentNotes = useMemo(
    () => resolveAgentNotes(agentNotesQuery.data ?? [], reviewPlan?.fileContexts ?? []),
    [agentNotesQuery.data, reviewPlan?.fileContexts]
  );
  useEffect(() => {
    typeDefinitionRequestRef.current += 1;
    typeDefinitionHoverRequestRef.current += 1;
    clearTimeout(typeDefinitionHoverTimerRef.current);
    typeDefinitionHoverTimerRef.current = undefined;
    typeDefinitionHoverCacheRef.current.clear();
    if (typeDefinitionHoverRef.current) {
      setReviewTypeDefinitionHoverAvailable(
        typeDefinitionHoverRef.current.token.tokenElement,
        false
      );
      typeDefinitionHoverRef.current = undefined;
    }
  }, [repoPath, reviewPlan?.sourceFingerprint]);
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
  const continuityHiddenIds = continuity.hideSeen ? continuity.hiddenIds : undefined;
  const basePresentation = useMemo(
    () => reviewPlan ? createReviewPresentation(reviewPlan, preferences, reviewedChunkIds, revealedFilePath, continuityHiddenIds) : undefined,
    [preferences, reviewPlan, reviewedChunkIds, revealedFilePath, continuityHiddenIds]
  );
  const generatedReviewGuide =
    currentReviewGuideState?.status === 'ready'
      ? currentReviewGuideState.guide
      : previousGuide?.sourceFingerprint === reviewPlan?.sourceFingerprint ? previousGuide : undefined;
  const reviewGuide = isGuideOpen && generatedReviewGuide?.sourceFingerprint === reviewPlan?.sourceFingerprint &&
    generatedReviewGuide?.targetKey === reviewPlan?.targetKey ? generatedReviewGuide : undefined;
  const guidePlan = useMemo(() => reviewPlan ? createReviewGuidePlan(reviewPlan, reviewGuide) : undefined,
    [reviewPlan, reviewGuide]);
  const isGuideRanked = Boolean(reviewGuide);
  const allFileUnits = useMemo(() => guidePlan?.units.map((unit) => ({
    unit, visibleChunks: unit.chunks, skippedCount: 0,
    isViewed: unit.chunks.every((chunk) => reviewedChunkIds.has(chunk.id))
  })) ?? [], [guidePlan, reviewedChunkIds]);
  const reviewGuideUnits = useMemo(
    () => new Map(reviewGuide?.units.map((unit) => [unit.unitId, unit]) ?? []), [reviewGuide]);
  const presentation = useMemo(() => {
    if (!guidePlan || !reviewGuide) return basePresentation;
    const layered = createReviewPresentation(guidePlan, preferences, reviewedChunkIds, revealedFilePath, continuityHiddenIds);
    return { ...layered, units: layered.units.map((unit) => ({ ...unit,
      visibleChunks: rankReviewChunksByGuide(unit.visibleChunks, reviewGuideUnits.get(unit.unit.id))
    })) };
  }, [basePresentation, guidePlan, reviewGuide, preferences, reviewedChunkIds, revealedFilePath, reviewGuideUnits, continuityHiddenIds]);
  const activeFilterCount = [
    continuity.hideSeen && continuity.hiddenIds.size > 0,
    preferences.skipTests,
    preferences.skipImports,
    preferences.skipGenerated,
    preferences.skipDeletions,
    preferences.skipEmptyLines,
    preferences.skipFilePatterns && preferences.filePatterns.length > 0
  ].filter(Boolean).length;
  const fileContexts = useMemo(
    () => new Map(reviewPlan?.fileContexts.map((context) => [context.id, context]) ?? []),
    [reviewPlan?.fileContexts]
  );
  const typeDefinitionPaths = useMemo(
    () => new Set(
      reviewPlan?.fileContexts
        .filter((context) => isTypeScriptReviewContext({
          path: context.path,
          language: context.syntax?.language
        }))
        .map((context) => context.path) ?? []
    ),
    [reviewPlan?.fileContexts]
  );
  const selectedUnit =
    presentation?.units.find((candidate) => candidate.unit.id === selectedUnitId) ??
    presentation?.units.find((candidate) => reviewGuideUnits.get(candidate.unit.id)?.sourceUnitIds?.includes(selectedUnitId ?? '')) ??
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
  // The pull-request layout prepares each file's diffs when that file mounts (ReviewFilesView).
  const selectedPreparedDiffs = useMemo<ReadonlyMap<string, PreparedReviewDiff>>(
    () => isPullRequest ? NO_PREPARED_DIFFS : prepareReviewUnitDiffs(
      selectedUnit,
      fileContexts,
      preparedDiffCacheKeyPrefix
    ),
    [fileContexts, isPullRequest, preparedDiffCacheKeyPrefix, selectedUnit]
  );
  const scopePaths = fileScope.paths;
  const scopeFiles = useMemo(() => {
    if (!isPullRequest || !reviewPlan || !presentation) return [];
    const visibleChunkIds = new Set(presentation.units.flatMap((unit) => unit.visibleChunks.map((chunk) => chunk.id)));
    return createReviewFileScope({ units: reviewPlan.units, visibleChunkIds, reviewedChunkIds, paths: scopePaths });
  }, [isPullRequest, reviewPlan, presentation, reviewedChunkIds, scopePaths]);
  const filesViewRef = useRef<ReviewFilesViewHandle>(null);
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
    () => {
      const base = createDiffOptionsBase<ReviewDiffAnnotation>(diffSyntaxTheme);
      return {
        ...base,
        diffStyle,
        disableFileHeader: true,
        unsafeCSS: isPullRequest ? `${base.unsafeCSS ?? ''}\n${PULL_REQUEST_DIFF_CSS}` : base.unsafeCSS
      };
    },
    [diffStyle, diffSyntaxTheme, isPullRequest]
  );

  useEffect(() => {
    if (isPullRequest) onFilesChange?.(scopeFiles.map(({ path, additions, deletions, viewed, hidden }) => ({ path, additions, deletions, viewed, hidden })));
  }, [isPullRequest, onFilesChange, scopeFiles]);

  // Unsaved text is reported by each editor (composer, reply, edit); the owner hears only the aggregate.
  const unsavedEditorsRef = useRef(new Set<string>());
  const [hasUnsavedEditorText, setHasUnsavedEditorText] = useState(false);
  const onUnsavedTextChangeRef = useRef(onUnsavedTextChange);
  useLayoutEffect(() => { onUnsavedTextChangeRef.current = onUnsavedTextChange; });
  const reportUnsavedText = useCallback((id: string, unsaved: boolean) => {
    const editors = unsavedEditorsRef.current;
    const before = editors.size > 0;
    if (unsaved) editors.add(id);
    else editors.delete(id);
    if (before === editors.size > 0) return;
    setHasUnsavedEditorText(editors.size > 0);
    onUnsavedTextChangeRef.current?.(editors.size > 0);
  }, []);

  const isComposerOpen = selectedCommentTarget !== undefined;
  // Filters and the Show scope can hide a file, which would unmount an open composer or a typed reply or edit.
  const isScopeLocked = isComposerOpen || hasUnsavedEditorText;
  useEffect(() => { onComposerOpenChange?.(isComposerOpen); }, [isComposerOpen, onComposerOpenChange]);
  const progressMutation = useMutation({
    mutationFn: async ({ chunkIds, viewed }: { chunkIds: string[]; viewed: boolean }) => {
      if (embeddedPlan) {
        continuity.markChunks(chunkIds, viewed);
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
      // The composer unmounts; return focus so the review's keys keep working.
      focusReview();
    }
  });

  // A hidden tab's review never takes focus.
  function focusReview(): void {
    if (active) sectionRef.current?.focus({ preventScroll: true });
  }

  // Mounting (a new pull request after J/K, a new head) leaves focus where the reader put it inside the
  // pull request workspace, such as on the rail, so the rail's arrows keep working.
  const focusOnMount = useEffectEvent(() => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused !== document.body && focused.closest('[data-pull-request-workspace]')) return;
    focusReview();
  });
  useEffect(() => focusOnMount(), []);

  useEffect(() => {
    if (!selectedUnit) {
      return;
    }

    const nextState = selectReviewViewUnit(
      viewStateRef.current,
      selectedUnit.unit.id,
      requestedFilePath
    );
    viewStateRef.current = nextState;
    onViewStateChange?.(nextState);
  }, [onViewStateChange, requestedFilePath, selectedUnit]);

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
    if (workerPool && isPullRequest && isReviewSearchSelected) {
      for (const prepared of reviewSearchPreparedDiffs.values()) workerPool.primeDiffHighlightCache(prepared.fileDiff);
    }
    if (!workerPool || !selectedUnit || !presentation || isPullRequest) {
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
    isPullRequest,
    preparedDiffCacheKeyPrefix,
    presentation,
    isReviewSearchSelected,
    reviewSearchPreparedDiffs,
    selectedPreparedDiffs,
    selectedUnit,
    workerPool
  ]);

  function updatePreferences(next: ReviewPreferences): void {
    if (isScopeLocked) {
      return;
    }
    setPreferences(next);
    setRevealedFilePath(undefined);
    saveReviewPreferences(window.localStorage, repoPath, next);
  }

  function setFileTreeOpen(isOpen: boolean): void {
    setIsFileTreeOpen(isOpen);
    saveReviewFileTreeOpen(window.localStorage, repoPath, isOpen);
  }

  function setAgentNoteHidden(noteId: string, hidden: boolean): void {
    setHiddenAgentNotesState((current) => {
      const currentIds = current.repoPath === repoPath
        ? current.ids
        : loadHiddenAgentNoteIds(window.localStorage, repoPath);
      const next = new Set(currentIds);

      if (hidden) {
        next.add(noteId);
      } else {
        next.delete(noteId);
      }

      saveHiddenAgentNoteIds(window.localStorage, repoPath, next);
      return { repoPath, ids: next };
    });
  }

  function cancelCommentComposer(): void {
    setSelectedCommentTarget(undefined);
    lineCommentBody.clear();
    commentMutation.reset();
    focusReview();
  }

  function selectReviewUnit(
    unitId: string,
    reason: ReviewNavigationReason = 'unit'
  ): void {
    setIsReviewSearchSelected(false);

    if (
      unitId === selectedUnit?.unit.id ||
      selectedCommentTarget !== undefined ||
      commentMutation.isPending
    ) {
      return;
    }
    const scrollTop = getReviewScrollTopForNavigation(
      viewStateRef.current,
      unitId,
      reason
    );
    setScrollRestoration(
      scrollTop === undefined ? undefined : { scrollTop, unitId }
    );
    setSelectedUnitId(unitId);
    if (reason === 'unit') setRevealedFilePath(undefined);
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
    window.requestAnimationFrame(() => focusReview());
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

  function setGuideOpen(open: boolean): void {
    if (selectedCommentTarget !== undefined || commentMutation.isPending) return;
    // Return to the original block owning the visible file, not the first member of a merged layer.
    if (!open && selectedUnit) {
      const chunk = selectedUnit.visibleChunks.find((item) => item.path === selectedFilePath) ?? selectedUnit.visibleChunks[0];
      const original = basePresentation?.units.find((unit) => unit.visibleChunks.some((item) => item.id === chunk?.id));
      if (original) setSelectedUnitId(original.unit.id);
    }
    if (selectedFilePath) setRequestedFilePath(selectedFilePath);
    setIsGuideOpen(open);
  }

  function selectGuideUnit(unitId: string): void {
    if (selectedCommentTarget !== undefined || commentMutation.isPending) return;
    const next = presentation?.units.find((unit) => unit.unit.id === unitId);
    if (!next) return;
    selectReviewUnit(unitId);
    setRequestedFilePath(next.visibleChunks[0]?.path);
    setFileNavigationSignal((signal) => signal + 1);
  }

  async function startReviewGuide(): Promise<void> {
    if (!isReviewGuideEnabled || !reviewPlan || currentReviewGuideState?.status === 'running' ||
      selectedCommentTarget !== undefined || commentMutation.isPending) {
      return;
    }

    const sourceFingerprint = reviewPlan.sourceFingerprint;
    setSelectedUnitId(selectedUnit?.unit.id);
    setIsGuideOpen(true);
    setPreviousGuide(reviewGuide);
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
    if (!selectedUnit || progressMutation.isPending || selectedCommentTarget !== undefined || commentMutation.isPending) {
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
    if (selectedCommentTarget !== undefined || commentMutation.isPending) return;
    setRequestedFilePath(path);

    if (!path) {
      return;
    }

    // A file the filters hide is listed dimmed; opening it reveals just that file.
    const isVisible = presentation?.units.some((unit) => unit.visibleChunks.some((chunk) => chunk.path === path));
    if (!isVisible) {
      selectAllFile(path, selectedUnit?.skippedChunks?.some((chunk) => chunk.path === path) ? selectedUnit.unit.id : undefined);
      return;
    }

    setFileNavigationSignal((signal) => signal + 1);

    const unitId = selectedUnit?.visibleChunks.some((chunk) => chunk.path === path)
      ? selectedUnit.unit.id
      : findReviewUnitIdForPath(presentation?.units ?? [], path);

    if (unitId) {
      selectReviewUnit(unitId, 'file');
    }
  }

  function selectAllFile(path: string | undefined, preferredUnitId?: string): boolean {
    if (!path || selectedCommentTarget !== undefined || commentMutation.isPending) return false;
    const unitId = preferredUnitId ?? (reviewGuide && selectedUnit?.unit.chunks.some((chunk) => chunk.path === path) ? selectedUnit.unit.id : findReviewUnitIdForPath(allFileUnits, path));
    if (!unitId) return false;
    // Reveal this file only. Saved review filters continue to apply to every other file.
    setRevealedFilePath(path);
    setRequestedFilePath(path);
    setFileNavigationSignal((signal) => signal + 1);
    selectReviewUnit(unitId, 'file');
    return true;
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

  function saveReviewScrollTop(unitId: string, scrollTop: number, visiblePath?: string): void {
    if (visiblePath) setRequestedFilePath(visiblePath);
    const nextState = setReviewViewScrollTop(viewStateRef.current, unitId, scrollTop);
    viewStateRef.current = nextState;
    onViewStateChange?.(nextState);
  }

  // The diff keys are advertised for the whole Tour and Code tab, but React only delivers them while
  // focus is inside this section. After H/L or a tab click focus sits on `body` or the tab, and after J/K
  // on the rail, so those presses are forwarded here (from the rail only `[` `]` V C: it owns the arrows).
  // Keys pressed inside the section arrive through `handleKeyDown`.
  const forwardOutsideDiffKey = useEffectEvent((event: globalThis.KeyboardEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || sectionRef.current?.contains(target)) return;
    const outsideTarget = target === document.body || target.closest('[id^="pr-detail-tab-"]') !== null;
    // A rail row, not the rail's search field, which keeps its own typing.
    const inRail = target.closest('.pr-rail') !== null && !isEditableTarget(target);
    // Mod+F opens the diff search from the tab, `body` or a rail row too, as it does inside the section.
    if ((outsideTarget || inRail) && isFindShortcut(event) && !event.defaultPrevented) {
      if (selectedCommentTarget !== undefined || commentMutation.isPending) return;
      event.preventDefault();
      openReviewSearch(readSelectedReviewText());
      return;
    }
    const fromRail = inRail && RAIL_FORWARDED_DIFF_KEYS.has(event.key.toLowerCase());
    if (!outsideTarget && !fromRail) return;
    if (selectedCommentTarget !== undefined || commentMutation.isPending || isReviewSearchSelected) return;
    filesViewRef.current?.handleKeyDown({
      key: event.key,
      shiftKey: event.shiftKey,
      preventDefault: () => event.preventDefault(),
      nativeEvent: event
    });
  });
  useEffect(() => {
    if (!isPullRequest || !active) return;
    const listener = (event: globalThis.KeyboardEvent): void => forwardOutsideDiffKey(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [isPullRequest, active]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (!active) return;
    // Portaled menus still bubble through React; their keys must not navigate or close the review.
    if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('[role="menu"]'))) return;
    if (selectedCommentTarget !== undefined || commentMutation.isPending) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        // Escape dismisses an empty composer; typed text needs an explicit Cancel.
        if (!commentMutation.isPending && !lineCommentBody.get().trim()) cancelCommentComposer();
      }
      return;
    }
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

    if (isPullRequest) {
      // A pull request closes from its header, so Escape never discards the reader's place here.
      if (active) filesViewRef.current?.handleKeyDown(event);
      return;
    }

    const isPlainTarget = !isEditableTarget(event.target) && !isReviewFileTreeTarget(event.target);

    if (
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      !isPlainTarget
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

  const handleTypeDefinitionRequest = useCallback<ReviewTypeDefinitionRequest>(
    (chunk, token, event) => {
      if (!isReviewTypeDefinitionGesture(event)) {
        return;
      }

      const sourceFingerprint = reviewPlan?.sourceFingerprint ?? '';
      const request = createReviewTypeDefinitionInput(
        chunk.path,
        chunk.source,
        token.side === 'deletions' ? 'old' : 'new',
        token.lineNumber,
        getReviewTypeDefinitionCharacter(token, event),
        target,
        sourceFingerprint,
        reviewPlan?.fileContexts ?? []
      );

      if (!request) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const requestId = ++typeDefinitionRequestRef.current;
      setTypeDefinitionPreview({
        token: token.tokenText,
        sourcePath: request.filePath,
        sourceFingerprint,
        isLoading: true
      });

      void window.api.getReviewTypeDefinition(repoPath, request)
        .then((result) => {
          if (requestId !== typeDefinitionRequestRef.current) {
            return;
          }

          setTypeDefinitionPreview({
            token: token.tokenText,
            sourcePath: request.filePath,
            sourceFingerprint,
            isLoading: false,
            result,
            errorMessage: result
              ? undefined
              : 'No TypeScript definition was found in the reviewed project snapshot.'
          });
        })
        .catch((error: unknown) => {
          if (requestId !== typeDefinitionRequestRef.current) {
            return;
          }

          setTypeDefinitionPreview({
            token: token.tokenText,
            sourcePath: request.filePath,
            sourceFingerprint,
            isLoading: false,
            errorMessage: error instanceof Error
              ? error.message
              : 'Unable to resolve this TypeScript definition.'
          });
        });
    },
    [repoPath, reviewPlan?.fileContexts, reviewPlan?.sourceFingerprint, target]
  );

  const resolveTypeDefinitionHover = useCallback(
    (hoverTarget: ReviewTypeDefinitionHoverTarget) => {
      const request = createReviewTypeDefinitionInput(
        hoverTarget.chunk.path,
        hoverTarget.chunk.source,
        hoverTarget.token.side === 'deletions' ? 'old' : 'new',
        hoverTarget.token.lineNumber,
        getReviewTypeDefinitionCharacter(hoverTarget.token, hoverTarget.event),
        target,
        reviewPlan?.sourceFingerprint ?? '',
        reviewPlan?.fileContexts ?? []
      );

      if (!request) {
        return;
      }

      const cacheKey = reviewTypeDefinitionHoverCacheKey(request);
      const cachedAvailability = typeDefinitionHoverCacheRef.current.get(cacheKey);
      if (cachedAvailability !== undefined) {
        setReviewTypeDefinitionHoverAvailable(
          hoverTarget.token.tokenElement,
          cachedAvailability
        );
        return;
      }

      const requestId = ++typeDefinitionHoverRequestRef.current;
      void window.api.getReviewTypeDefinition(repoPath, request)
        .then((result) => {
          typeDefinitionHoverCacheRef.current.set(cacheKey, Boolean(result));
          if (
            requestId !== typeDefinitionHoverRequestRef.current ||
            typeDefinitionHoverRef.current?.token.tokenElement !==
              hoverTarget.token.tokenElement ||
            !isTypeDefinitionModifierPressedRef.current
          ) {
            return;
          }

          setReviewTypeDefinitionHoverAvailable(hoverTarget.token.tokenElement, Boolean(result));
        })
        .catch(() => {
          // Hover discovery is intentionally silent; Cmd-click still reports resolution errors.
        });
    },
    [repoPath, reviewPlan?.fileContexts, reviewPlan?.sourceFingerprint, target]
  );

  const scheduleTypeDefinitionHover = useCallback(
    (hoverTarget: ReviewTypeDefinitionHoverTarget) => {
      clearTimeout(typeDefinitionHoverTimerRef.current);
      typeDefinitionHoverTimerRef.current = setTimeout(() => {
        typeDefinitionHoverTimerRef.current = undefined;
        resolveTypeDefinitionHover(hoverTarget);
      }, 80);
    },
    [resolveTypeDefinitionHover]
  );

  const typeDefinitionInteraction = useMemo<ReviewTypeDefinitionInteraction>(
    () => ({
      onClick: handleTypeDefinitionRequest,
      onEnter(chunk, token, event) {
        const previousTarget = typeDefinitionHoverRef.current;
        if (previousTarget?.token.tokenElement !== token.tokenElement) {
          if (previousTarget) {
            setReviewTypeDefinitionHoverAvailable(previousTarget.token.tokenElement, false);
          }
          typeDefinitionHoverRequestRef.current += 1;
          clearTimeout(typeDefinitionHoverTimerRef.current);
          typeDefinitionHoverTimerRef.current = undefined;
        }

        const hoverTarget = { chunk, token, event };
        typeDefinitionHoverRef.current = hoverTarget;
        isTypeDefinitionModifierPressedRef.current = isReviewTypeDefinitionModifier(event);
        setReviewTypeDefinitionHoverAvailable(token.tokenElement, false);

        if (isTypeDefinitionModifierPressedRef.current) {
          scheduleTypeDefinitionHover(hoverTarget);
        }
      },
      onLeave(token) {
        setReviewTypeDefinitionHoverAvailable(token.tokenElement, false);
        if (typeDefinitionHoverRef.current?.token.tokenElement === token.tokenElement) {
          typeDefinitionHoverRef.current = undefined;
          typeDefinitionHoverRequestRef.current += 1;
          clearTimeout(typeDefinitionHoverTimerRef.current);
          typeDefinitionHoverTimerRef.current = undefined;
        }
      }
    }),
    [handleTypeDefinitionRequest, scheduleTypeDefinitionHover]
  );

  useEffect(() => {
    function syncModifierState(event: globalThis.KeyboardEvent): void {
      const isPressed = isReviewTypeDefinitionModifier(event);
      if (isPressed === isTypeDefinitionModifierPressedRef.current) {
        return;
      }

      isTypeDefinitionModifierPressedRef.current = isPressed;
      typeDefinitionHoverRequestRef.current += 1;
      clearTimeout(typeDefinitionHoverTimerRef.current);
      typeDefinitionHoverTimerRef.current = undefined;
      const hoverTarget = typeDefinitionHoverRef.current;
      if (!hoverTarget) {
        return;
      }

      setReviewTypeDefinitionHoverAvailable(hoverTarget.token.tokenElement, false);
      if (isPressed) {
        scheduleTypeDefinitionHover(hoverTarget);
      }
    }

    function clearModifierState(): void {
      isTypeDefinitionModifierPressedRef.current = false;
      typeDefinitionHoverRequestRef.current += 1;
      clearTimeout(typeDefinitionHoverTimerRef.current);
      typeDefinitionHoverTimerRef.current = undefined;
      const hoverTarget = typeDefinitionHoverRef.current;
      if (hoverTarget) {
        setReviewTypeDefinitionHoverAvailable(hoverTarget.token.tokenElement, false);
      }
    }

    window.addEventListener('keydown', syncModifierState);
    window.addEventListener('keyup', syncModifierState);
    window.addEventListener('blur', clearModifierState);
    return () => {
      window.removeEventListener('keydown', syncModifierState);
      window.removeEventListener('keyup', syncModifierState);
      window.removeEventListener('blur', clearModifierState);
      clearModifierState();
    };
  }, [scheduleTypeDefinitionHover]);

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
        onUpdateDraftComment,
        onRemoveDraftComment
      }
    : undefined;

  const guideControls = isReviewGuideEnabled && reviewPlan?.units.length ? (
    <div className="review-guide-header-controls">
      <p className="review-mode-status" data-ai={Boolean(reviewGuide)} role="status">
        {reviewGuide ? 'AI review' : 'Standard review'}
      </p>
      <ReviewGuideControl
        state={currentReviewGuideState}
        open={isGuideOpen}
        onToggle={() => setGuideOpen(!isGuideOpen)}
        onStart={() => void startReviewGuide()}
      />
    </div>
  ) : null;

  const filterMenu = (
    <ReviewFilterMenu
      preferences={preferences}
      activeCount={activeFilterCount}
      disabled={isScopeLocked}
      onChange={updatePreferences}
      onConfigurePatterns={() => setIsPatternEditorOpen(true)}
      continuity={continuity}
      onInspectPrevious={() => setPreviousReviewOpen(true)}
    />
  );
  const diffLayoutSwitch = (
    <div className="segmented shrink-0" role="group" aria-label="Diff layout">
      <button type="button" aria-label="Unified diff" aria-pressed={diffStyle === 'unified'} data-active={diffStyle === 'unified'} onClick={() => onSetDiffStyle('unified')} title="Unified diff">
        <Rows3 size={12} />
      </button>
      <button type="button" aria-label="Split diff" aria-pressed={diffStyle === 'split'} data-active={diffStyle === 'split'} onClick={() => onSetDiffStyle('split')} title="Split diff">
        <Columns2 size={12} />
      </button>
    </div>
  );

  const continuityEmpty = (continuity.hideSeen && continuity.hiddenIds.size > 0) || continuity.previousChanges.length > 0 ? (
    <div className="grid h-full place-content-center gap-3 p-6 text-center text-xs text-[var(--text-2)]">
      <p>{continuity.hiddenIds.size > 0 && continuity.hideSeen ? 'Previously seen, unchanged code is hidden.' : 'The current PR has no visible changes. Previous changes were replaced or removed.'}</p>
      {continuity.hideSeen && continuity.hiddenIds.size > 0 ? <button className="btn-subtle justify-self-center" type="button" onClick={() => continuity.setHideSeen(false)}>Show previously seen code</button> : null}
      {continuity.previousChanges.length > 0 ? <button className="btn-subtle justify-self-center" type="button" onClick={() => setPreviousReviewOpen(true)}>Inspect replaced or removed changes ({continuity.previousChanges.length})</button> : null}
    </div>
  ) : undefined;
  const emptyReviewMessage = target.kind === 'branch'
    ? `${target.name} has no changes compared with the default branch.`
    : 'There are no changes to review.';
  const isLoading = embeddedPlan ? false : reviewQuery.isLoading;
  const loadErrorMessage = !embeddedPlan && reviewQuery.error instanceof Error ? reviewQuery.error.message : undefined;
  const mutationError = progressMutation.error instanceof Error ? progressMutation.error.message : undefined;

  const reviewSearchView: ReviewSearchViewState | undefined = currentReviewSearch
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
    : undefined;

  const toolbar = (
    <>
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
          {filterMenu}
          <ReviewProgress presentation={presentation} />
        </div>

        <div className="review-toolbar-actions">
          {guideControls}
          {diffLayoutSwitch}
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

      {currentReviewGuideState?.status === 'failed' ? (
        <ReviewGuideFailureMessage errorMessage={currentReviewGuideState.errorMessage} />
      ) : null}
    </>
  );

  const filesMessage = isLoading ? (
    <ReviewMessage icon={<Loader2 size={16} className="animate-spin" />} text="Building contextual review…" />
  ) : loadErrorMessage ? (
    <ReviewMessage icon={<AlertTriangle size={16} />} text={loadErrorMessage} tone="danger" />
  ) : scopeFiles.some((file) => !file.hidden) ? undefined : fileScope.paths ? (
    <ReviewMessage icon={<Check size={16} />} text="No changed files in this part of the review." />
  ) : continuityEmpty ?? (reviewPlan?.units.length ? (
    <ReviewMessage icon={<SkipForward size={16} />} text="All changes are skipped by the current review filters." />
  ) : (
    <ReviewMessage icon={<Check size={16} />} text={emptyReviewMessage} />
  ));

  return (
    <section ref={sectionRef} className="review-view" data-layout={layout} tabIndex={0} onKeyDown={handleKeyDown}>
      <ReviewUnsavedTextContext value={reportUnsavedText}>
      {isPullRequest ? (
        <ReviewFilesView
          ref={filesViewRef}
          repoPath={repoPath}
          files={scopeFiles}
          scopeKey={fileScope.key}
          sidebar={sidebar}
          sidebarCollapsed={sidebarCollapsed}
          sidebarActions={sidebarActions}
          progressLead={progressLead}
          active={active}
          coverage={presentation}
          footerControls={<>{filterMenu}{diffLayoutSwitch}</>}
          message={filesMessage}
          searchEntry={currentReviewSearch ? (
            <button className="review-files-search-entry" type="button" data-active={isReviewSearchSelected}
              aria-disabled={selectedCommentTarget !== undefined || undefined}
              onClick={() => {
                if (selectedCommentTarget !== undefined) return;
                setIsReviewSearchSelected(true);
                setReviewSearchFocusSignal((signal) => signal + 1);
              }}>
              <Search size={14} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate" title={currentReviewSearch.query || 'Review search'}>
                Search · {compactReviewSearchQuery(currentReviewSearch.query)}
              </span>
              <span className="review-files-search-count">{formatReviewSearchResultCount(reviewSearchResults.locationCount)}</span>
            </button>
          ) : undefined}
          searchPanel={reviewSearchView ? (
            <ReviewSearchPanel
              search={reviewSearchView}
              filesWording
              diffOptions={diffOptions}
              typeDefinitionPaths={typeDefinitionPaths}
              typeDefinitionInteraction={typeDefinitionInteraction}
            />
          ) : undefined}
          isSearchSelected={Boolean(currentReviewSearch) && isReviewSearchSelected}
          diffOptions={diffOptions}
          lineCollaboration={lineCollaboration}
          agentNotes={agentNotes}
          hiddenAgentNoteIds={hiddenAgentNoteIds}
          onSetAgentNoteHidden={setAgentNoteHidden}
          guideNotes={guideReferences}
          typeDefinitionPaths={typeDefinitionPaths}
          typeDefinitionInteraction={typeDefinitionInteraction}
          fileContexts={fileContexts}
          preparedDiffCacheKeyPrefix={preparedDiffCacheKeyPrefix}
          navigationRequest={navigationRequest}
          resumePosition={continuity.resumePosition}
          isMutating={progressMutation.isPending}
          mutationError={mutationError}
          onSetViewed={(file, viewed) => {
            if (!progressMutation.isPending) progressMutation.mutate({ chunkIds: file.chunks.map((chunk) => chunk.id), viewed });
          }}
          onReveal={(path) => {
            if (selectedCommentTarget !== undefined || commentMutation.isPending) return false;
            // Only one hidden file is revealed at a time; replacing it would unmount a typed reply or edit there.
            if (isScopeLocked && revealedFilePath !== undefined && revealedFilePath !== path) {
              onScopeLockRefused?.();
              return false;
            }
            setRevealedFilePath(path);
            return true;
          }}
        />
      ) : (
        <>
          {toolbar}
          <ReviewBody
            repoPath={repoPath}
            isLoading={isLoading}
            errorMessage={loadErrorMessage}
            hasReviewUnits={Boolean(reviewPlan?.units.length)}
            resumePosition={continuity.resumePosition}
            continuityEmpty={continuityEmpty}
            emptyReviewMessage={emptyReviewMessage}
            units={presentation?.units ?? []}
            selectedUnit={selectedUnit}
            preparedDiffs={selectedPreparedDiffs}
            diffOptions={diffOptions}
            isMutating={progressMutation.isPending}
            mutationError={mutationError}
            lineCollaboration={lineCollaboration}
            agentNotes={agentNotes}
            hiddenAgentNoteIds={hiddenAgentNoteIds}
            onSetAgentNoteHidden={setAgentNoteHidden}
            reviewGuide={reviewGuide}
            reviewGuideUnits={reviewGuideUnits}
            isGuideOpen={isGuideOpen}
            isGuideRanked={isGuideRanked}
            isGuideRebuilding={currentReviewGuideState?.status === 'running'}
            onCloseGuide={() => setGuideOpen(false)}
            onGuideSelectUnit={selectGuideUnit}
            isFileTreeOpen={isFileTreeOpen}
            allFileUnits={allFileUnits}
            onSelectAllFile={selectAllFile}
            selectedFilePath={selectedFilePath}
            restoredScrollTop={
              selectedUnit &&
              scrollRestoration &&
              selectedUnit.unit.id === scrollRestoration.unitId
                ? scrollRestoration.scrollTop
                : undefined
            }
            fileNavigationSignal={fileNavigationSignal}
            reviewSearch={reviewSearchView}
            typeDefinitionPaths={typeDefinitionPaths}
            typeDefinitionInteraction={typeDefinitionInteraction}
            onSelectUnit={selectReviewUnit}
            onSelectFile={selectFile}
            onScrollTopChange={saveReviewScrollTop}
            onStartReviewGuide={() => void startReviewGuide()}
            onToggleViewed={() => markSelectedUnit(!(selectedUnit?.isViewed ?? false))}
          />
        </>
      )}
      </ReviewUnsavedTextContext>

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
      {isPreviousReviewOpen ? (
        <ModalSurface labelledBy={previousReviewTitleId} className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded border border-[var(--border)] bg-[var(--bg-panel)]" onClose={() => setPreviousReviewOpen(false)}>
          <header className="flex items-center gap-3 border-b border-[var(--border)] p-3">
            <h2 id={previousReviewTitleId} className="flex-1 text-sm font-semibold">Previous review: replaced or removed changes</h2>
            <button type="button" className="btn-subtle btn-compact" onClick={() => { if (continuity.acknowledgeHistory()) setPreviousReviewOpen(false); }}>Mark inspected</button>
            <button type="button" className="icon-btn" aria-label="Close previous review" onClick={() => setPreviousReviewOpen(false)}><X size={14} /></button>
          </header>
          <p className="p-3 text-xs text-[var(--text-2)]">Saved patches from your previous review. These are historical changes, not the current PR diff. They may have been edited, reverted, renamed, or regrouped into different hunks.</p>
          {continuity.error ? <p role="alert" className="px-3 pb-3 text-xs text-[var(--danger-text)]">{continuity.error}</p> : null}
          <div className="min-h-0 flex-1 overflow-auto">
            {continuity.previousChanges.map((chunk, index) => <section key={`${chunk.id}:${index}`}>
              <h3 className="bg-[var(--bg-graph-header)] px-3 py-2 font-mono text-xs">{chunk.path}</h3>
              {chunk.patch.includes('@@') ? <PatchDiff className="gg-diff" patch={chunk.patch} options={diffOptions} /> : <p className="p-3 text-xs">No saved text preview.</p>}
            </section>)}
          </div>
        </ModalSurface>
      ) : null}
      {typeDefinitionPreview?.sourceFingerprint === reviewPlan?.sourceFingerprint ? (
        <ReviewTypeDefinitionDialog
          {...typeDefinitionPreview}
          syntaxTheme={diffSyntaxTheme}
          onClose={() => {
            typeDefinitionRequestRef.current += 1;
            setTypeDefinitionPreview(undefined);
          }}
        />
      ) : null}
    </section>
  );
}

export function ReviewGuideFailureMessage({
  errorMessage
}: {
  errorMessage: string;
}): ReactElement {
  return (
    <div className="review-guide-error" role="alert">
      <AlertTriangle size={14} aria-hidden="true" />
      <span>
        <strong>AI brief failed.</strong> {errorMessage}
      </span>
    </div>
  );
}

function ReviewToolTooltip({ content, children }: { content: ReactNode; children: ReactElement }): ReactElement {
  return <Tooltip.Provider delayDuration={350}><Tooltip.Root>
    <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content className="pr-row-guide-tooltip" side="bottom" sideOffset={6} collisionPadding={12}>
      {content}
    </Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root></Tooltip.Provider>;
}

function canResumeContinuity(continuity: ReturnType<typeof useReviewContinuity>): boolean {
  return continuity.hasSavedCheckpoint && !continuity.baseChanged;
}

function ReviewGuideControl({ state, open, onStart, onToggle, compact = false }: {
  compact?: boolean;
  state: GitReviewGuideState | undefined;
  open: boolean;
  onStart: () => void;
  onToggle: () => void;
}): ReactElement {
  if (compact) {
    const running = state?.status === 'running';
    const ready = state?.status === 'ready';
    const action = running ? 'Preparing AI brief' : ready ? open ? 'Exit AI review' : 'Open AI brief' :
      state?.status === 'failed' ? 'Retry AI brief' : 'Build AI brief';
    const explanation = running ? 'Preparing summaries, grouping, and priorities in the background.' : ready ?
      open ? 'Return to standard review blocks.' : 'Open AI summaries, grouping, and review priorities.' :
      state?.status === 'failed' ? `Generation failed: ${state.errorMessage}. Try again.` :
      'Generate summaries, group related changes, and suggest review priorities with AI.';
    return <ReviewToolTooltip content={<><strong>{action}</strong><br />{explanation}</>}>
      <button type="button" className="icon-btn review-sidebar-tool" aria-label={action}
        aria-pressed={ready ? open : undefined} aria-busy={running} aria-disabled={running}
        data-status={state?.status} onClick={() => { if (!running) { if (ready) onToggle(); else onStart(); } }}>
        <Sparkles size={14} />
        {running || ready || state?.status === 'failed' ? <span className="review-sidebar-tool-dot" aria-hidden="true" /> : null}
      </button>
    </ReviewToolTooltip>;
  }
  if (state?.status === 'running') {
    return <span className="review-guide-control" role="status">Preparing brief…</span>;
  }
  if (state?.status === 'ready') {
    return <button type="button" className={`${open ? 'btn-subtle' : 'btn-primary'} btn-compact review-guide-ready`} aria-expanded={open}
      title={open ? 'Return to standard blocks and close the AI brief' : 'Open the ready AI brief with AI titles, grouping and priorities'}
      onClick={onToggle}><Sparkles size={12} /> {open ? 'Exit AI review' : 'Open AI brief'}
      {!open ? <span className="review-guide-ready-label">Ready</span> : null}</button>;
  }
  return <button type="button" className="btn-subtle btn-compact" onClick={onStart}
    title={state?.status === 'failed' ? state.errorMessage : undefined}>
    {state?.status === 'failed' ? 'Retry AI brief' : 'Build AI brief'}
  </button>;
}

function ReviewFilterMenu({
  preferences,
  activeCount,
  disabled,
  onChange,
  onConfigurePatterns,
  continuity,
  onInspectPrevious
}: {
  preferences: ReviewPreferences;
  activeCount: number;
  disabled: boolean;
  onChange: (preferences: ReviewPreferences) => void;
  onConfigurePatterns: () => void;
  continuity: ReturnType<typeof useReviewContinuity>;
  onInspectPrevious: () => void;
}): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="btn-subtle btn-compact" type="button" disabled={disabled}
          title={continuity.enabled ? `${continuity.hideSeen ? continuity.hiddenIds.size : 0} previously seen chunks hidden; ${continuity.previousChanges.length} previous changes to inspect` : undefined}>
          {continuity.previousChanges.length > 0 ? <Clock3 size={12} className="text-[var(--warning-text)]" /> : <Settings2 size={12} />}
          Show
          {activeCount > 0 ? <span className="badge-mini" aria-label={`${activeCount} filters on`}>{activeCount}</span> : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64" aria-label="Review filters">
        {continuity.enabled ? <>
          <DropdownMenuLabel>Changes</DropdownMenuLabel>
          <DropdownMenuItem role="menuitemradio" aria-checked={!continuity.hideSeen || !canResumeContinuity(continuity)}
            onSelect={() => continuity.setHideSeen(false)}>
            <Check size={14} className={!continuity.hideSeen || !canResumeContinuity(continuity) ? 'shrink-0' : 'invisible shrink-0'} />
            <span>Whole pull request</span>
          </DropdownMenuItem>
          <DropdownMenuItem role="menuitemradio" aria-checked={continuity.hideSeen && canResumeContinuity(continuity)}
            disabled={!canResumeContinuity(continuity)} onSelect={() => continuity.setHideSeen(true)}>
            <Check size={14} className={continuity.hideSeen && canResumeContinuity(continuity) ? 'shrink-0' : 'invisible shrink-0'} />
            <span>Since my last review{canResumeContinuity(continuity) ? ` (${continuity.hiddenIds.size} seen hidden)` : ''}
              <small className="block text-[var(--text-3)]">
                {continuity.baseChanged ? 'The comparison base changed; all code stays visible' : !continuity.hasSavedCheckpoint
                  ? 'Available after you have seen half the changed lines' : 'Hides code you saw that has not changed since'}
              </small>
            </span>
          </DropdownMenuItem>
          {continuity.hasSavedCheckpoint ? <>
            {continuity.previousChanges.length > 0 ? <DropdownMenuItem onSelect={onInspectPrevious}>
              Inspect previous changes ({continuity.previousChanges.length})
            </DropdownMenuItem> : null}
            <DropdownMenuItem onSelect={continuity.reset}>Reset saved review</DropdownMenuItem>
            {continuity.baseChanged ? <p className="px-2 py-1 text-xs text-[var(--text-3)]">The comparison base changed. All current code stays visible.</p> : null}
          </> : null}
          {continuity.error ? <p role="alert" className="px-2 py-1 text-xs text-[var(--danger-text)]">{continuity.error}</p> : null}
          <DropdownMenuSeparator />
        </> : null}
        <DropdownMenuLabel>Hide from review</DropdownMenuLabel>
        <ReviewFilterMenuItem
          checked={preferences.skipTests}
          icon={<TestTube2 size={14} />}
          label="Tests and specs"
          onChange={(skipTests) => onChange({ ...preferences, skipTests })}
        />
        <ReviewFilterMenuItem
          checked={preferences.skipImports}
          icon={<PackageOpen size={14} />}
          label="Import-only changes"
          onChange={(skipImports) => onChange({ ...preferences, skipImports })}
        />
        <ReviewFilterMenuItem
          checked={preferences.skipGenerated}
          icon={<FileCog size={14} />}
          label="Generated files"
          onChange={(skipGenerated) => onChange({ ...preferences, skipGenerated })}
        />
        <ReviewFilterMenuItem
          checked={preferences.skipDeletions}
          icon={<Trash2 size={14} />}
          label="Deletions"
          onChange={(skipDeletions) => onChange({ ...preferences, skipDeletions })}
        />
        <ReviewFilterMenuItem
          checked={preferences.skipEmptyLines}
          icon={<Pilcrow size={14} />}
          label="Empty line changes"
          onChange={(skipEmptyLines) => onChange({ ...preferences, skipEmptyLines })}
        />
        <ReviewFilterMenuItem
          checked={preferences.skipFilePatterns}
          disabled={preferences.filePatterns.length === 0}
          icon={<Settings2 size={14} />}
          label="Configured patterns"
          onChange={(skipFilePatterns) => onChange({ ...preferences, skipFilePatterns })}
        />
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onConfigurePatterns}>
          <Settings2 size={14} />
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

// The standard (local branch, commit, WIP) review: blocks on the left, the selected block's files on the right.
function ReviewBody({
  repoPath,
  isLoading,
  errorMessage,
  hasReviewUnits,
  emptyReviewMessage,
  continuityEmpty,
  resumePosition,
  units,
  selectedUnit,
  preparedDiffs,
  diffOptions,
  isMutating,
  mutationError,
  lineCollaboration,
  agentNotes,
  hiddenAgentNoteIds,
  onSetAgentNoteHidden,
  reviewGuide,
  reviewGuideUnits,
  isGuideOpen,
  isGuideRanked,
  isGuideRebuilding,
  onCloseGuide,
  onGuideSelectUnit,
  isFileTreeOpen,
  allFileUnits,
  onSelectAllFile,
  selectedFilePath,
  restoredScrollTop,
  fileNavigationSignal,
  reviewSearch,
  typeDefinitionPaths,
  typeDefinitionInteraction,
  onSelectUnit,
  onSelectFile,
  onScrollTopChange,
  onStartReviewGuide,
  onToggleViewed
}: {
  repoPath: string;
  isLoading: boolean;
  errorMessage?: string;
  hasReviewUnits: boolean;
  emptyReviewMessage: string;
  continuityEmpty?: ReactNode;
  resumePosition?: { chunkId: string; path: string; offset: number };
  units: VisibleReviewUnit[];
  selectedUnit?: VisibleReviewUnit;
  preparedDiffs: ReadonlyMap<string, PreparedReviewDiff>;
  diffOptions: FileDiffOptions<ReviewDiffAnnotation>;
  isMutating: boolean;
  mutationError?: string;
  lineCollaboration?: ReviewLineCollaboration;
  agentNotes: readonly GitAgentNote[];
  hiddenAgentNoteIds: ReadonlySet<string>;
  onSetAgentNoteHidden: (noteId: string, hidden: boolean) => void;
  reviewGuide?: GitReviewGuide;
  reviewGuideUnits: ReadonlyMap<string, GitReviewGuideUnit>;
  isGuideOpen: boolean;
  isGuideRanked: boolean;
  isGuideRebuilding: boolean;
  onCloseGuide: () => void;
  onGuideSelectUnit: (unitId: string) => void;
  isFileTreeOpen: boolean;
  allFileUnits: VisibleReviewUnit[];
  onSelectAllFile: (path: string | undefined) => void;
  selectedFilePath?: string;
  restoredScrollTop?: number;
  fileNavigationSignal: number;
  reviewSearch?: ReviewSearchViewState;
  typeDefinitionPaths: ReadonlySet<string>;
  typeDefinitionInteraction: ReviewTypeDefinitionInteraction;
  onSelectUnit: (unitId: string) => void;
  onSelectFile: (path: string | undefined) => void;
  onScrollTopChange: (unitId: string, scrollTop: number, visiblePath?: string) => void;
  onStartReviewGuide: () => void;
  onToggleViewed: () => void;
}): ReactElement {
  const reviewChunksRef = useRef<HTMLDivElement>(null);
  const [guideLocation, setGuideLocation] = useState<GuideLocation>();
  const [briefTab, setBriefTab] = useState<'summaries' | 'findings'>('summaries');
  const guideFindings = useMemo(() => createReviewGuideFindings(reviewGuide ? allFileUnits : [], lineCollaboration?.threads ?? []), [reviewGuide, allFileUnits, lineCollaboration?.threads]);
  const selectedFindings = guideFindings.get(selectedUnit?.unit.id ?? '') ?? NO_GUIDE_FINDINGS;
  if (guideLocation && (!reviewGuide || guideLocation.unitId !== selectedUnit?.unit.id || reviewSearch?.isSelected)) {
    setGuideLocation(undefined);
  }
  const consumedGuideLocation = useRef<typeof guideLocation>(undefined);
  const renderedLocationRef = useRef<{
    fileNavigationSignal: number;
    filePath?: string;
    unitId?: string;
  }>({ fileNavigationSignal: 0 });
  const [collapsedFileKeys, setCollapsedFileKeys] = useState<ReadonlySet<string>>(() => new Set());
  const agentNotesByPath = useMemo(() => {
    const notesByPath = new Map<string, GitAgentNote[]>();

    for (const note of agentNotes) {
      const notes = notesByPath.get(note.path) ?? [];
      notes.push(note);
      notesByPath.set(note.path, notes);
    }

    return notesByPath;
  }, [agentNotes]);
  const selectedGuideUnit = selectedUnit ? reviewGuideUnits.get(selectedUnit.unit.id) : undefined;

  useLayoutEffect(() => {
    const scroller = reviewChunksRef.current;
    const unitId = selectedUnit?.unit.id;
    const previousLocation = renderedLocationRef.current;
    const unitChanged = unitId !== previousLocation.unitId;
    const fileChanged = selectedFilePath !== previousLocation.filePath;
    const fileNavigationRequested = fileNavigationSignal !== previousLocation.fileNavigationSignal;

    renderedLocationRef.current = {
      fileNavigationSignal,
      filePath: selectedFilePath,
      unitId
    };

    if (
      !scroller ||
      !unitId ||
      (!unitChanged && !fileChanged && !fileNavigationRequested)
    ) {
      return;
    }

    if (unitChanged && restoredScrollTop !== undefined && !fileNavigationRequested) {
      scroller.scrollTo({ top: restoredScrollTop });
      return;
    }

    if (unitChanged) {
      scroller.scrollTo({ top: 0 });
    }

    if (!selectedFilePath) {
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
  }, [fileNavigationSignal, restoredScrollTop, selectedFilePath, selectedUnit?.unit.id]);


  useEffect(() => {
    if (!guideLocation || (!guideLocation.file.line && guideLocation.commentId === undefined) || guideLocation.navigationSignal !== fileNavigationSignal ||
      reviewSearch?.isSelected || consumedGuideLocation.current === guideLocation) return;
    consumedGuideLocation.current = guideLocation;
    const location = guideLocation.file;
    let frame = 0;
    let attempts = 0;
    const locate = (): void => {
      const file = reviewChunksRef.current?.querySelector<HTMLElement>(
        `[data-review-path="${CSS.escape(location.path)}"]`
      );
      const commentSelector = guideLocation.commentId === undefined ? undefined : `[data-review-comment-id="${CSS.escape(String(guideLocation.commentId))}"]`;
      const comment = commentSelector ? file?.querySelector<HTMLElement>(commentSelector) : undefined;
      if (comment) { comment.scrollIntoView({ block: 'center' }); return; }
      for (const diff of file?.querySelectorAll('.gg-diff') ?? []) {
        const shadowComment = commentSelector ? diff.shadowRoot?.querySelector<HTMLElement>(commentSelector) : undefined;
        if (shadowComment) { shadowComment.scrollIntoView({ block: 'center' }); return; }
        // Excerpts may start on unchanged context, so fall back to context rows.
        const line = diff.shadowRoot?.querySelector<HTMLElement>(
          `[data-line="${location.line}"][data-line-type="${location.side === 'left' ? 'change-deletion' : 'change-addition'}"]`
        ) ?? diff.shadowRoot?.querySelector<HTMLElement>(
          `[data-line="${location.line}"]:is([data-line-type="context"], [data-line-type="context-expanded"])`
        );
        if (line) {
          line.scrollIntoView({ block: 'center' });
          return;
        }
      }
      // Diff workers render asynchronously. Retry only for this explicit code jump.
      if (++attempts < 120) frame = requestAnimationFrame(locate);
    };
    frame = requestAnimationFrame(locate);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [guideLocation, fileNavigationSignal, selectedUnit?.unit.id, reviewSearch?.isSelected, reviewGuide?.sourceFingerprint]);

  function selectGuideFile(file: GitReviewGuideFile, commentId?: string | number): void {
    setCollapsedFileKeys((current) => {
      const next = new Set(current);
      for (const item of groupReviewFiles(selectedUnit?.unit.chunks ?? [])) {
        if (item.chunks[0].path === file.path) next.delete(item.chunks[0]!.id);
      }
      return next;
    });
    const locationVisible = selectedUnit?.visibleChunks.some((chunk) => chunk.path === file.path &&
      (file.line === undefined || reviewGuidePatchChangesLine(chunk.patch, file.line, file.side ?? 'right')));
    if (locationVisible) onSelectFile(file.path);
    else onSelectAllFile(file.path);
    // Keep the requested range, rather than replacing it with the file's default entry point.
    setGuideLocation(selectedUnit ? {
      file, commentId, navigationSignal: fileNavigationSignal + 1, unitId: selectedUnit.unit.id
    } : undefined);
  }

  const resumeAttempted = useRef(false);
  useEffect(() => {
    if (resumeAttempted.current || !resumePosition || !selectedUnit || reviewSearch?.isSelected) return;
    const scroller = reviewChunksRef.current;
    const anchor = scroller?.querySelector<HTMLElement>(`[data-review-chunk-id="${CSS.escape(resumePosition.chunkId)}"]`) ??
      scroller?.querySelector<HTMLElement>(`[data-review-path="${CSS.escape(resumePosition.path)}"]`);
    if (!scroller || !anchor) return;
    // Syntax highlighting may finish after React commits. Wait for real code height before restoring.
    const restore = () => {
      if (resumeAttempted.current || anchor.clientHeight === 0) return;
      scroller.scrollTop += anchor.getBoundingClientRect().top - scroller.getBoundingClientRect().top + Math.min(resumePosition.offset, anchor.clientHeight);
      resumeAttempted.current = true;
    };
    const observer = new ResizeObserver(restore);
    observer.observe(anchor);
    const frame = requestAnimationFrame(restore);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [resumePosition, selectedUnit, reviewSearch?.isSelected]);

  function selectGuideFinding(finding: ReviewGuideFinding): void {
    const { comment } = finding;
    selectGuideFile({ path: comment.path, line: comment.line, side: comment.side,
      priority: 'review', reason: 'Review finding' }, comment.id);
  }

  function toggleFile(fileKey: string, chunks: readonly GitReviewChunk[]): void {
    const isCollapsing = !collapsedFileKeys.has(fileKey);

    if (isCollapsing && chunks.some((chunk) => chunk.id === lineCollaboration?.selectedChunkId)) {
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

  let bodyMessage: ReactNode;
  if (isLoading) {
    bodyMessage = (
      <ReviewMessage
        icon={<Loader2 size={16} className="animate-spin" />}
        text="Building contextual review…"
      />
    );
  } else if (errorMessage) {
    bodyMessage = (
      <ReviewMessage icon={<AlertTriangle size={16} />} text={errorMessage} tone="danger" />
    );
  } else if (units.length === 0 && !reviewSearch) {
    bodyMessage = continuityEmpty ?? (hasReviewUnits ? (
      <ReviewMessage
        icon={<SkipForward size={16} />}
        text="All changes are skipped by the current review filters."
      />
    ) : (
      <ReviewMessage icon={<Check size={16} />} text={emptyReviewMessage} />
    ));
  }

  if (bodyMessage) return <>{bodyMessage}</>;

  return (
    <div className="review-layout">
      <nav className="review-queue" aria-label="Context review units">
        {reviewGuide ? <p className="review-ai-layer-overview">{reviewGuide.summary}</p> : null}
        <div className="review-queue-items">
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
                  className="review-unit-title block truncate"
                  title={reviewSearch.query || 'Review search'}
                >
                  Search · {compactReviewSearchQuery(reviewSearch.query)}
                </span>
                <span className="review-unit-meta block truncate">
                  {formatReviewSearchResultCount(reviewSearch.results.locationCount)}
                </span>
              </span>
              <span className="badge-mini">temporary</span>
            </button>
          ) : null}
          {units.map((candidate, index) => {
            const isSelected = !reviewSearch?.isSelected && candidate.unit.id === selectedUnit?.unit.id;
            const title = candidate.unit.title;
            const guideUnit = reviewGuideUnits.get(candidate.unit.id);
            return (
            <div className="review-block-entry" key={candidate.unit.id}>
              <ReviewLayerTooltip enabled={Boolean(reviewGuide)} title={candidate.unit.title} description={candidate.unit.explanation}
                findings={guideFindings.get(candidate.unit.id) ?? NO_GUIDE_FINDINGS}>
              <button
                className="review-unit-row"
                type="button"
                data-active={isSelected}
                disabled={
                  lineCollaboration?.selectedChunkId !== undefined &&
                  candidate.unit.id !== selectedUnit?.unit.id
                }
                onClick={() => { setBriefTab('summaries'); onSelectUnit(candidate.unit.id); }}
              >
                <span className="review-unit-status" data-viewed={candidate.isViewed}>
                  {candidate.isViewed ? <Check size={12} /> : index + 1}
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span
                    className="review-unit-title block truncate"
                    title={reviewGuide ? undefined : candidate.unit.explanation}
                  >
                    {title}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    {guideUnit ? <ReviewGuidePriority priority={guideUnit.priority} /> : null}
                    <span className="review-unit-meta min-w-0 truncate">
                      {candidate.unit.reason}
                    </span>
                  </span>
                </span>
                {reviewGuide ? <ReviewFindingDot findings={guideFindings.get(candidate.unit.id) ?? NO_GUIDE_FINDINGS} /> : null}
                <span className="badge-mini">{candidate.visibleChunks.length}</span>
              </button>
              </ReviewLayerTooltip>
            </div>
            );
          })}
        </div>
      </nav>

      <div className="review-content">
        {bodyMessage ??
          (reviewSearch?.isSelected ? (
            <ReviewSearchPanel
              search={reviewSearch}
              diffOptions={diffOptions}
              typeDefinitionPaths={typeDefinitionPaths}
              typeDefinitionInteraction={typeDefinitionInteraction}
            />
          ) : selectedUnit ? (
            <>
              {(
                <header className="review-unit-header">
                  <div className="review-unit-heading">
                    <h2 title={selectedUnit.unit.title}>{selectedUnit.unit.title}</h2>
                    {selectedGuideUnit ? (
                      <ReviewGuidePriority priority={selectedGuideUnit.priority} />
                    ) : null}
                    <span className="badge-mini shrink-0" title="Grouping confidence">
                      {selectedUnit.unit.confidence}
                    </span>
                    <span
                      className="review-unit-summary"
                      title={`${selectedUnit.unit.reason} · ${selectedUnit.unit.explanation}${selectedUnit.skippedCount > 0 ? ` · ${selectedUnit.skippedCount} skipped by filters` : ''}`}
                    >
                      {selectedUnit.unit.reason}
                      {` · ${selectedUnit.unit.explanation}`}
                      {selectedUnit.skippedCount > 0
                        ? ` · ${selectedUnit.skippedCount} skipped by filters`
                        : ''}
                    </span>
                  </div>
                  <button
                    className={
                      selectedUnit.isViewed ? 'btn-subtle btn-compact' : 'btn-primary btn-compact'
                    }
                    type="button"
                    disabled={isMutating || lineCollaboration?.selectedChunkId !== undefined}
                    onClick={onToggleViewed}
                  >
                    {isMutating ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : selectedUnit.isViewed ? (
                      <X size={14} />
                    ) : (
                      <CheckCheck size={14} />
                    )}
                    {selectedUnit.isViewed ? 'Mark unviewed' : 'Viewed'}
                  </button>
                </header>
              )}
              {mutationError ? (
                <p className="border-b border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-2 text-xs text-[var(--danger-text)]">
                  {mutationError}
                </p>
              ) : null}
              <div
                ref={reviewChunksRef}
                className="review-chunks"
                onScroll={(event) => {
                  const scroller = event.currentTarget;
                  onScrollTopChange(selectedUnit.unit.id, scroller.scrollTop);
                }}
              >
                {(isGuideRanked
                  ? [{ key: 'other' as const, label: 'Ranked files', files: groupReviewFiles(selectedUnit.visibleChunks) }]
                  : createReviewSections(selectedUnit.visibleChunks)).map(
                  (section, _sectionIndex, sections) => (
                    <section
                      className="review-chunk-section"
                      data-only={sections.length === 1}
                      key={section.key}
                    >
                      {sections.length > 1 ? (
                        <div className="review-section-header">
                          <span>{section.label}</span>
                          <span>{section.files.length}</span>
                        </div>
                      ) : null}
                      {section.files.map((file) => (
                        <ReviewFile
                          key={file.chunks[0]!.id}
                          file={file}
                          preparedDiffs={preparedDiffs}
                          diffOptions={diffOptions}
                          lineCollaboration={lineCollaboration}
                          agentNotes={agentNotesByPath.get(file.chunks[0]!.path) ?? []}
                          guideNotes={selectedGuideUnit?.summaries ? NO_GUIDE_NOTES : selectedGuideUnit?.inlineNotes ?? NO_GUIDE_NOTES}
                          guideFile={selectedGuideUnit?.files.find((item) => item.path === file.chunks[0].path)}
                          guideSide={guideLocation?.file.side}
                          guideEndLine={guideLocation?.file.endLine}
                          guideLine={guideLocation?.navigationSignal === fileNavigationSignal &&
                            guideLocation.file.path === selectedFilePath &&
                            guideLocation.file.path === file.chunks[0].path ? guideLocation.file.line : undefined}
                          hiddenAgentNoteIds={hiddenAgentNoteIds}
                          onSetAgentNoteHidden={onSetAgentNoteHidden}
                          typeDefinitionPaths={typeDefinitionPaths}
                          typeDefinitionInteraction={typeDefinitionInteraction}
                          isCollapsed={collapsedFileKeys.has(file.chunks[0]!.id)}
                          onToggleCollapsed={() => toggleFile(file.chunks[0]!.id, file.chunks)}
                        />
                      ))}
                    </section>
                  )
                )}
              </div>
            </>
          ) : null)}
      </div>

      {reviewGuide && isGuideOpen && !reviewSearch?.isSelected ? (
        <ReviewGuidePanel repoPath={repoPath} key={reviewGuide.generatedAt} guide={reviewGuide} units={units} selectedUnit={selectedUnit}
          findings={selectedFindings} tab={briefTab} onTabChange={setBriefTab} onSelectFinding={selectGuideFinding}
          rebuilding={isGuideRebuilding} disabled={Boolean(lineCollaboration?.selectedChunkId) || isMutating}
          onSelectUnit={onGuideSelectUnit} onSelectFile={selectGuideFile}
          onClose={onCloseGuide} onRebuild={onStartReviewGuide} />
      ) : null}

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
  filesWording = false,
  diffOptions,
  typeDefinitionPaths,
  typeDefinitionInteraction
}: {
  search: ReviewSearchViewState;
  // The pull-request layout has files, not blocks: no "temporary block", and results sit under their file.
  filesWording?: boolean;
  diffOptions: FileDiffOptions<ReviewDiffAnnotation>;
  typeDefinitionPaths: ReadonlySet<string>;
  typeDefinitionInteraction: ReviewTypeDefinitionInteraction;
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
          {filesWording ? null : <span className="badge-mini review-search-temporary-badge">temporary block</span>}
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
            <ChevronUp size={14} />
          </button>
          <button
            className="review-search-nav-button"
            type="button"
            disabled={search.results.locationCount === 0}
            aria-label="Next review search result"
            title="Next result (Enter)"
            onClick={() => navigate(1)}
          >
            <ChevronDown size={14} />
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
              <option value="visible-blocks">{filesWording ? 'Visible files' : 'Visible blocks'}</option>
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
                  {filesWording ? null : (
                    <>
                      <span title={file.ownerUnitTitle}>{file.ownerUnitTitle}</span>
                      <span title={file.relationship}>{file.relationship}</span>
                    </>
                  )}
                  {file.isFiltered ? <span className="badge-mini">filtered</span> : null}
                  {file.usedChangedLinesFallback
                    ? <span className="badge-mini">changed lines</span>
                    : null}
                  <span>{formatReviewSearchResultCount(file.locations.length)}</span>
                </div>
                <ReviewFile
                  file={{
                    key: file.id,
                    chunks: [file.chunk],
                    additions: file.chunk.additions,
                    deletions: file.chunk.deletions
                  }}
                  preparedDiffs={search.preparedDiffs}
                  diffOptions={diffOptions}
                  agentNotes={NO_AGENT_NOTES}
                  hiddenAgentNoteIds={NO_HIDDEN_AGENT_NOTE_IDS}
                  onSetAgentNoteHidden={ignoreAgentNoteHiddenChange}
                  typeDefinitionPaths={typeDefinitionPaths}
                  typeDefinitionInteraction={typeDefinitionInteraction}
                  isCollapsed={collapsedChunkIds.has(file.chunk.id)}
                  searchHighlightsByChunk={new Map([[file.chunk.id, matchedLines]])}
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

function isFindShortcut(event: Pick<globalThis.KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f';
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
