import type { CSSProperties, FormEvent, ReactElement } from 'react';
import { useId, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Copy,
  CornerDownRight,
  ExternalLink,
  FileText,
  FolderTree,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Link2,
  Loader2,
  MessageSquare,
  Send,
  ShieldCheck,
  Trash2,
  X
} from 'lucide-react';

import { ModalSurface } from '@renderer/components/accessibility/ModalSurface';
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
  GitHubPullRequestDetail,
  GitHubPullRequestDraftFileComment,
  GitHubPullRequestDraftLineComment,
  GitHubPullRequestDraftReply,
  GitHubPullRequestMergeMethod,
  GitHubPullRequestReviewInput,
  GitHubPullRequestSummary
} from '@shared/types';

import { PullRequestReviewerAvatars } from './PullRequestReviewerAvatars';
import { PullRequestRefreshControl } from './PullRequestRefreshControl';
import { PullRequestGitHubLink } from './PullRequestGitHubLink';
import { PullRequestHeaderActions } from './PullRequestHeaderActions';
import { copyPullRequestCodexPrompt } from './pullRequestCodexPrompt';
import {
  hasPullRequestMergeConflicts,
  pullRequestStatus
} from './pullRequestInboxStatus';
import { retainUnsubmittedOrFailedDrafts } from './pullRequestReviewDrafts';
import { isReviewSummaryRequired } from './pullRequestReviewSubmission';
import { copyGitGudPullRequestLink } from './pullRequestLinkClipboard';
import {
  buildPullRequestTimeline,
  type PullRequestReviewThread,
  type PullRequestTimelineEntry
} from './pullRequestTimeline';

type PullRequestReviewViewProps = {
  pullRequest: GitHubPullRequestSummary;
  codexRepoPath?: string;
  diffStyle: DiffStyle;
  diffSyntaxTheme: DiffSyntaxTheme;
  onSetDiffStyle: (style: DiffStyle) => void;
  onBackToInbox: () => void;
  onOpenCommit?: (sha: string) => void;
  onClose: () => void;
  onMerged: () => void;
};

type ReviewEvent = GitHubPullRequestReviewInput['event'];

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
  onAction,
  onClose
}: {
  pullRequest: GitHubPullRequestSummary;
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
      <header className="pr-review-header pr-review-header--compact">
        <button
          className="icon-btn icon-btn-regular shrink-0"
          type="button"
          onClick={onAction}
          aria-label="Back to pull requests"
          title="Back to pull requests"
        >
          <ArrowLeft size={15} />
        </button>
        <div className="pr-review-title">
          <GitPullRequest size={13} />
          <h1 title={pullRequest.title}>{pullRequest.title}</h1>
          <span className="pr-review-number">
            {pullRequest.owner}/{pullRequest.repository}#{pullRequest.number}
          </span>
        </div>
        <div className="pr-review-header-status">
          <ReviewStatus detail={pullRequest} />
        </div>
        <div className="pr-review-header-actions">
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
        </div>
      </header>

      <div className="review-view pr-review-loading-workspace" aria-hidden="true">
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
      </div>
    </section>
  );
}

function PullRequestReviewContent({
  detail,
  codexRepoPath,
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
  const locator = {
    profileId: detail.profileId,
    owner: detail.owner,
    repository: detail.repository,
    number: detail.number
  };
  const reviewGuideProvider = useMemo(() => {
    const reviewLocator = {
      profileId: detail.profileId,
      owner: detail.owner,
      repository: detail.repository,
      number: detail.number
    };

    return {
      getState: (sourceFingerprint: string) =>
        window.api.getGitHubPullRequestReviewGuideState(reviewLocator, sourceFingerprint),
      start: (sourceFingerprint: string) =>
        window.api.startGitHubPullRequestReviewGuide(reviewLocator, sourceFingerprint)
    };
  }, [detail.number, detail.owner, detail.profileId, detail.repository]);
  const queryClient = useQueryClient();
  const draftStorageKey = `git-gud:pr-review-drafts:${detail.reviewPlan.targetKey}`;
  const [reviewDrafts, setReviewDrafts] = useState<PullRequestReviewDraft[]>(() =>
    loadPullRequestReviewDrafts(window.localStorage, draftStorageKey)
  );
  const [isOverviewOpen, setIsOverviewOpen] = useState(false);
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

  function toggleOverview(): void {
    const willOpen = !isOverviewOpen;
    setIsOverviewOpen(willOpen);

    if (
      willOpen &&
      Object.keys(detail.bodyImageUrls ?? {}).length > 0 &&
      Date.now() - Date.parse(detail.loadedAt) >= 4 * 60 * 1_000
    ) {
      onRefresh();
    }
  }

  function toggleConflicts(): void {
    if (!isOverviewOpen) {
      setIsOverviewOpen(true);
      setIsConflictPanelOpen(true);
      return;
    }

    setIsConflictPanelOpen((current) => !current);
  }

  const hasMergeConflicts = hasPullRequestMergeConflicts(detail);
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
    enabled: hasMergeConflicts && isOverviewOpen && Boolean(codexRepoPath),
    staleTime: 15_000
  });
  const timeline = useMemo(
    () => buildPullRequestTimeline({
      commits: detail.commitTimeline,
      conversationComments: detail.conversationComments,
      reviews: detail.reviews,
      reviewComments: detail.reviewComments
    }),
    [
      detail.commitTimeline,
      detail.conversationComments,
      detail.reviewComments,
      detail.reviews
    ]
  );
  const displayedLineComments = useMemo<ReviewLineComment[]>(() => {
    const publishedComments: ReviewLineComment[] = detail.reviewComments.map((comment) => ({
      ...comment,
      authorAvatarUrl: comment.authorAvatarUrl,
      canEdit: comment.author === detail.viewerLogin
    }));
    const commentById = new Map(
      detail.reviewComments.map((comment) => [comment.id, comment])
    );
    const draftComments = reviewDrafts.flatMap<ReviewLineComment>((draft) => {
      if (draft.kind === 'line') {
        return [{
          id: draft.id,
          body: draft.body,
          author: detail.viewerLogin,
          createdAt: draft.createdAt,
          path: draft.path,
          subjectType: 'line',
          line: draft.line,
          side: draft.side,
          isDraft: true
        }];
      }

      if (draft.kind === 'file') {
        return [{
          id: draft.id,
          body: draft.body,
          author: detail.viewerLogin,
          createdAt: draft.createdAt,
          path: draft.path,
          subjectType: 'file',
          isDraft: true
        }];
      }

      const parent = commentById.get(draft.inReplyToId);
      if (!parent) {
        return [];
      }
      return [{
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
      }];
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
    mutationFn: ({ input }: {
      input: GitHubPullRequestReviewInput;
      submittedDraftIds: string[];
    }) => window.api.submitGitHubPullRequestReview(input),
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
        message: 'Review prompt copied. Your draft comments are still local and were not posted to GitHub.'
      });
      setIsReviewDialogOpen(false);
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
      await refreshGitHubPullRequestInboxAfterMerge(queryClient, locator);
      onMerged();
    },
    onError: (error) => {
      setNotice({
        tone: 'danger',
        message: error instanceof Error ? error.message : 'Could not merge the pull request.'
      });
      setIsMergeDialogOpen(false);
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
          .filter((draft): draft is Extract<PullRequestReviewDraft, { kind: 'line' }> =>
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
          .filter((draft): draft is Extract<PullRequestReviewDraft, { kind: 'file' }> =>
            draft.kind === 'file'
          )
          .map((draft) => ({
            id: draft.id,
            body: draft.body,
            path: draft.path
          })),
        replies: reviewDrafts
          .filter((draft): draft is Extract<PullRequestReviewDraft, { kind: 'reply' }> =>
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

  return (
    <section className="pr-review-view" aria-label={`Review ${detail.title}`}>
      <header className="pr-review-header pr-review-header--compact">
        <button
          className="icon-btn icon-btn-regular shrink-0"
          type="button"
          onClick={onBackToInbox}
          aria-label="Back to pull requests"
          title="Back to pull requests"
        >
          <ArrowLeft size={15} />
        </button>
        <div className="pr-review-title">
          <GitPullRequest size={13} />
          <h1 title={detail.title}>{detail.title}</h1>
          <span className="pr-review-number">
            {detail.owner}/{detail.repository}#{detail.number}
          </span>
        </div>
        <div className="pr-review-header-status overflow-hidden">
          <ReviewStatus
            detail={detail}
            areConflictsOpen={isOverviewOpen && isConflictPanelOpen}
            onToggleConflicts={toggleConflicts}
          />
        </div>
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
          isOverviewOpen={isOverviewOpen}
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
          onToggleOverview={toggleOverview}
          onFinishReview={() => setIsReviewDialogOpen(true)}
          onOpenMerge={() => setIsMergeDialogOpen(true)}
          onClose={onClose}
          onNotice={setNotice}
        />
      </header>

      {notice ? (
        <div className="pr-review-notice" data-tone={notice.tone} role="status">
          {notice.tone === 'success' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
          <span>{notice.message}</span>
          <button type="button" onClick={() => setNotice(undefined)} aria-label="Dismiss message">
            <X size={12} />
          </button>
        </div>
      ) : null}

      {isOverviewOpen ? (
        <section
          className="pr-review-overview"
          id="pr-review-overview-panel"
          aria-label="Pull request overview and discussion"
        >
          <div className="pr-review-overview-meta">
            <span className="pr-review-repository">
              <GitPullRequest size={11} />
              {detail.owner}/{detail.repository}#{detail.number}
            </span>
            <span aria-hidden="true">·</span>
            <span className="pr-review-author">{detail.author}</span>
            <span aria-hidden="true">·</span>
            <span className="pr-review-branch-path" title={`${detail.headRefName} → ${detail.baseRefName}`}>
              <span>{detail.headRefName}</span>
              <span>→</span>
              <span>{detail.baseRefName}</span>
            </span>
            <span aria-hidden="true">·</span>
            <GitCommitHorizontal size={11} />
            <span>{detail.commits} {detail.commits === 1 ? 'commit' : 'commits'}</span>
            <span className="pr-review-overview-stats">
              <span className="pr-review-change-stat" data-change="addition">
                +{detail.additions.toLocaleString()}
              </span>
              <span className="pr-review-change-stat" data-change="deletion">
                -{detail.deletions.toLocaleString()}
              </span>
              <span className="pr-review-comment-stat">
                <MessageSquare size={11} /> {detail.comments} comments
              </span>
              <span>
                {detail.reviews.length} {detail.reviews.length === 1 ? 'review' : 'reviews'}
              </span>
            </span>
            <button
              className="btn-subtle btn-compact pr-review-overview-copy-link"
              type="button"
              onClick={copyGitGudLink}
            >
              <Link2 size={12} />
              Copy Git Gud link
            </button>
          </div>
          {hasMergeConflicts ? (
            <PullRequestConflictPanel
              baseRefName={detail.baseRefName}
              headRefName={detail.headRefName}
              hasLocalCheckout={Boolean(codexRepoPath)}
              details={conflictDetailsQuery.data}
              isLoading={conflictDetailsQuery.isLoading}
              errorMessage={
                conflictDetailsQuery.error instanceof Error
                  ? conflictDetailsQuery.error.message
                  : undefined
              }
              isOpen={isConflictPanelOpen}
              onToggle={() => setIsConflictPanelOpen((current) => !current)}
            />
          ) : null}
          <div className="pr-review-overview-body">
            <div className="pr-review-overview-main">
              <section className="pr-review-description" aria-labelledby="pr-review-description-heading">
                <h2 id="pr-review-description-heading">Description</h2>
                <ReviewCommentBody
                  body={detail.body || 'No pull request description was provided.'}
                  imageUrls={detail.bodyImageUrls}
                  imageLoading="eager"
                  onOpenImage={setImageGallery}
                />
              </section>
            </div>
            <section className="pr-review-timeline" aria-labelledby="pr-review-timeline-heading">
              <h2 id="pr-review-timeline-heading">
                Timeline
                <span>{timeline.length}</span>
              </h2>
              <div>
                {timeline.length > 0 ? (
                  timeline.map((entry) => (
                    <PullRequestTimelineItem
                      entry={entry}
                      key={entry.key}
                      onOpenCommit={onOpenCommit}
                    />
                  ))
                ) : (
                  <p className="pr-review-timeline-empty">No activity has been reported yet.</p>
                )}
              </div>
            </section>
          </div>
        </section>
      ) : null}

      {reviewDrafts.length > 0 ? (
        <button
          className="pr-review-draft-bar"
          type="button"
          onClick={() => setIsReviewDialogOpen(true)}
        >
          <span className="pr-review-draft-icon">
            <Clock3 size={13} />
          </span>
          <span>
            <strong>
              {reviewDrafts.length} draft {reviewDrafts.length === 1 ? 'comment' : 'comments'}
            </strong>
            <small>Saved locally · nothing has been posted to GitHub</small>
          </span>
          <span className="pr-review-draft-action">
            Finish review
            <CornerDownRight size={12} />
          </span>
        </button>
      ) : null}

      <div className="pr-focused-review">
        <ReviewView
          repoPath={detail.reviewPlan.repoPath}
          target={detail.reviewPlan.target}
          plan={detail.reviewPlan}
          reviewGuideProvider={reviewGuideProvider}
          reviewProgressKey={detail.reviewPlan.targetKey}
          lineComments={displayedLineComments}
          onAddDraftLineComment={addDraftLineComment}
          onAddDraftFileComment={addDraftFileComment}
          onAddDraftReply={addDraftReply}
          onUpdateComment={updateComment}
          onRemoveDraftComment={removeDraft}
          diffStyle={diffStyle}
          diffSyntaxTheme={diffSyntaxTheme}
          onSetDiffStyle={onSetDiffStyle}
          onClose={onClose}
          showCloseButton={false}
        />
      </div>

      {isReviewDialogOpen ? (
        <ReviewSubmissionDialog
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
      ) : null}
      {isMergeDialogOpen ? (
        <MergePullRequestDialog
          pullRequest={detail}
          isMerging={mergeMutation.isPending}
          onClose={() => setIsMergeDialogOpen(false)}
          onMerge={(method) => mergeMutation.mutate(method)}
        />
      ) : null}
      {imageGallery ? (
        <ReviewImageGalleryDialog
          selection={imageGallery}
          onClose={() => setImageGallery(undefined)}
        />
      ) : null}
    </section>
  );
}

function PullRequestTimelineItem({
  entry,
  onOpenCommit
}: {
  entry: PullRequestTimelineEntry;
  onOpenCommit?: (sha: string) => void;
}): ReactElement {
  if (entry.kind === 'commit') {
    const subject = entry.commit.message.split('\n', 1)[0] || 'Untitled commit';

    return (
      <article className="pr-timeline-event" data-kind="commit">
        <TimelineAvatar
          author={entry.commit.author}
          authorAvatarUrl={entry.commit.authorAvatarUrl}
        />
        <div className="pr-timeline-event-content">
          <header>
            <span>
              <strong>{entry.commit.author}</strong>
              committed
            </span>
            <a href={entry.commit.url} target="_blank" rel="noreferrer">
              <time dateTime={entry.createdAt}>{formatDiscussionDate(entry.createdAt)}</time>
              <ExternalLink size={10} />
            </a>
          </header>
          <div className="pr-timeline-commit">
            <a href={entry.commit.url} target="_blank" rel="noreferrer" title={subject}>
              {subject}
            </a>
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
          </div>
        </div>
      </article>
    );
  }

  if (entry.kind === 'conversation') {
    return (
      <article className="pr-timeline-event" data-kind="conversation">
        <TimelineAvatar
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
          <ReviewCommentBody body={entry.comment.body} />
        </div>
      </article>
    );
  }

  if (entry.kind === 'review-thread') {
    return (
      <article className="pr-timeline-event" data-kind="review-thread">
        <TimelineAvatar
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
            <ReviewTimelineThread thread={entry.thread} />
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="pr-timeline-event" data-kind="review" data-state={entry.review.state}>
      <TimelineAvatar
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
        {entry.review.body.trim() ? <ReviewCommentBody body={entry.review.body} /> : null}
        {entry.threads.length > 0 ? (
          <div className="pr-timeline-review-threads">
            {entry.threads.map((thread) => (
              <ReviewTimelineThread thread={thread} key={thread.root.id} />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function TimelineAvatar({
  author,
  authorAvatarUrl,
  compact = false
}: {
  author: string;
  authorAvatarUrl?: string;
  compact?: boolean;
}): ReactElement {
  const [didAvatarFail, setDidAvatarFail] = useState(false);

  if (authorAvatarUrl && !didAvatarFail) {
    return (
      <img
        className="pr-timeline-avatar"
        data-compact={compact}
        src={authorAvatarUrl}
        alt=""
        aria-hidden="true"
        referrerPolicy="no-referrer"
        onError={() => setDidAvatarFail(true)}
      />
    );
  }

  return (
    <span className="pr-timeline-avatar" data-compact={compact} aria-hidden="true">
      {author.slice(0, 1).toUpperCase()}
    </span>
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
  thread
}: {
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
        <ReviewTimelineThreadMessage comment={thread.root} />
        {thread.replies.map((reply) => (
          <ReviewTimelineThreadMessage comment={reply} isReply key={reply.id} />
        ))}
      </div>
    </article>
  );
}

function ReviewTimelineThreadMessage({
  comment,
  isReply = false
}: {
  comment: GitHubPullRequestDetail['reviewComments'][number];
  isReply?: boolean;
}): ReactElement {
  return (
    <div className="pr-timeline-thread-message" data-reply={isReply}>
      <TimelineAvatar
        author={comment.author}
        authorAvatarUrl={comment.authorAvatarUrl}
        compact
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
        <ReviewCommentBody body={comment.body} />
      </div>
    </div>
  );
}

function ReviewSubmissionDialog({
  drafts,
  isSubmitting,
  isCopyingPrompt,
  errorMessage,
  onRemoveDraft,
  onClose,
  onCopyPrompt,
  onSubmit
}: {
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
  const [event, setEvent] = useState<ReviewEvent>('comment');
  const [body, setBody] = useState('');
  const requiresBody = isReviewSummaryRequired(event, drafts.length);
  const hasPromptContext = drafts.length > 0 || body.trim().length > 0;
  const isBusy = isSubmitting || isCopyingPrompt;

  function handleSubmit(submitEvent: FormEvent<HTMLFormElement>): void {
    submitEvent.preventDefault();
    if (requiresBody && !body.trim()) {
      return;
    }
    onSubmit(event, body.trim());
  }

  return (
    <ModalSurface
      labelledBy={titleId}
      className="pr-action-dialog"
      onClose={isBusy ? () => undefined : onClose}
    >
      <form onSubmit={handleSubmit}>
        <header>
          <ShieldCheck size={17} />
          <h2 id={titleId}>Finish review</h2>
          <button className="icon-btn icon-btn-compact" type="button" disabled={isBusy} onClick={onClose} aria-label="Close review dialog">
            <X size={14} />
          </button>
        </header>
        <div className="pr-action-dialog-body">
          <div>
            <span className="pr-action-field-label">GitHub review decision</span>
            <div className="pr-review-decision-options" role="group" aria-label="GitHub review decision">
              {([
                ['comment', 'Send comments', MessageSquare],
                ['approve', 'Approve', CheckCircle2],
                ['request-changes', 'Request changes', AlertTriangle]
              ] as const).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  disabled={isBusy}
                  data-active={event === value}
                  aria-pressed={event === value}
                  onClick={() => setEvent(value)}
                >
                  <Icon size={13} />
                  {label}
                </button>
              ))}
            </div>
          </div>
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
                      {draft.kind === 'line'
                        ? <MessageSquare size={11} />
                        : draft.kind === 'file'
                          ? <FileText size={11} />
                          : <CornerDownRight size={11} />}
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
            <span>
              {requiresBody ? 'Review summary' : 'Review summary (optional)'}
            </span>
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
          <button className="btn-subtle btn-regular" type="button" disabled={isBusy} onClick={onClose}>Cancel</button>
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
          <button className="btn-primary btn-regular" type="submit" disabled={isBusy || (requiresBody && !body.trim())}>
            {isSubmitting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            {reviewSubmitLabel(event, drafts.length)}
          </button>
        </footer>
      </form>
    </ModalSurface>
  );
}

function MergePullRequestDialog({
  pullRequest,
  isMerging,
  onClose,
  onMerge
}: {
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
    <ModalSurface labelledBy={titleId} className="pr-action-dialog" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onMerge(method);
        }}
      >
        <header>
          <GitMerge size={17} />
          <h2 id={titleId}>Merge pull request #{pullRequest.number}</h2>
          <button className="icon-btn icon-btn-compact" type="button" onClick={onClose} aria-label="Close merge dialog">
            <X size={14} />
          </button>
        </header>
        <div className="pr-action-dialog-body">
          <p className="pr-merge-warning">
            This writes to {pullRequest.owner}/{pullRequest.repository} and cannot be undone from Git Gud.
          </p>
          {hasMultipleMethods ? (
            <label>
              <span>Merge method</span>
              <select value={method} onChange={(event) => setMethod(normalizeMergeMethod(event.target.value))}>
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
          <button className="btn-subtle btn-regular" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary btn-regular" type="submit" disabled={isMerging}>
            {isMerging ? <Loader2 size={13} className="animate-spin" /> : <GitMerge size={13} />}
            {mergeMethodLabel(method)}
          </button>
        </footer>
      </form>
    </ModalSurface>
  );
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
  const checksTone =
    detail.checks.state === 'success'
      ? 'success'
      : detail.checks.state === 'failure' || detail.checks.state === 'error'
        ? 'danger'
        : 'pending';
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
          <PullRequestReviewerAvatars reviewers={detail.reviewers} />
          <AlertTriangle size={12} />
          {reviewStatus.label}
          <ChevronRight size={11} aria-hidden="true" />
        </button>
      ) : (
        <span data-tone={reviewStatus.tone}>
          <PullRequestReviewerAvatars reviewers={detail.reviewers} />
          {reviewStatus.icon === 'check'
            ? <Check size={12} />
            : reviewStatus.icon === 'warning'
              ? <AlertTriangle size={12} />
              : <CircleDot size={11} />}
          {reviewStatus.label}
        </span>
      )}
      <span data-tone={checksTone}>
        {checksTone === 'success' ? <Check size={12} /> : checksTone === 'danger' ? <AlertTriangle size={12} /> : <CircleDot size={11} />}
        {detail.checks.total > 0
          ? `${detail.checks.passed}/${detail.checks.total} checks passed`
          : 'No checks reported'}
      </span>
    </>
  );
}

function PullRequestConflictPanel({
  baseRefName,
  headRefName,
  hasLocalCheckout,
  details,
  isLoading,
  errorMessage,
  isOpen,
  onToggle
}: {
  baseRefName: string;
  headRefName: string;
  hasLocalCheckout: boolean;
  details?: GitHubPullRequestConflictDetails;
  isLoading: boolean;
  errorMessage?: string;
  isOpen: boolean;
  onToggle: () => void;
}): ReactElement {
  const conflictFiles = details?.files ?? [];
  const fileCount = conflictFiles.length;
  const summary = !hasLocalCheckout
    ? 'Local checkout unavailable'
    : isLoading
      ? 'Inspecting local checkout…'
      : errorMessage || details?.unavailableReason
        ? 'File details unavailable'
        : fileCount > 0
          ? `${fileCount} conflicting ${fileCount === 1 ? 'file' : 'files'}`
          : 'Local revisions merge cleanly';

  return (
    <section
      className="pr-review-conflict-panel"
      id="pr-review-conflict-panel"
      aria-labelledby="pr-review-conflict-heading"
      data-open={isOpen}
    >
      <button
        className="pr-review-conflict-summary"
        type="button"
        aria-expanded={isOpen}
        aria-controls="pr-review-conflict-details"
        onClick={onToggle}
      >
        <AlertTriangle size={15} aria-hidden="true" />
        <span>
          <strong id="pr-review-conflict-heading">Resolve merge conflicts before merging</strong>
          <small>{summary}</small>
        </span>
        <ChevronRight size={13} aria-hidden="true" />
      </button>
      {isOpen ? (
        <div className="pr-review-conflict-details" id="pr-review-conflict-details">
          <p>
            <strong>{headRefName}</strong> and <strong>{baseRefName}</strong> contain overlapping
            changes that GitHub cannot combine automatically.
          </p>
          {!hasLocalCheckout ? (
            <small>Open this repository locally to inspect the affected files.</small>
          ) : isLoading ? (
            <small className="pr-review-conflict-loading">
              <Loader2 size={11} className="animate-spin" />
              Inspecting the local checkout…
            </small>
          ) : errorMessage ? (
            <small>Could not inspect the conflicting files: {errorMessage}</small>
          ) : details?.unavailableReason ? (
            <small>
              {details.unavailableReason} Fetch both branches locally, then reopen this overview.
            </small>
          ) : fileCount > 0 ? (
            <ul aria-label="Conflicting files">
              {conflictFiles.map((path) => (
                <li key={path}><code>{path}</code></li>
              ))}
            </ul>
          ) : (
            <small>
              These local revisions merge cleanly. Refresh the pull request to update GitHub’s
              conflict status.
            </small>
          )}
        </div>
      ) : null}
    </section>
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
