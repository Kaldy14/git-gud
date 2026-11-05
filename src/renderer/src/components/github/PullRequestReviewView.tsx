import { BugFinderButton } from './BugFinderButton';
import { BugFinderView } from './BugFinderView';
import type { CSSProperties, FormEvent, ReactElement, UIEvent } from 'react';
import { useId, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDownUp,
  Bot,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Copy,
  CornerDownRight,
  ExternalLink,
  FileText,
  FolderTree,
  GitCommitHorizontal,
  GitMerge,
  Link2,
  Loader2,
  MessageSquare,
  Send,
  ShieldCheck,
  Trash2,
  Users,
  X
} from 'lucide-react';

import { PullRequestPanel } from './PullRequestPanel';
import { PullRequestMergeChecklist } from './PullRequestMergeChecklist';
import { pullRequestMergeBlockers } from './pullRequestMergeBlockers';
import { getReviewImages } from '@renderer/components/review/reviewImages';
import type { DiffStyle } from '@renderer/components/commit/fileDetailUtils';
import { ReviewCommentBody } from '@renderer/components/review/ReviewCommentBody';
import {
  ReviewImageGalleryDialog,
  type ReviewImageGallerySelection
} from '@renderer/components/review/ReviewImageGalleryDialog';
import {
  ReviewView,
  type ReviewFileCommentInput,
  type ReviewLineComment,
  type ReviewLineCommentInput,
  type ReviewInlineGuideNote,
  type ReviewLineReplyInput
} from '@renderer/components/review/ReviewView';
import {
  loadReviewFileTreeOpen,
  loadReviewFileTreeWidth
} from '@renderer/components/review/reviewFileTree';
import {
  gitHubPullRequestDetailQueryKey,
  gitHubPullRequestInboxQueryKey,
  refreshGitHubPullRequestInboxAfterMerge,
  useGitHubPullRequestInbox,
  useGitHubPullRequestDetail,
  useGitHubPullRequestReviewPlan
} from '@renderer/queries/github';
import type {
  DiffSyntaxTheme,
  GitHubPullRequestConflictDetails,
  GitHubPullRequestLocator,
  GitHubPullRequestDetail,
  GitHubPullRequestDraftFileComment,
  GitHubPullRequestDraftLineComment,
  GitHubPullRequestDraftReply,
  GitHubPullRequestMergeMethod,
  GitHubPullRequestReviewInput,
  GitHubPullRequestSummary
} from '@shared/types';

import { PullRequestReviewerPicker } from './PullRequestReviewerPicker';
import { PullRequestRefreshControl } from './PullRequestRefreshControl';
import { PullRequestGitHubLink } from './PullRequestGitHubLink';
import { PullRequestHeaderActions } from './PullRequestHeaderActions';
import { copyPullRequestCodexPrompt } from './pullRequestCodexPrompt';
import { PullRequestGuideTab } from './guide/PullRequestGuideTab';
import { pullRequestLocator, pullRequestTourQueryKey } from './guide/pullRequestTourQuery';
import { letterTourNotes } from '@shared/pullRequestTour';
import type { GuideCodeLocation } from './guide/GuideExcerpt';
import { PullRequestAvatar, PullRequestDetailHeader, PullRequestDetailTabs, PullRequestMetaRow, PullRequestSection } from './PullRequestDetailTabs';
import {
  loadPullRequestDetailTab,
  pullRequestDetailPanelProps,
  PULL_REQUEST_DETAIL_TAB_KEY,
  type PullRequestDetailTab
} from './pullRequestDetailTab';
import {
  hasPullRequestMergeConflicts,
  pullRequestChecksTone,
  pullRequestStatus
} from './pullRequestInboxStatus';
import { retainUnsubmittedOrFailedDrafts } from './pullRequestReviewDrafts';
import { isReviewSummaryRequired } from './pullRequestReviewSubmission';
import { copyGitGudPullRequestLink } from './pullRequestLinkClipboard';
import {
  buildPullRequestTimeline,
  groupPullRequestActivity,
  type PullRequestReviewThread,
  type PullRequestTimelineEntry
} from './pullRequestTimeline';

type PullRequestReviewViewProps = {
  pullRequest: GitHubPullRequestSummary;
  codexRepoPath?: string;
  initialGuideOpen?: boolean;
  initialBugFinderOpen?: boolean;
  diffStyle: DiffStyle;
  diffSyntaxTheme: DiffSyntaxTheme;
  onSetDiffStyle: (style: DiffStyle) => void;
  onBackToInbox: () => void;
  onOpenCommit?: (sha: string) => void;
  onClose: () => void;
  onMerged: () => void;
};

type ReviewEvent = GitHubPullRequestReviewInput['event'];

type ActivityPreferences = { order: 'newest' | 'oldest'; hideBots: boolean };
const ACTIVITY_PREFERENCES_KEY = 'git-gud:pr-activity:v1';

// Newest first, as in T3 Code, so a just-posted comment appears under the composer.
function loadActivityPreferences(storage: Pick<Storage, 'getItem'>): ActivityPreferences {
  try {
    const stored = JSON.parse(storage.getItem(ACTIVITY_PREFERENCES_KEY) ?? 'null') as Partial<ActivityPreferences> | null;
    return { order: stored?.order === 'oldest' ? 'oldest' : 'newest', hideBots: stored?.hideBots === true };
  } catch {
    return { order: 'newest', hideBots: false };
  }
}

type PullRequestReviewDraft =
  | (GitHubPullRequestDraftLineComment & {
      kind: 'line';
      createdAt: string;
    })
  | (GitHubPullRequestDraftFileComment & {
      kind: 'file';
      createdAt: string;
    })
  | (GitHubPullRequestDraftReply & {
      kind: 'reply';
      createdAt: string;
    });

export function PullRequestReviewView({
  pullRequest,
  codexRepoPath,
  initialGuideOpen,
  initialBugFinderOpen,
  diffStyle,
  diffSyntaxTheme,
  onSetDiffStyle,
  onBackToInbox,
  onOpenCommit,
  onClose,
  onMerged
}: PullRequestReviewViewProps): ReactElement {
  const locator = {
    profileId: pullRequest.profileId,
    owner: pullRequest.owner,
    repository: pullRequest.repository,
    number: pullRequest.number
  };
  const detailQuery = useGitHubPullRequestDetail(locator);
  const inboxQuery = useGitHubPullRequestInbox(locator.profileId, 'interactive');
  const livePullRequest = inboxQuery.data?.pullRequests.find(
    (candidate) =>
      candidate.owner === locator.owner &&
      candidate.repository === locator.repository &&
      candidate.number === locator.number
  ) ?? pullRequest;
  const initialDetail = detailQuery.data;
  const reviewPlanQuery = useGitHubPullRequestReviewPlan(locator, initialDetail?.headSha);
  const detail = useMemo(
    () => {
      if (!initialDetail) {
        return undefined;
      }

      return {
        ...initialDetail,
        ...livePullRequest,
        reviewPlan: reviewPlanQuery.data ?? initialDetail.reviewPlan
      };
    },
    [initialDetail, livePullRequest, reviewPlanQuery.data]
  );
  const hasNewActivity = Boolean(
    initialDetail && Date.parse(livePullRequest.updatedAt) > Date.parse(initialDetail.updatedAt)
  );

  const refreshPullRequest = (): void => {
    void Promise.all([inboxQuery.refetch(), detailQuery.refetch()]);
  };

  if (detailQuery.isLoading && !detail) {
    return (
      <PullRequestReviewLoading
        pullRequest={pullRequest}
        tab={initialGuideOpen ? 'guide' : initialBugFinderOpen ? 'code' : loadPullRequestDetailTab(window.localStorage)}
        onAction={onBackToInbox}
        onClose={onClose}
      />
    );
  }

  if (detailQuery.error && !detail) {
    return (
      <ReviewMessage
        icon={<AlertTriangle size={18} />}
        text={detailQuery.error instanceof Error ? detailQuery.error.message : 'Could not load the pull request.'}
        tone="danger"
        actionLabel="Back to pull requests"
        onAction={onBackToInbox}
        closeLabel="Return to commit graph"
        onClose={onClose}
      />
    );
  }

  if (!detail) {
    return (
      <ReviewMessage
        icon={<AlertTriangle size={18} />}
        text="The pull request is unavailable."
        tone="danger"
        actionLabel="Back to pull requests"
        onAction={onBackToInbox}
        closeLabel="Return to commit graph"
        onClose={onClose}
      />
    );
  }

  return (
    <PullRequestReviewContent
      key={detail.reviewPlan.targetKey}
      detail={detail}
      codexRepoPath={codexRepoPath}
      initialGuideOpen={initialGuideOpen}
      initialBugFinderOpen={initialBugFinderOpen}
      diffStyle={diffStyle}
      diffSyntaxTheme={diffSyntaxTheme}
      onSetDiffStyle={onSetDiffStyle}
      onBackToInbox={onBackToInbox}
      onOpenCommit={onOpenCommit}
      onClose={onClose}
      onMerged={onMerged}
      isReviewPlanEnriching={reviewPlanQuery.isFetching && !reviewPlanQuery.data}
      isRefreshing={
        inboxQuery.isFetching ||
        (detailQuery.isFetching && !detailQuery.isLoading)
      }
      hasNewActivity={hasNewActivity}
      refreshErrorMessage={
        inboxQuery.error instanceof Error
          ? inboxQuery.error.message
          : detailQuery.error instanceof Error
            ? detailQuery.error.message
            : undefined
      }
      lastRefreshedAt={inboxQuery.data?.loadedAt ?? detail.loadedAt}
      onRefresh={refreshPullRequest}
    />
  );
}

function PullRequestReviewLoading({
  pullRequest,
  tab,
  onAction,
  onClose
}: {
  pullRequest: GitHubPullRequestSummary;
  tab: PullRequestDetailTab;
  onAction: () => void;
  onClose: () => void;
}): ReactElement {
  const reviewRepoPath = `github://${new URL(pullRequest.url).host}/${pullRequest.owner}/${pullRequest.repository}`;
  const isFileTreeOpen = loadReviewFileTreeOpen(window.localStorage, reviewRepoPath);
  const fileTreeWidth = loadReviewFileTreeWidth(window.localStorage, reviewRepoPath);
  const fileTreeStyle: CSSProperties & Record<'--review-file-tree-width', string> = {
    '--review-file-tree-width': `${fileTreeWidth}px`
  };

  return (
    <section
      className="pr-review-view pr-review-loading"
      aria-label={`Loading review for ${pullRequest.title}`}
      aria-busy="true"
    >
      <PullRequestDetailHeader
        pullRequest={pullRequest}
        status={<ReviewStatus detail={pullRequest} />}
        onBack={onAction}
        actions={
          <>
            <span className="pr-review-loading-progress" role="status" aria-live="polite">
              <Loader2 size={12} className="animate-spin" />
              Preparing review
            </span>
            <PullRequestGitHubLink url={pullRequest.url} />
            <button
              className="icon-btn icon-btn-regular shrink-0"
              type="button"
              onClick={onClose}
              aria-label="Close pull request review and return to commit graph"
              title="Return to commit graph"
            >
              <X size={14} />
            </button>
          </>
        }
      />

      {/* Match the loaded layout: the same tab strip, and a skeleton shaped like the remembered tab. */}
      <PullRequestDetailTabs value={tab} onChange={() => undefined} counts={{}} disabled />
      {tab !== 'code' ? (
        <div className="pr-review-loading-summary" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => (
            <span key={index}><b className="pr-review-skeleton" /><i className="pr-review-skeleton" /></span>
          ))}
          <p>
            {Array.from({ length: 6 }, (_, index) => <b className="pr-review-skeleton" key={index} />)}
          </p>
        </div>
      ) : <div className="review-view pr-review-loading-workspace" aria-hidden="true">
        <div className="review-toolbar pr-review-loading-toolbar">
          <span className="pr-review-skeleton pr-review-skeleton-branch" />
          <span className="pr-review-skeleton pr-review-skeleton-control" />
          <span className="pr-review-skeleton pr-review-skeleton-progress" />
          <span className="pr-review-skeleton pr-review-skeleton-actions" />
        </div>
        <div className="review-layout pr-review-loading-layout">
          <div className="review-queue pr-review-loading-queue">
            {Array.from({ length: 6 }, (_, index) => (
              <span
                className="review-unit-row pr-review-loading-queue-row"
                data-active={index === 0}
                key={index}
              >
                <i />
                <span>
                  <b className="pr-review-skeleton" />
                  <small className="pr-review-skeleton" />
                </span>
              </span>
            ))}
          </div>
          <div className="review-content pr-review-loading-diff">
            <div className="review-unit-header pr-review-loading-diff-heading">
              <span>
                <b className="pr-review-skeleton" />
                <small className="pr-review-skeleton" />
              </span>
              <i className="pr-review-skeleton" />
            </div>
            <div className="review-chunk-header pr-review-loading-file-heading">
              <span className="pr-review-skeleton" />
              <span className="pr-review-skeleton" />
            </div>
            <div className="pr-review-loading-code">
              {Array.from({ length: 14 }, (_, index) => (
                <span key={index}>
                  <i />
                  <b className="pr-review-skeleton" />
                </span>
              ))}
            </div>
          </div>
          {isFileTreeOpen ? (
            <aside
              className="review-file-tree-panel pr-review-loading-file-tree"
              style={fileTreeStyle}
            >
              <header>
                <span>
                  <FolderTree size={13} />
                  Files
                </span>
                <span className="pr-review-skeleton pr-review-skeleton-file-count" />
              </header>
              <div className="review-file-tree-body pr-review-loading-file-tree-body">
                {Array.from({ length: 9 }, (_, index) => (
                  <span
                    className="pr-review-skeleton"
                    data-depth={index % 4}
                    key={index}
                  />
                ))}
              </div>
            </aside>
          ) : null}
        </div>
      </div>}
    </section>
  );
}

function PullRequestReviewContent({
  detail,
  codexRepoPath,
  initialGuideOpen,
  initialBugFinderOpen,
  diffStyle,
  diffSyntaxTheme,
  onSetDiffStyle,
  onBackToInbox,
  onOpenCommit,
  onClose,
  onMerged,
  isReviewPlanEnriching,
  isRefreshing,
  hasNewActivity,
  refreshErrorMessage,
  lastRefreshedAt,
  onRefresh
}: {
  detail: GitHubPullRequestDetail;
  codexRepoPath?: string;
  initialGuideOpen?: boolean;
  initialBugFinderOpen?: boolean;
  diffStyle: DiffStyle;
  diffSyntaxTheme: DiffSyntaxTheme;
  onSetDiffStyle: (style: DiffStyle) => void;
  onBackToInbox: () => void;
  onOpenCommit?: (sha: string) => void;
  onClose: () => void;
  onMerged: () => void;
  isReviewPlanEnriching: boolean;
  isRefreshing: boolean;
  hasNewActivity: boolean;
  refreshErrorMessage?: string;
  lastRefreshedAt: string;
  onRefresh: () => void;
}): ReactElement {
  const [bugFinderOpen, setBugFinderOpen] = useState(initialBugFinderOpen ?? false);
  const locator = {
    profileId: detail.profileId,
    owner: detail.owner,
    repository: detail.repository,
    number: detail.number
  };
  // The Guide is the pull request's one AI story: its notes also appear inline in Code, each
  // linking back to its stop. A guide written for an older head is not mapped onto new lines.
  const [guideStopRequest, setGuideStopRequest] = useState<{ index: number; signal: number }>();
  const tourQuery = useQuery({
    queryKey: pullRequestTourQueryKey(detail),
    queryFn: () => window.api.getGitHubPullRequestTourState(pullRequestLocator(detail))
  });
  const currentTour = tourQuery.data?.tour?.headSha === detail.headSha ? tourQuery.data.tour : undefined;
  const guideReferences = useMemo<ReviewInlineGuideNote[]>(() => currentTour?.stops.flatMap((stop, index) =>
    letterTourNotes(stop).flatMap(({ marker, note }) => {
      // Code annotations sit on new-side lines; notes on removed code stay in the Guide.
      const onNewSide = stop.excerpts.some((excerpt) => excerpt.side === 'new' && excerpt.path === note.path &&
        note.line >= excerpt.start && note.line <= excerpt.end);
      return onNewSide ? [{
        path: note.path,
        line: note.line,
        body: note.body,
        marker,
        title: note.title.replace(/`([^`]+)`/gu, '$1'),
        stopLabel: `Stop ${index + 1} in Guide`,
        onOpen: () => {
          setDetailTab('guide');
          setGuideStopRequest((current) => ({ index, signal: (current?.signal ?? 0) + 1 }));
        }
      }] : [];
    })
  ) ?? [], [currentTour]);
  const queryClient = useQueryClient();
  const draftStorageKey = `git-gud:pr-review-drafts:${detail.reviewPlan.targetKey}`;
  const [reviewDrafts, setReviewDrafts] = useState<PullRequestReviewDraft[]>(() =>
    loadPullRequestReviewDrafts(window.localStorage, draftStorageKey)
  );
  const [detailTab, setDetailTab] = useState<PullRequestDetailTab>(() =>
    initialGuideOpen ? 'guide' : initialBugFinderOpen ? 'code' : loadPullRequestDetailTab(window.localStorage)
  );
  const [codeNavigation, setCodeNavigation] = useState<GuideCodeLocation & { signal: number }>();
  // Set while Code shows a location opened from the Guide, to offer a way back.
  const [cameFromGuide, setCameFromGuide] = useState(false);
  // Scrolling a pane past the title condenses the header, as in T3 Code. Hidden panes keep their
  // scroll position, so the state is remembered per tab.
  const [condensedTabs, setCondensedTabs] = useState<Partial<Record<PullRequestDetailTab, boolean>>>({});
  function trackPaneScroll(event: UIEvent<HTMLDivElement>): void {
    const target = event.target;
    // Horizontal code scrollers report scrollTop 0; only vertical scrollers count.
    if (!(target instanceof HTMLElement) || target.scrollHeight <= target.clientHeight) return;
    // Hysteresis keeps the header from flickering around the threshold.
    const condensed = target.scrollTop > 48 ? true : target.scrollTop <= 4 ? false : undefined;
    if (condensed === undefined || (condensedTabs[detailTab] ?? false) === condensed) return;
    setCondensedTabs((current) => ({ ...current, [detailTab]: condensed }));
  }
  const [activityPreferences, setActivityPreferencesState] = useState(() => loadActivityPreferences(window.localStorage));
  function setActivityPreferences(next: ActivityPreferences): void {
    setActivityPreferencesState(next);
    try { window.localStorage.setItem(ACTIVITY_PREFERENCES_KEY, JSON.stringify(next)); } catch { /* a remembered view is a convenience */ }
  }
  const allFilesStorageKey = `git-gud:pr-all-files-open:v1:${encodeURIComponent(detail.reviewPlan.repoPath)}`;
  const [isAllFilesOpen, setIsAllFilesOpen] = useState(() => window.localStorage.getItem(allFilesStorageKey) === 'true');
  const [isCommentOpen, setIsCommentOpen] = useState(false);
  const [reviewEvent, setReviewEvent] = useState<ReviewEvent>('comment');
  const [reviewSubmissionKey, setReviewSubmissionKey] = useState(0);
  const panelTitleId = useId();
  const [isConflictPanelOpen, setIsConflictPanelOpen] = useState(false);
  const [isReviewDialogOpen, setIsReviewDialogOpen] = useState(false);
  const [isMergeDialogOpen, setIsMergeDialogOpen] = useState(false);
  const [imageGallery, setImageGallery] = useState<ReviewImageGallerySelection>();
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; message: string }>();

  function copyGitGudLink(): void {
    void copyGitGudPullRequestLink(detail.url, navigator.clipboard)
      .then(() => {
        setNotice({ tone: 'success', message: 'Git Gud link copied.' });
      })
      .catch(() => {
        setNotice({
          tone: 'danger',
          message: 'The Git Gud link could not be copied.'
        });
      });
  }

  function setAllFilesOpen(open: boolean): void {
    setIsAllFilesOpen(open);
    window.localStorage.setItem(allFilesStorageKey, String(open));
  }

  function openPanel(panel: 'review' | 'merge' | 'files'): void {
    if (panel === 'files') selectDetailTab('code');
    setAllFilesOpen(panel === 'files');
    setIsReviewDialogOpen(panel === 'review');
    setIsMergeDialogOpen(panel === 'merge');
  }

  function selectDetailTab(tab: PullRequestDetailTab): void {
    setDetailTab(tab);
    setCameFromGuide(false);
    try { window.localStorage.setItem(PULL_REQUEST_DETAIL_TAB_KEY, tab); } catch { /* remembered tab is a convenience */ }
    // GitHub image URLs expire; reload them before showing the description again.
    if (
      tab === 'summary' &&
      Object.keys(detail.bodyImageUrls ?? {}).length > 0 &&
      Date.now() - Date.parse(detail.loadedAt) >= 4 * 60 * 1_000
    ) {
      onRefresh();
    }
  }

  function openFileInCode(location: GuideCodeLocation): void {
    selectDetailTab('code');
    setCameFromGuide(true);
    setCodeNavigation((current) => ({ ...location, signal: (current?.signal ?? 0) + 1 }));
  }

  function toggleConflicts(): void {
    if (detailTab !== 'summary') {
      selectDetailTab('summary');
      setIsConflictPanelOpen(true);
      return;
    }

    setIsConflictPanelOpen((current) => !current);
  }

  const hasMergeConflicts = hasPullRequestMergeConflicts(detail);
  const mergeBlockers = pullRequestMergeBlockers(detail);
  // Code opens folded so the diff gets the height; the status then rides beside the tabs.
  const isHeaderCondensed = !bugFinderOpen && (detailTab === 'code' || condensedTabs[detailTab] === true);
  const condensedStatus = isHeaderCondensed ? (
    <span className="pr-detail-status pr-tabs-status">
      <ReviewStatus detail={detail} onToggleConflicts={toggleConflicts} />
    </span>
  ) : null;
  const conflictDetailsQuery = useQuery({
    queryKey: [
      'github-pull-request-conflicts',
      codexRepoPath ?? 'unavailable',
      detail.baseRefSha,
      detail.headSha
    ],
    queryFn: async (): Promise<GitHubPullRequestConflictDetails> => {
      if (!codexRepoPath) {
        throw new Error('No matching local checkout is open.');
      }

      return window.api.getGitHubPullRequestConflicts(codexRepoPath, {
        baseSha: detail.baseRefSha,
        headSha: detail.headSha
      });
    },
    enabled: hasMergeConflicts && detailTab === 'summary' && Boolean(codexRepoPath),
    staleTime: 15_000
  });
  const timeline = useMemo(
    () =>
      buildPullRequestTimeline({
        commits: detail.commitTimeline,
        conversationComments: detail.conversationComments,
        reviews: detail.reviews,
        reviewComments: detail.reviewComments
      }),
    [detail.commitTimeline, detail.conversationComments, detail.reviewComments, detail.reviews]
  );
  const displayedLineComments = useMemo<ReviewLineComment[]>(() => {
    const publishedComments: ReviewLineComment[] = detail.reviewComments.map((comment) => ({
      ...comment,
      authorAvatarUrl: comment.authorAvatarUrl,
      canEdit: comment.author === detail.viewerLogin
    }));
    const commentById = new Map(detail.reviewComments.map((comment) => [comment.id, comment]));
    const draftComments = reviewDrafts.flatMap<ReviewLineComment>((draft) => {
      if (draft.kind === 'line') {
        return [
          {
            id: draft.id,
            body: draft.body,
            author: detail.viewerLogin,
            createdAt: draft.createdAt,
            path: draft.path,
            subjectType: 'line',
            line: draft.line,
            side: draft.side,
            isDraft: true
          }
        ];
      }

      if (draft.kind === 'file') {
        return [
          {
            id: draft.id,
            body: draft.body,
            author: detail.viewerLogin,
            createdAt: draft.createdAt,
            path: draft.path,
            subjectType: 'file',
            isDraft: true
          }
        ];
      }

      const parent = commentById.get(draft.inReplyToId);
      if (!parent) {
        return [];
      }
      return [
        {
          id: draft.id,
          body: draft.body,
          author: detail.viewerLogin,
          createdAt: draft.createdAt,
          path: parent.path,
          subjectType: parent.subjectType,
          line: parent.line,
          side: parent.side,
          inReplyToId: draft.inReplyToId,
          isDraft: true
        }
      ];
    });

    return [...publishedComments, ...draftComments];
  }, [detail.reviewComments, detail.viewerLogin, reviewDrafts]);

  function updateReviewDrafts(
    updater: (current: PullRequestReviewDraft[]) => PullRequestReviewDraft[]
  ): void {
    setReviewDrafts((current) => {
      const next = updater(current);
      savePullRequestReviewDrafts(window.localStorage, draftStorageKey, next);
      return next;
    });
  }

  const refreshPullRequest = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: gitHubPullRequestDetailQueryKey(locator) }),
      queryClient.invalidateQueries({ queryKey: gitHubPullRequestInboxQueryKey(locator.profileId) })
    ]);
  };
  const reviewMutation = useMutation({
    mutationFn: ({ input }: { input: GitHubPullRequestReviewInput; submittedDraftIds: string[] }) =>
      window.api.submitGitHubPullRequestReview(input),
    onSuccess: async (result, { submittedDraftIds }) => {
      const failedDraftIds = new Set(result.failedDraftIds ?? []);
      const submittedDraftIdSet = new Set(submittedDraftIds);
      updateReviewDrafts((current) =>
        retainUnsubmittedOrFailedDrafts(current, submittedDraftIdSet, failedDraftIds)
      );
      setNotice({
        tone: failedDraftIds.size > 0 ? 'danger' : 'success',
        message: result.message
      });
      setIsReviewDialogOpen(false);
      setReviewSubmissionKey((key) => key + 1);
      await refreshPullRequest();
    },
    onError: (error) => {
      setNotice({
        tone: 'danger',
        message: error instanceof Error ? error.message : 'Could not submit the review.'
      });
    }
  });
  const updateCommentMutation = useMutation({
    mutationFn: ({ commentId, body }: { commentId: number; body: string }) =>
      window.api.updateGitHubPullRequestReviewComment({ ...locator, commentId, body }),
    onSuccess: async (result) => {
      setNotice({ tone: 'success', message: result.message });
      await queryClient.invalidateQueries({ queryKey: gitHubPullRequestDetailQueryKey(locator) });
    }
  });
  const copyPromptMutation = useMutation({
    mutationFn: (summary: string) =>
      copyPullRequestCodexPrompt(detail, reviewDrafts, summary, navigator.clipboard),
    onSuccess: () => {
      setNotice({
        tone: 'success',
        message:
          'Review prompt copied. Your draft comments are still local and were not posted to GitHub.'
      });
      setIsReviewDialogOpen(false);
    }
  });
  const markReadyMutation = useMutation({
    mutationFn: () => window.api.markGitHubPullRequestReady(locator),
    onSuccess: async (result) => {
      setNotice({ tone: 'success', message: result.message });
      onRefresh();
    },
    onError: (error) => {
      setNotice({ tone: 'danger', message: error instanceof Error ? error.message : 'Could not mark the pull request ready for review.' });
    }
  });
  const mergeMutation = useMutation({
    mutationFn: (method: GitHubPullRequestMergeMethod) => {
      if (hasMergeConflicts) {
        throw new Error('Resolve merge conflicts before merging this pull request.');
      }

      return window.api.mergeGitHubPullRequest({ ...locator, method });
    },
    onSuccess: async (result) => {
      setNotice({ tone: 'success', message: result.message });
      onMerged();
      await refreshGitHubPullRequestInboxAfterMerge(queryClient, locator);
    },
    onError: (error) => {
      setNotice({
        tone: 'danger',
        message: error instanceof Error ? error.message : 'Could not merge the pull request.'
      });
    }
  });

  async function addDraftLineComment(input: ReviewLineCommentInput): Promise<void> {
    updateReviewDrafts((current) => [
      ...current,
      {
        id: window.crypto.randomUUID(),
        kind: 'line',
        createdAt: new Date().toISOString(),
        ...input
      }
    ]);
    setNotice({
      tone: 'success',
      message: 'Comment added to your local review draft.'
    });
  }

  async function addDraftFileComment(input: ReviewFileCommentInput): Promise<void> {
    updateReviewDrafts((current) => [
      ...current,
      {
        id: window.crypto.randomUUID(),
        kind: 'file',
        createdAt: new Date().toISOString(),
        ...input
      }
    ]);
    setNotice({
      tone: 'success',
      message: 'File comment added to your local review draft.'
    });
  }

  async function updateComment(commentId: number, body: string): Promise<void> {
    await updateCommentMutation.mutateAsync({ commentId, body });
  }

  async function addDraftReply(input: ReviewLineReplyInput): Promise<void> {
    const parent = detail.reviewComments.find(
      (comment) => comment.id === input.inReplyToId && comment.inReplyToId === undefined
    );
    if (!parent) {
      throw new Error('The comment thread is no longer available.');
    }

    updateReviewDrafts((current) => [
      ...current,
      {
        id: window.crypto.randomUUID(),
        kind: 'reply',
        createdAt: new Date().toISOString(),
        ...input
      }
    ]);
    setNotice({
      tone: 'success',
      message: `Reply to ${parent.author} added to your local review draft.`
    });
  }

  function updateDraft(id: string, body: string): void {
    updateReviewDrafts((current) =>
      current.map((draft) => draft.id === id ? { ...draft, body } : draft)
    );
  }

  function removeDraft(id: string): void {
    updateReviewDrafts((current) => current.filter((draft) => draft.id !== id));
  }

  function submitReview(event: ReviewEvent, body: string): void {
    reviewMutation.mutate({
      submittedDraftIds: reviewDrafts.map((draft) => draft.id),
      input: {
        ...locator,
        event,
        body,
        commitId: detail.headSha,
        comments: reviewDrafts
          .filter(
            (draft): draft is Extract<PullRequestReviewDraft, { kind: 'line' }> =>
              draft.kind === 'line'
          )
          .map((draft) => ({
            id: draft.id,
            body: draft.body,
            path: draft.path,
            line: draft.line,
            side: draft.side,
            startLine: draft.startLine,
            startSide: draft.startSide
          })),
        fileComments: reviewDrafts
          .filter(
            (draft): draft is Extract<PullRequestReviewDraft, { kind: 'file' }> =>
              draft.kind === 'file'
          )
          .map((draft) => ({
            id: draft.id,
            body: draft.body,
            path: draft.path
          })),
        replies: reviewDrafts
          .filter(
            (draft): draft is Extract<PullRequestReviewDraft, { kind: 'reply' }> =>
              draft.kind === 'reply'
          )
          .map((draft) => ({
            id: draft.id,
            body: draft.body,
            inReplyToId: draft.inReplyToId
          }))
      }
    });
  }

  const continuityIdentity = useMemo(() => ({
    key: JSON.stringify([detail.profileId, detail.reviewPlan.repoPath, detail.number]),
    headSha: detail.headSha,
    baseSha: detail.baseSha
  }), [detail.profileId, detail.reviewPlan.repoPath, detail.number, detail.headSha, detail.baseSha]);

  const galleryImages = [
    ...new Map(
      [
        ...getReviewImages(detail.body, detail.bodyImageUrls),
        ...detail.conversationComments.flatMap((comment) => getReviewImages(comment.body, comment.bodyImageUrls)),
        ...detail.reviewComments.flatMap((comment) => getReviewImages(comment.body, comment.bodyImageUrls)),
        ...detail.reviews.flatMap((review) => getReviewImages(review.body, review.bodyImageUrls))
      ].map((image) => [image.src, image])
    ).values()
  ];
  const discussion = timeline.filter((entry) => entry.kind !== 'commit');
  const approvalCount = new Set(detail.reviews.filter((review) => review.state === 'approved').map((review) => review.author)).size;
  const activityItems = groupPullRequestActivity(
    activityPreferences.order === 'newest' ? [...timeline].reverse() : timeline,
    { hideBots: activityPreferences.hideBots }
  );

  return (
    <section className="pr-review-view" aria-label={`Review ${detail.title}`}>
      <PullRequestDetailHeader
        pullRequest={detail}
        condensed={isHeaderCondensed}
        commits={detail.commits}
        onBack={onBackToInbox}
        status={
          <ReviewStatus
            detail={detail}
            areConflictsOpen={detailTab === 'summary' && isConflictPanelOpen}
            onToggleConflicts={toggleConflicts}
          />
        }
        actions={
          <>
            {isReviewPlanEnriching ? (
              <span className="pr-review-loading-progress" role="status" aria-live="polite">
                <Loader2 size={12} className="animate-spin" />
                Adding context
              </span>
            ) : null}
            <PullRequestRefreshControl
              lastRefreshedAt={lastRefreshedAt}
              isRefreshing={isRefreshing}
              hasNewActivity={hasNewActivity}
              errorMessage={refreshErrorMessage}
              compact
              onRefresh={onRefresh}
            />
            <PullRequestHeaderActions
              detail={detail}
              repoPath={codexRepoPath}
              reviewDraftCount={reviewDrafts.length}
              mergeLabel={mergeMethodLabel(detail.mergeSettings.defaultMethod)}
              mergeDisabled={
                (detail.state !== undefined && detail.state !== 'open') ||
                hasMergeConflicts ||
                !detail.canMerge ||
                detail.isDraft ||
                mergeMutation.isPending
              }
              mergeTitle={
                detail.state === 'merged'
                  ? 'This pull request is already merged'
                  : detail.state === 'closed'
                    ? 'Closed pull requests cannot be merged'
                    : hasMergeConflicts
                      ? 'Resolve merge conflicts before merging'
                      : detail.isDraft
                        ? 'Draft pull requests cannot be merged'
                        : !detail.canMerge
                          ? 'The connected account cannot merge this pull request'
                          : 'Merge pull request'
              }
              isMergePending={mergeMutation.isPending}
              onFinishReview={() => openPanel('review')}
              onSelectReviewDecision={(event) => {
                setReviewEvent(event);
                openPanel('review');
              }}
              onOpenMerge={() => openPanel('merge')}
              onClose={onClose}
              onNotice={setNotice}
            />
          </>
        }
      />

      {notice ? (
        <div className="pr-review-notice" data-tone={notice.tone} role="status">
          {notice.tone === 'success' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
          <span>{notice.message}</span>
          <button type="button" onClick={() => setNotice(undefined)} aria-label="Dismiss message">
            <X size={12} />
          </button>
        </div>
      ) : null}

      {bugFinderOpen ? <BugFinderView detail={detail} repoPath={codexRepoPath} diffSyntaxTheme={diffSyntaxTheme} diffStyle={diffStyle} onClose={() => setBugFinderOpen(false)} /> : null}

      <PullRequestDetailTabs
        value={detailTab}
        onChange={selectDetailTab}
        hidden={bugFinderOpen}
        counts={{ activity: discussion.length + detail.commits, code: detail.changedFiles }}
        trailing={detailTab === 'activity' ? (
          <>
            {condensedStatus}
            <span className="pr-activity-counts">
              <span title="Comments and reviews"><MessageSquare size={12} aria-hidden="true" />{discussion.length}<span className="sr-only"> comments and reviews</span></span>
              <span title="Commits"><GitCommitHorizontal size={12} aria-hidden="true" />{detail.commits}<span className="sr-only"> commits</span></span>
              {approvalCount ? <span className="pr-activity-approvals" title="Approvals"><Check size={12} aria-hidden="true" />{approvalCount}<span className="sr-only"> approvals</span></span> : null}
            </span>
            <button
              className="btn-subtle btn-compact"
              type="button"
              aria-pressed={activityPreferences.hideBots}
              onClick={() => setActivityPreferences({ ...activityPreferences, hideBots: !activityPreferences.hideBots })}
            >
              <Bot size={12} />
              {activityPreferences.hideBots ? 'Bots hidden' : 'Hide bots'}
            </button>
            <button
              className="btn-subtle btn-compact"
              type="button"
              aria-label={activityPreferences.order === 'newest' ? 'Show oldest activity first' : 'Show newest activity first'}
              onClick={() => setActivityPreferences({ ...activityPreferences, order: activityPreferences.order === 'newest' ? 'oldest' : 'newest' })}
            >
              <ArrowDownUp size={12} />
              {activityPreferences.order === 'newest' ? 'Newest first' : 'Oldest first'}
            </button>
          </>
        ) : (
          <>
            {condensedStatus}
            {detailTab === 'code' && cameFromGuide ? (
              <button className="btn-subtle btn-compact" type="button" onClick={() => selectDetailTab('guide')}>
                <ArrowLeft size={12} />
                Back to Guide
              </button>
            ) : null}
          </>
        )}
      />

      <div
        style={bugFinderOpen ? { display: 'none' } : undefined}
        className="pr-review-workspace"
        data-panel-open={isReviewDialogOpen || isMergeDialogOpen}
        onScrollCapture={trackPaneScroll}
      >
        <div className="pr-detail-pane pr-summary" hidden={detailTab !== 'summary'} {...pullRequestDetailPanelProps('summary')}>
          <div className="pr-summary-column">
            <div className="pr-summary-meta">
              {/* Author, branches, and size live in the header; these rows hold what it does not. */}
              <PullRequestMetaRow icon={<Users size={13} />} label="Reviewers">
                <PullRequestReviewerPicker
                  detail={detail}
                  onReviewersChanged={() =>
                    queryClient.invalidateQueries({
                      queryKey: gitHubPullRequestInboxQueryKey(locator.profileId)
                    })
                  }
                  onNotice={setNotice}
                />
              </PullRequestMetaRow>
              <PullRequestMetaRow icon={<CircleDot size={13} />} label="Checks">
                <PullRequestChecksBreakdown checks={detail.checks} />
              </PullRequestMetaRow>
              {(detail.state === 'open' || detail.state === undefined) && mergeBlockers.length === 0 ? (
                <PullRequestMetaRow icon={<GitMerge size={13} />} label="Merge">
                  <span className="pr-summary-tone" data-tone={mergeReadiness(detail).tone}>{mergeReadiness(detail).label}</span>
                </PullRequestMetaRow>
              ) : null}
              <PullRequestMetaRow icon={<Link2 size={13} />} label="Links">
                <span className="pr-summary-links">
                  <PullRequestGitHubLink url={detail.url} onNotice={setNotice} size="compact" />
                  <button className="btn-subtle btn-compact" type="button" onClick={copyGitGudLink}>
                    <Link2 size={12} />
                    Copy Git Gud link
                  </button>
                </span>
              </PullRequestMetaRow>
            </div>

            <PullRequestMergeChecklist
              detail={detail}
              blockers={mergeBlockers}
              conflicts={{
                hasLocalCheckout: Boolean(codexRepoPath),
                details: conflictDetailsQuery.data,
                isLoading: conflictDetailsQuery.isLoading,
                errorMessage: conflictDetailsQuery.error instanceof Error ? conflictDetailsQuery.error.message : undefined,
                isOpen: isConflictPanelOpen,
                onToggle: () => setIsConflictPanelOpen((current) => !current)
              }}
              isMarkingReady={markReadyMutation.isPending}
              onMarkReady={() => markReadyMutation.mutate()}
            />

            <PullRequestSection title="Description">
              <ReviewCommentBody
                body={detail.body || '_No description provided._'}
                imageUrls={detail.bodyImageUrls}
                imageLoading="eager"
                onOpenImage={setImageGallery}
              />
            </PullRequestSection>

            {galleryImages.length ? (
              <PullRequestSection title={`Images · ${galleryImages.length}`} defaultOpen={false}>
                <div className="pr-summary-images">
                  {galleryImages.map((image, index) => (
                    <button
                      type="button"
                      key={image.src}
                      onClick={() => setImageGallery({ images: galleryImages, index })}
                      aria-label={`Open ${image.alt || `image ${index + 1}`} preview`}
                    >
                      <PullRequestImageThumbnail src={image.src} alt={image.alt || `Pull request image ${index + 1}`} />
                      <span>{image.alt || `Image ${index + 1}`}</span>
                    </button>
                  ))}
                </div>
              </PullRequestSection>
            ) : null}
          </div>
        </div>

        <div className="pr-detail-pane" hidden={detailTab !== 'guide'} {...pullRequestDetailPanelProps('guide')}>
          <PullRequestGuideTab
            detail={detail}
            active={detailTab === 'guide' && !bugFinderOpen && !isReviewDialogOpen && !isMergeDialogOpen}
            diffStyle={diffStyle}
            diffSyntaxTheme={diffSyntaxTheme}
            onOpenFile={openFileInCode}
            onFinishReview={() => openPanel('review')}
            stopRequest={guideStopRequest}
          />
        </div>

        <div className="pr-detail-pane pr-activity" hidden={detailTab !== 'activity'} {...pullRequestDetailPanelProps('activity')}>
          <div className="pr-activity-column">
            <PullRequestCommentComposer
              hidden={false}
              isOpen={isCommentOpen}
              formId={`${panelTitleId}-comment-form`}
              onClose={() => setIsCommentOpen(false)}
              locator={locator}
              onPosted={(message) => {
                setNotice({ tone: 'success', message });
                void refreshPullRequest();
              }}
            />
            {!isCommentOpen ? (
              <button className="pr-activity-add-comment" type="button" onClick={() => setIsCommentOpen(true)}>
                <MessageSquare size={13} />
                Add a comment…
              </button>
            ) : null}
            <div className="pr-review-timeline">
              {activityItems.length ? (
                activityItems.map((item) => item.kind === 'commits' ? (
                  <details className="pr-commit-group" key={item.key}>
                    <summary>
                      <GitCommitHorizontal size={13} aria-hidden="true" />
                      <span>
                        <strong>{[...new Set(item.commits.map(({ commit }) => commit.author))].join(', ')}</strong>
                        {' '}pushed {item.commits.length} commits
                      </span>
                      <time dateTime={item.commits.at(-1)!.createdAt}>{formatDiscussionDate(item.commits.at(-1)!.createdAt)}</time>
                    </summary>
                    {item.commits.map((entry) => (
                      <PullRequestTimelineItem entry={entry} onOpenImage={setImageGallery} key={entry.key} onOpenCommit={onOpenCommit} />
                    ))}
                  </details>
                ) : (
                  <PullRequestTimelineItem
                    entry={item.entry}
                    onOpenImage={setImageGallery}
                    key={item.key}
                    onOpenCommit={onOpenCommit}
                  />
                ))
              ) : (
                <p className="pr-context-empty">
                  {timeline.length ? 'Only bot activity so far.' : 'No comments or reviews yet.'}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="pr-focused-review" hidden={detailTab !== 'code'} {...pullRequestDetailPanelProps('code')}>
            <ReviewView
              key={`${continuityIdentity.key}:${detail.headSha}:${detail.baseSha}`}
              continuityIdentity={continuityIdentity}
              repoPath={detail.reviewPlan.repoPath}
              target={detail.reviewPlan.target}
              plan={detail.reviewPlan}
              guideReferences={guideReferences}
              sidebarActions={<BugFinderButton pullRequest={detail} inReview iconOnly active={bugFinderOpen} onOpen={() => setBugFinderOpen(true)} />}
              reviewProgressKey={detail.reviewPlan.targetKey}
              lineComments={displayedLineComments}
              onAddDraftLineComment={addDraftLineComment}
              onAddDraftFileComment={addDraftFileComment}
              onAddDraftReply={addDraftReply}
              onUpdateComment={updateComment}
              onUpdateDraftComment={updateDraft}
              onRemoveDraftComment={removeDraft}
              diffStyle={diffStyle}
              diffSyntaxTheme={diffSyntaxTheme}
              onSetDiffStyle={onSetDiffStyle}
              onClose={onClose}
              showCloseButton={false}
              layout="pull-request"
              navigationRequest={codeNavigation}
              fileTreePanel={{ open: isAllFilesOpen, onClose: () => setAllFilesOpen(false), onToggle: () => isAllFilesOpen ? setAllFilesOpen(false) : openPanel('files') }}
            />
        </div>

        <ReviewSubmissionDialog
          key={reviewSubmissionKey}
          open={isReviewDialogOpen}
          event={detail.author.toLowerCase() === detail.viewerLogin.toLowerCase() ? 'comment' : reviewEvent}
          onEventChange={setReviewEvent}
          isOwnPullRequest={detail.author.toLowerCase() === detail.viewerLogin.toLowerCase()}
          drafts={reviewDrafts}
          isSubmitting={reviewMutation.isPending}
          isCopyingPrompt={copyPromptMutation.isPending}
          errorMessage={
            copyPromptMutation.error instanceof Error
              ? copyPromptMutation.error.message
              : reviewMutation.error instanceof Error
                ? reviewMutation.error.message
                : undefined
          }
          onRemoveDraft={removeDraft}
          onClose={() => setIsReviewDialogOpen(false)}
          onCopyPrompt={(summary) => copyPromptMutation.mutate(summary)}
          onSubmit={submitReview}
        />
        <MergePullRequestDialog
          open={isMergeDialogOpen}
          errorMessage={
            mergeMutation.error instanceof Error ? mergeMutation.error.message : undefined
          }
          pullRequest={detail}
          isMerging={mergeMutation.isPending}
          onClose={() => setIsMergeDialogOpen(false)}
          onMerge={(method) => mergeMutation.mutate(method)}
        />
      </div>
      {imageGallery ? (
        <ReviewImageGalleryDialog
          selection={imageGallery}
          onClose={() => setImageGallery(undefined)}
        />
      ) : null}
    </section>
  );
}

function PullRequestCommentComposer({ hidden, isOpen, formId, onClose, locator, onPosted }: {
  hidden: boolean;
  isOpen: boolean;
  formId: string;
  onClose: () => void;
  locator: GitHubPullRequestLocator;
  onPosted: (message: string) => void;
}): ReactElement {
  const inputId = useId();
  const [commentBody, setCommentBody] = useState('');
  const commentMutation = useMutation({
    mutationFn: (body: string) => window.api.addGitHubPullRequestComment({ ...locator, body }),
    onSuccess: (result) => {
      setCommentBody('');
      onClose();
      onPosted(result.message);
    }
  });
  return (
    <div className="pr-comment-composer" hidden={hidden || !isOpen}>
      {isOpen ? (
        <form id={formId} onSubmit={(event) => {
          event.preventDefault();
          if (commentBody.trim() && !commentMutation.isPending) commentMutation.mutate(commentBody.trim());
        }}>
          <textarea
            id={inputId}
            aria-label="Add a comment"
            autoFocus
            value={commentBody}
            onChange={(event) => setCommentBody(event.target.value)}
            placeholder="Leave a comment on this pull request…"
            rows={3}
            maxLength={65_536}
            disabled={commentMutation.isPending}
          />
          {commentMutation.error ? <p role="alert">{commentMutation.error.message}</p> : null}
          <div className="pr-comment-composer-actions">
            <button className="btn-subtle btn-compact" type="button" disabled={commentMutation.isPending} onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary btn-compact" type="submit" disabled={!commentBody.trim() || commentMutation.isPending}>
              <Send size={12} />
              {commentMutation.isPending ? 'Posting…' : 'Post comment'}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function PullRequestImageThumbnail({ src, alt }: { src: string; alt: string }): ReactElement {
  const [failedSrc, setFailedSrc] = useState<string>();
  return failedSrc === src ? (
    <span className="pr-context-image-unavailable">Image unavailable</span>
  ) : (
    <img src={src} alt={alt} loading="lazy" onError={() => setFailedSrc(src)} />
  );
}

function PullRequestTimelineItem({
  entry,
  onOpenImage,
  onOpenCommit
}: {
  entry: PullRequestTimelineEntry;
  onOpenImage: (selection: ReviewImageGallerySelection) => void;
  onOpenCommit?: (sha: string) => void;
}): ReactElement {
  if (entry.kind === 'commit') {
    const subject = entry.commit.message.split('\n', 1)[0] || 'Untitled commit';

    return (
      <article className="pr-timeline-event" data-kind="commit">
        <PullRequestAvatar
          author={entry.commit.author}
          authorAvatarUrl={entry.commit.authorAvatarUrl}
        />
        <div className="pr-timeline-event-content">
          <a className="pr-timeline-commit-subject" href={entry.commit.url} target="_blank" rel="noreferrer" title={subject}>
            {subject}
          </a>
          <div className="pr-timeline-commit">
            <span><strong>{entry.commit.author}</strong> committed</span>
            {onOpenCommit ? (
              <button
                className="pr-timeline-commit-sha"
                type="button"
                aria-label={`Open commit ${entry.commit.sha.slice(0, 7)} in graph`}
                title="Open commit in graph"
                onClick={() => onOpenCommit(entry.commit.sha)}
              >
                {entry.commit.sha.slice(0, 7)}
              </button>
            ) : (
              <code title="Open this repository locally to view the commit in the graph">
                {entry.commit.sha.slice(0, 7)}
              </code>
            )}
            <time dateTime={entry.createdAt} title={formatDiscussionDate(entry.createdAt)}>{formatDiscussionDate(entry.createdAt)}</time>
          </div>
        </div>
      </article>
    );
  }

  if (entry.kind === 'conversation') {
    return (
      <article className="pr-timeline-event" data-kind="conversation">
        <PullRequestAvatar
          author={entry.comment.author}
          authorAvatarUrl={entry.comment.authorAvatarUrl}
        />
        <div className="pr-timeline-event-content pr-timeline-comment">
          <TimelineEventHeader
            author={entry.comment.author}
            action="commented"
            createdAt={entry.createdAt}
            url={entry.comment.url}
          />
          <ReviewCommentBody body={entry.comment.body} imageUrls={entry.comment.bodyImageUrls} onOpenImage={onOpenImage} />
        </div>
      </article>
    );
  }

  if (entry.kind === 'review-thread') {
    return (
      <article className="pr-timeline-event" data-kind="review-thread">
        <PullRequestAvatar
          author={entry.thread.root.author}
          authorAvatarUrl={entry.thread.root.authorAvatarUrl}
        />
        <div className="pr-timeline-event-content pr-timeline-review">
          <TimelineEventHeader
            author={entry.thread.root.author}
            action="left a review comment"
            createdAt={entry.createdAt}
            url={entry.thread.root.url}
          />
          <div className="pr-timeline-review-threads">
            <ReviewTimelineThread onOpenImage={onOpenImage} thread={entry.thread} />
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="pr-timeline-event" data-kind="review" data-state={entry.review.state}>
      <PullRequestAvatar
        author={entry.review.author}
        authorAvatarUrl={entry.review.authorAvatarUrl}
      />
      <div className="pr-timeline-event-content pr-timeline-review">
        <TimelineEventHeader
          author={entry.review.author}
          action={reviewTimelineAction(entry.review.state)}
          createdAt={entry.createdAt}
          url={entry.review.url}
          state={entry.review.state}
        />
        {entry.review.body.trim() ? <ReviewCommentBody body={entry.review.body} imageUrls={entry.review.bodyImageUrls} onOpenImage={onOpenImage} /> : null}
        {entry.threads.length > 0 ? (
          <div className="pr-timeline-review-threads">
            {entry.threads.map((thread) => (
              <ReviewTimelineThread onOpenImage={onOpenImage} thread={thread} key={thread.root.id} />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function TimelineEventHeader({
  author,
  action,
  createdAt,
  url,
  state
}: {
  author: string;
  action: string;
  createdAt: string;
  url: string;
  state?: string;
}): ReactElement {
  return (
    <header>
      <span>
        {state === 'approved' ? <CheckCircle2 size={12} /> : null}
        {state === 'changes-requested' ? <AlertTriangle size={12} /> : null}
        <strong>{author}</strong>
        {action}
      </span>
      <a href={url} target="_blank" rel="noreferrer">
        <time dateTime={createdAt}>{formatDiscussionDate(createdAt)}</time>
        <ExternalLink size={10} />
      </a>
    </header>
  );
}

function ReviewTimelineThread({
  thread,
  onOpenImage
}: {
  onOpenImage: (selection: ReviewImageGallerySelection) => void;
  thread: PullRequestReviewThread;
}): ReactElement {
  const lineLabel = thread.root.subjectType === 'file'
    ? thread.root.path
    : `${thread.root.path}:${thread.root.line ?? '?'}`;

  return (
    <article className="pr-timeline-review-thread">
      <header>
        <code title={lineLabel}>{lineLabel}</code>
        <a
          href={thread.root.url}
          target="_blank"
          rel="noreferrer"
          aria-label="Open review discussion on GitHub"
        >
          <ExternalLink size={10} />
        </a>
      </header>
      <div className="pr-timeline-thread-comments">
        <ReviewTimelineThreadMessage onOpenImage={onOpenImage} comment={thread.root} />
        {thread.replies.map((reply) => (
          <ReviewTimelineThreadMessage onOpenImage={onOpenImage} comment={reply} isReply key={reply.id} />
        ))}
      </div>
    </article>
  );
}

function ReviewTimelineThreadMessage({
  comment,
  onOpenImage,
  isReply = false
}: {
  comment: GitHubPullRequestDetail['reviewComments'][number];
  onOpenImage: (selection: ReviewImageGallerySelection) => void;
  isReply?: boolean;
}): ReactElement {
  return (
    <div className="pr-timeline-thread-message" data-reply={isReply}>
      <PullRequestAvatar
        author={comment.author}
        authorAvatarUrl={comment.authorAvatarUrl}
        size="compact"
      />
      <div>
        <header>
          <strong>{comment.author}</strong>
          {isReply ? <span>replied</span> : null}
          <a
            href={comment.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${comment.author}'s comment on GitHub`}
          >
            <time dateTime={comment.createdAt}>{formatDiscussionDate(comment.createdAt)}</time>
            <ExternalLink size={9} />
          </a>
        </header>
        <ReviewCommentBody body={comment.body} imageUrls={comment.bodyImageUrls} onOpenImage={onOpenImage} />
      </div>
    </div>
  );
}

function ReviewSubmissionDialog({
  open,
  event,
  onEventChange,
  isOwnPullRequest,
  drafts,
  isSubmitting,
  isCopyingPrompt,
  errorMessage,
  onRemoveDraft,
  onClose,
  onCopyPrompt,
  onSubmit
}: {
  open: boolean;
  event: ReviewEvent;
  onEventChange: (event: ReviewEvent) => void;
  isOwnPullRequest: boolean;
  drafts: PullRequestReviewDraft[];
  isSubmitting: boolean;
  isCopyingPrompt: boolean;
  errorMessage?: string;
  onRemoveDraft: (id: string) => void;
  onClose: () => void;
  onCopyPrompt: (body: string) => void;
  onSubmit: (event: ReviewEvent, body: string) => void;
}): ReactElement {
  const titleId = useId();
  const [body, setBody] = useState('');
  const requiresBody = isReviewSummaryRequired(event, drafts.length);
  const hasPromptContext = drafts.length > 0 || body.trim().length > 0;
  const isBusy = isSubmitting || isCopyingPrompt;

  function handleSubmit(submitEvent: FormEvent<HTMLFormElement>): void {
    submitEvent.preventDefault();
    if (isBusy || (isOwnPullRequest && event !== 'comment') || (requiresBody && !body.trim())) {
      return;
    }
    onSubmit(event, body.trim());
  }

  return (
    <PullRequestPanel
      open={open}
      labelledBy={titleId}
      className="pr-action-dialog"
      onClose={isBusy ? () => undefined : onClose}
    >
      <form onSubmit={handleSubmit}>
        <header>
          <ShieldCheck size={17} />
          <h2 id={titleId}>Finish review</h2>
          <button
            className="icon-btn icon-btn-compact"
            type="button"
            disabled={isBusy}
            onClick={onClose}
            aria-label="Close review dialog"
          >
            <X size={14} />
          </button>
        </header>
        <div className="pr-action-dialog-body">
          {!isOwnPullRequest ? <div>
            <span className="pr-action-field-label">GitHub review decision</span>
            <div
              className="pr-review-decision-options"
              role="group"
              aria-label="GitHub review decision"
            >
              {(
                [
                  ['comment', 'Send comments', MessageSquare],
                  ['approve', 'Approve', CheckCircle2],
                  ['request-changes', 'Request changes', AlertTriangle]
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  disabled={isBusy}
                  data-active={event === value}
                  aria-pressed={event === value}
                  onClick={() => onEventChange(value)}
                >
                  <Icon size={13} />
                  {label}
                </button>
              ))}
            </div>
          </div> : null}
          {drafts.length > 0 ? (
            <section className="pr-review-draft-list" aria-label="Draft review comments">
              <header>
                <span>
                  Draft comments
                  <strong>{drafts.length}</strong>
                </span>
                <small>These are still local to Git Gud.</small>
              </header>
              <div>
                {drafts.map((draft) => (
                  <article key={draft.id}>
                    <span className="pr-review-draft-type">
                      {draft.kind === 'line' ? (
                        <MessageSquare size={11} />
                      ) : draft.kind === 'file' ? (
                        <FileText size={11} />
                      ) : (
                        <CornerDownRight size={11} />
                      )}
                    </span>
                    <span>
                      <strong>
                        {draft.kind === 'line'
                          ? `${draft.path}:${draft.startLine ? `${draft.startLine}–` : ''}${draft.line}`
                          : draft.kind === 'file'
                            ? draft.path
                            : 'Reply in existing thread'}
                      </strong>
                      <small>{draft.body}</small>
                    </span>
                    <button
                      className="review-comment-action review-comment-icon-action review-comment-action--danger"
                      type="button"
                      disabled={isBusy}
                      onClick={() => onRemoveDraft(draft.id)}
                      aria-label="Remove draft comment"
                    >
                      <Trash2 size={12} />
                    </button>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
          <label>
            <span>{requiresBody ? 'Review summary' : 'Review summary (optional)'}</span>
            <textarea
              rows={4}
              value={body}
              placeholder={
                event === 'approve'
                  ? 'Looks good to me…'
                  : event === 'request-changes'
                    ? 'Explain what should change before merging…'
                    : 'Leave a general review comment…'
              }
              disabled={isBusy}
              onChange={(changeEvent) => setBody(changeEvent.target.value)}
            />
          </label>
          {errorMessage ? <p className="pr-action-error">{errorMessage}</p> : null}
        </div>
        <footer>
          <span className="pr-review-submit-note">
            Copying keeps drafts local. GitHub publishes them.
          </span>
          <button
            className="btn-subtle btn-regular"
            type="button"
            disabled={isBusy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="btn-subtle btn-regular"
            type="button"
            disabled={isBusy || !hasPromptContext}
            title={
              hasPromptContext
                ? 'Copy a prompt containing these local review comments and summary'
                : 'Add a draft comment or review summary first'
            }
            onClick={() => onCopyPrompt(body.trim())}
          >
            {isCopyingPrompt ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />}
            Copy review prompt
          </button>
          <button
            className="btn-primary btn-regular"
            type="submit"
            disabled={isBusy || (requiresBody && !body.trim())}
          >
            {isSubmitting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            {reviewSubmitLabel(event, drafts.length)}
          </button>
        </footer>
      </form>
    </PullRequestPanel>
  );
}

function MergePullRequestDialog({
  open,
  errorMessage,
  pullRequest,
  isMerging,
  onClose,
  onMerge
}: {
  open: boolean;
  errorMessage?: string;
  pullRequest: GitHubPullRequestDetail;
  isMerging: boolean;
  onClose: () => void;
  onMerge: (method: GitHubPullRequestMergeMethod) => void;
}): ReactElement {
  const titleId = useId();
  const [method, setMethod] = useState<GitHubPullRequestMergeMethod>(
    pullRequest.mergeSettings.defaultMethod
  );
  const hasMultipleMethods = pullRequest.mergeSettings.allowedMethods.length > 1;

  return (
    <PullRequestPanel
      open={open}
      labelledBy={titleId}
      className="pr-action-dialog"
      onClose={isMerging ? () => undefined : onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!isMerging) onMerge(method);
        }}
      >
        <header>
          <GitMerge size={17} />
          <h2 id={titleId}>Merge pull request #{pullRequest.number}</h2>
          <button
            className="icon-btn icon-btn-compact"
            type="button"
            disabled={isMerging}
            onClick={onClose}
            aria-label="Close merge dialog"
          >
            <X size={14} />
          </button>
        </header>
        <div className="pr-action-dialog-body">
          {errorMessage ? (
            <p className="pr-action-error" role="alert">
              {errorMessage}
            </p>
          ) : null}
          <p className="pr-context-branches">
            {pullRequest.headRefName} → {pullRequest.baseRefName}
          </p>
          <p className="pr-merge-warning">
            This writes to {pullRequest.owner}/{pullRequest.repository} and cannot be undone from
            Git Gud.
          </p>
          {hasMultipleMethods ? (
            <label>
              <span>Merge method</span>
              <select
                value={method}
                disabled={isMerging}
                onChange={(event) => setMethod(normalizeMergeMethod(event.target.value))}
              >
                {pullRequest.mergeSettings.allowedMethods.map((allowedMethod) => (
                  <option value={allowedMethod} key={allowedMethod}>
                    {mergeMethodLabel(allowedMethod)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="pr-merge-method-locked">
              <GitMerge size={14} />
              <span>
                <strong>{mergeMethodLabel(method)}</strong>
                <small>Only merge method enabled for this GitHub repository</small>
              </span>
            </div>
          )}
        </div>
        <footer>
          <button
            className="btn-subtle btn-regular"
            type="button"
            disabled={isMerging}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="btn-primary btn-regular" type="submit" disabled={isMerging}>
            {isMerging ? <Loader2 size={13} className="animate-spin" /> : <GitMerge size={13} />}
            {mergeMethodLabel(method)}
          </button>
        </footer>
      </form>
    </PullRequestPanel>
  );
}

function PullRequestChecksBreakdown({ checks }: { checks: GitHubPullRequestSummary['checks'] }): ReactElement {
  if (checks.total === 0) return <span className="pr-summary-muted">No checks reported</span>;
  // GitHub counts skipped and neutral runs in the total; list them separately so 12/19 does not look unfinished.
  const skipped = Math.max(0, checks.total - checks.passed - checks.failed - checks.pending);
  const parts = [
    { tone: 'danger', count: checks.failed, label: 'failed' },
    { tone: 'pending', count: checks.pending, label: 'pending' },
    { tone: 'success', count: checks.passed, label: 'passed' },
    { tone: 'muted', count: skipped, label: 'skipped' }
  ].filter((part) => part.count > 0);
  return (
    <span className="pr-summary-checks">
      {parts.map((part) => (
        <span className="pr-summary-tone" data-tone={part.tone} key={part.label}>{part.count} {part.label}</span>
      ))}
    </span>
  );
}

function mergeReadiness(detail: GitHubPullRequestSummary): { tone: 'success' | 'danger' | 'warning' | 'muted'; label: string } {
  // Drafts, conflicts, and unfinished checks are listed by the merge checklist instead.
  switch (detail.mergeState) {
    case 'clean': return { tone: 'success', label: 'Ready to merge' };
    case 'behind': return { tone: 'warning', label: 'Branch is behind the base branch' };
    case 'blocked': return { tone: 'warning', label: 'Blocked by branch protection or required reviews' };
    case 'unstable': return { tone: 'warning', label: 'Mergeable, but some checks are not passing' };
    default: return { tone: 'muted', label: 'GitHub is still computing mergeability' };
  }
}

// Skipped and neutral runs never finish, so they stay out of the passed/ran ratio.
function checksHeaderLabel(checks: GitHubPullRequestSummary['checks']): string {
  const ran = checks.passed + checks.failed + checks.pending;
  const skipped = checks.total - ran;
  return `${checks.passed}/${ran} checks passed${skipped > 0 ? ` · ${skipped} skipped` : ''}`;
}

function ReviewStatus({
  detail,
  areConflictsOpen,
  onToggleConflicts
}: {
  detail: GitHubPullRequestSummary;
  areConflictsOpen?: boolean;
  onToggleConflicts?: () => void;
}): ReactElement {
  const reviewStatus = pullRequestStatus(detail);
  const hasMergeConflicts = hasPullRequestMergeConflicts(detail);
  const checksTone = pullRequestChecksTone(detail.checks);
  return (
    <>
      {hasMergeConflicts && onToggleConflicts ? (
        <button
          className="pr-review-status-button"
          type="button"
          data-tone={reviewStatus.tone}
          aria-controls="pr-review-conflict-panel"
          aria-expanded={areConflictsOpen}
          title={areConflictsOpen ? 'Hide merge conflict details' : 'Show merge conflict details'}
          onClick={onToggleConflicts}
        >
          <AlertTriangle size={12} />
          {reviewStatus.label}
          <ChevronRight size={11} aria-hidden="true" />
        </button>
      ) : (
        <span data-tone={reviewStatus.tone}>
          {reviewStatus.icon === 'check'
            ? <Check size={12} />
            : reviewStatus.icon === 'merge'
              ? <GitMerge size={12} />
              : reviewStatus.icon === 'warning'
              ? <AlertTriangle size={12} />
              : <CircleDot size={11} />}
          {reviewStatus.label}
        </span>
      )}
      {hasMergeConflicts && onToggleConflicts && detail.isDraft ? (
        <span data-tone="muted"><CircleDot size={11} />Draft</span>
      ) : null}
      <span data-tone={checksTone}>
        {checksTone === 'success' ? <Check size={12} /> : checksTone === 'danger' ? <AlertTriangle size={12} /> : <CircleDot size={11} />}
        {detail.checks.total > 0 ? checksHeaderLabel(detail.checks) : 'No checks reported'}
      </span>
    </>
  );
}

function ReviewMessage({
  icon,
  text,
  tone,
  actionLabel,
  onAction,
  closeLabel,
  onClose
}: {
  icon: ReactElement;
  text: string;
  tone?: 'danger';
  actionLabel?: string;
  onAction?: () => void;
  closeLabel?: string;
  onClose?: () => void;
}): ReactElement {
  return (
    <div className="review-message" data-tone={tone}>
      <span className="flex items-center gap-2">{icon}{text}</span>
      {(actionLabel && onAction) || (closeLabel && onClose) ? (
        <span className="mt-3 flex items-center gap-2">
          {actionLabel && onAction ? (
            <button
              className="icon-btn icon-btn-regular"
              type="button"
              onClick={onAction}
              aria-label={actionLabel}
              title={actionLabel}
            >
              <ArrowLeft size={15} />
            </button>
          ) : null}
          {closeLabel && onClose ? (
            <button
              className="icon-btn icon-btn-regular"
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              title={closeLabel}
            >
              <X size={14} />
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

function normalizeMergeMethod(value: string): GitHubPullRequestMergeMethod {
  return value === 'merge' || value === 'rebase' ? value : 'squash';
}

function mergeMethodLabel(method: GitHubPullRequestMergeMethod): string {
  return method === 'squash'
    ? 'Squash and merge'
    : method === 'rebase'
      ? 'Rebase and merge'
      : 'Merge pull request';
}

function formatDiscussionDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function reviewSubmitLabel(event: ReviewEvent, draftCount: number): string {
  const suffix = draftCount > 0
    ? ` with ${draftCount} ${draftCount === 1 ? 'comment' : 'comments'}`
    : '';
  return event === 'approve'
    ? `Approve${suffix}`
    : event === 'request-changes'
      ? `Request changes${suffix}`
      : draftCount > 0
        ? `Send ${draftCount} ${draftCount === 1 ? 'comment' : 'comments'}`
        : 'Send review comment';
}

function loadPullRequestReviewDrafts(
  storage: Storage,
  storageKey: string
): PullRequestReviewDraft[] {
  try {
    const value = JSON.parse(storage.getItem(storageKey) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter(isPullRequestReviewDraft) : [];
  } catch {
    return [];
  }
}

function savePullRequestReviewDrafts(
  storage: Storage,
  storageKey: string,
  drafts: PullRequestReviewDraft[]
): void {
  if (drafts.length === 0) {
    storage.removeItem(storageKey);
    return;
  }
  storage.setItem(storageKey, JSON.stringify(drafts));
}

function isPullRequestReviewDraft(value: unknown): value is PullRequestReviewDraft {
  if (!isRecord(value)) {
    return false;
  }
  const hasBaseFields =
    typeof value.id === 'string' &&
    typeof value.body === 'string' &&
    typeof value.createdAt === 'string';
  if (!hasBaseFields) {
    return false;
  }
  if (value.kind === 'reply') {
    return typeof value.inReplyToId === 'number' && value.inReplyToId > 0;
  }
  if (value.kind === 'file') {
    return typeof value.path === 'string' && value.path.length > 0;
  }
  return (
    value.kind === 'line' &&
    typeof value.path === 'string' &&
    typeof value.line === 'number' &&
    value.line > 0 &&
    (value.side === 'left' || value.side === 'right') &&
    (value.startLine === undefined ||
      (typeof value.startLine === 'number' && value.startLine > 0)) &&
    (value.startSide === undefined ||
      value.startSide === 'left' ||
      value.startSide === 'right')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function reviewTimelineAction(state: string): string {
  if (state === 'approved') {
    return 'approved these changes';
  }
  if (state === 'changes-requested') {
    return 'requested changes';
  }
  if (state === 'dismissed') {
    return 'had a review dismissed';
  }
  return 'reviewed these changes';
}
