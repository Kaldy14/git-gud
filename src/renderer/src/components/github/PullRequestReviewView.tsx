import type { ReactElement, UIEvent } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';

import type { DiffStyle } from '@renderer/components/commit/fileDetailUtils';
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
  gitHubPullRequestDetailQueryKey,
  gitHubPullRequestInboxQueryKey,
  refreshGitHubPullRequestInboxAfterMerge,
  useGitHubPullRequestDetail,
  useGitHubPullRequestInbox,
  useGitHubPullRequestReviewPlan
} from '@renderer/queries/github';
import type {
  DiffSyntaxTheme,
  GitHubPullRequestDetail,
  GitHubPullRequestMergeMethod,
  GitHubPullRequestSummary
} from '@shared/types';

import { BugFinderButton } from './BugFinderButton';
import { BugFinderView } from './BugFinderView';
import { PullRequestConversationControls, PullRequestConversationTab, useActivityPreferences } from './conversation/PullRequestConversationTab';
import { PullRequestOverviewTab, type PullRequestNotice } from './overview/PullRequestOverviewTab';
import { copyPullRequestCodexPrompt } from './pullRequestCodexPrompt';
import { PullRequestDetailHeader, PullRequestDetailTabs } from './PullRequestDetailTabs';
import {
  diffTabFor,
  pullRequestDetailPanelProps,
  refusesTabChange,
  type DiffTab,
  type PullRequestDetailTab
} from './pullRequestDetailTab';
import { PullRequestHeaderActions } from './PullRequestHeaderActions';
import {
  hasNewPullRequestActivity,
  heldRevisionNotice,
  isSameRevision,
  overlayLivePullRequest,
  pickShownDetail
} from './pullRequestLiveDetail';
import { hasPullRequestMergeConflicts } from './pullRequestInboxStatus';
import { mergeMethodLabel, PullRequestMergeDialog } from './PullRequestMergeDialog';
import type { PullRequestCodeLocation } from './pullRequestNavigation';
import { PullRequestRefreshControl } from './PullRequestRefreshControl';
import { pullRequestMergeVerdict } from './overview/pullRequestMergeVerdict';
import { PullRequestLoadPhase, PullRequestReviewLoading, ReviewMessage } from './PullRequestReviewLoading';
import {
  loadPullRequestReviewDrafts,
  removeSubmittedDraftsFromStorage,
  savePullRequestReviewDrafts,
  type NewPullRequestReviewDraft,
  type PullRequestReviewDraft,
  type ReviewEvent
} from './pullRequestReviewDrafts';
import { PullRequestReviewStatus } from './PullRequestReviewStatus';
import { beginReviewSubmission, isReviewSubmissionInFlight, useReviewSubmissionInFlight } from './pullRequestReviewSubmission';
import { PullRequestReviewSubmissionDialog } from './PullRequestReviewSubmissionDialog';
import { buildPullRequestTimeline } from './pullRequestTimeline';
import { pullRequestLocator, usePullRequestTour } from './tour/pullRequestTourQuery';
import { PullRequestTourTab } from './tour/PullRequestTourTab';
import { COMPOSER_OPEN_NOTICE } from './tour/pullRequestTourWalk';
import { useTourDiffSurface } from './tour/useTourDiffSurface';
import { useHasUnsavedText, useReportUnsavedText } from './workspace/pullRequestLeaveGuard';

type PullRequestReviewViewProps = {
  pullRequest: GitHubPullRequestSummary;
  codexRepoPath?: string;
  // The workspace owns the tab, so it stays put while pull requests change.
  tab: PullRequestDetailTab;
  // Returns whether the tab changed (false when it was already open or the change was refused).
  onTabChange: (tab: PullRequestDetailTab) => boolean;
  // The workspace asks the open pull request before any tab change (click, H/L, a link) and keeps the
  // tab where it is when the guard returns false.
  registerTabGuard?: (guard: ((next: PullRequestDetailTab) => boolean) | undefined) => void;
  // Tells the workspace whether Tour shows the diff, so the shortcut bar lists only keys that work.
  onTourUsableChange?: (usable: boolean) => void;
  initialBugFinderOpen?: boolean;
  diffStyle: DiffStyle;
  diffSyntaxTheme: DiffSyntaxTheme;
  onSetDiffStyle: (style: DiffStyle) => void;
  onBackToInbox: () => void;
  onOpenCommit?: (sha: string) => void;
  onClose: () => void;
  onMerged: () => void;
};

/** One open pull request: loads its detail and shows the loading, error or loaded view. */
export function PullRequestReviewView(props: PullRequestReviewViewProps): ReactElement {
  const { pullRequest, tab, onBackToInbox, onClose } = props;
  const locator = pullRequestLocator(pullRequest);
  const detailQuery = useGitHubPullRequestDetail(locator);
  const inboxQuery = useGitHubPullRequestInbox(locator.profileId, 'interactive');
  // Only a row actually in the inbox describes the pull request now; the row as it was when clicked does not.
  const livePullRequest = inboxQuery.data?.pullRequests.find(
    (candidate) =>
      candidate.owner === locator.owner &&
      candidate.repository === locator.repository &&
      candidate.number === locator.number
  );
  // A fetch that brings a new revision would remount every editor and hide the drafts stored for the shown
  // head, so it waits while any text is unsaved or any draft is pending. Drafts are not unsaved text:
  // leaving keeps them, so they hold the revision without asking before the reader leaves.
  const hasUnsavedText = useHasUnsavedText();
  const [hasPendingDrafts, setHasPendingDrafts] = useState(false);
  const [shownDetail, setShownDetail] = useState(detailQuery.data);
  const nextShownDetail = pickShownDetail(shownDetail, detailQuery.data, { hasUnsavedText, hasPendingDrafts });
  if (nextShownDetail !== shownDetail) setShownDetail(nextShownDetail);
  const initialDetail = nextShownDetail;
  const isRevisionHeld = Boolean(initialDetail && detailQuery.data && !isSameRevision(detailQuery.data, initialDetail));
  const reviewPlanQuery = useGitHubPullRequestReviewPlan(locator, initialDetail?.headSha, initialDetail?.baseSha);
  const inboxLoadedAt = inboxQuery.data?.loadedAt;
  const detail = useMemo(
    () => initialDetail
      ? {
          ...overlayLivePullRequest(initialDetail, { row: livePullRequest, loadedAt: inboxLoadedAt }),
          reviewPlan: reviewPlanQuery.data ?? initialDetail.reviewPlan
        }
      : undefined,
    [initialDetail, livePullRequest, inboxLoadedAt, reviewPlanQuery.data]
  );
  // Lives above the keyed content so a message survives the remount when a refresh brings a new head.
  const [notice, setNotice] = useState<PullRequestNotice>();
  const [skeletonFor, setSkeletonFor] = useState<string>();
  const clearSkeleton = useCallback(() => setSkeletonFor(undefined), []);
  const heldNotice = isRevisionHeld ? heldRevisionNotice({ hasUnsavedText, hasPendingDrafts }) : undefined;
  const [shownHeldNotice, setShownHeldNotice] = useState<string>();
  if (shownHeldNotice !== heldNotice) {
    setShownHeldNotice(heldNotice);
    if (heldNotice) setNotice({ tone: 'danger', message: heldNotice });
    else if (notice?.message === shownHeldNotice) setNotice(undefined);
  }

  const refreshPullRequest = (): void => {
    // Joins a fetch that is already running instead of cancelling and restarting it.
    void Promise.all([inboxQuery.refetch({ cancelRefetch: false }), detailQuery.refetch({ cancelRefetch: false })]);
  };

  // The loaded view fades in only where it replaces the skeleton. A pull request that was already
  // cached appears at once, so J/K through the list never blinks.
  const arrivalKey = `${locator.owner}/${locator.repository}#${locator.number}`;
  const isLoadingFirst = detailQuery.isLoading && !detail;
  if (isLoadingFirst ? skeletonFor !== arrivalKey : skeletonFor !== undefined && skeletonFor !== arrivalKey) {
    setSkeletonFor(isLoadingFirst ? arrivalKey : undefined);
  }

  if (isLoadingFirst) {
    const viewer = inboxQuery.data?.viewerLogin;
    return <PullRequestReviewLoading pullRequest={pullRequest} tab={tab} isOwn={viewer?.toLowerCase() === pullRequest.author.toLowerCase()} onAction={onBackToInbox} onClose={onClose} />;
  }

  if (!detail) {
    return (
      <ReviewMessage
        icon={<AlertTriangle size={20} />}
        text={detailQuery.error instanceof Error ? detailQuery.error.message : 'The pull request is unavailable.'}
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
      {...props}
      key={detail.reviewPlan.targetKey}
      detail={detail}
      notice={notice}
      onNotice={setNotice}
      isReviewPlanEnriching={reviewPlanQuery.isFetching && !reviewPlanQuery.data}
      arrivedFromSkeleton={skeletonFor === arrivalKey}
      onArrived={clearSkeleton}
      isRefreshing={inboxQuery.isFetching || (detailQuery.isFetching && !detailQuery.isLoading)}
      onPendingDraftsChange={setHasPendingDrafts}
      hasNewActivity={isRevisionHeld || Boolean(initialDetail && hasNewPullRequestActivity(initialDetail, { row: livePullRequest, loadedAt: inboxLoadedAt }))}
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

type PullRequestReviewContentProps = PullRequestReviewViewProps & {
  detail: GitHubPullRequestDetail;
  notice?: PullRequestNotice;
  onNotice: (notice: PullRequestNotice | undefined) => void;
  // Whether the shown head has local review drafts not yet submitted.
  onPendingDraftsChange: (hasPendingDrafts: boolean) => void;
  isReviewPlanEnriching: boolean;
  arrivedFromSkeleton: boolean;
  /** The arrival fade has played: it must not play again for a new head or after the bug scan closes. */
  onArrived: () => void;
  isRefreshing: boolean;
  hasNewActivity: boolean;
  refreshErrorMessage?: string;
  lastRefreshedAt: string;
  onRefresh: () => void;
};

/** The loaded pull request: tab state, drafts, mutations and dialogs; each tab renders its own pane. */
function PullRequestReviewContent({
  detail,
  codexRepoPath,
  tab: detailTab,
  onTabChange,
  registerTabGuard,
  onTourUsableChange,
  initialBugFinderOpen,
  diffStyle,
  diffSyntaxTheme,
  onSetDiffStyle,
  onBackToInbox,
  onOpenCommit,
  onClose,
  onMerged,
  notice,
  onNotice: setNotice,
  onPendingDraftsChange,
  isReviewPlanEnriching,
  arrivedFromSkeleton,
  onArrived,
  isRefreshing,
  hasNewActivity,
  refreshErrorMessage,
  lastRefreshedAt,
  onRefresh
}: PullRequestReviewContentProps): ReactElement {
  const queryClient = useQueryClient();
  const locator = pullRequestLocator(detail);
  const [bugFinderOpen, setBugFinderOpen] = useState(initialBugFinderOpen ?? false);
  // One request at a time for the shared diff surface (Tour points, Tour files, Overview threads).
  const [navigation, setNavigation] = useState<PullRequestCodeLocation & { signal: number }>();
  const [commentRequest, setCommentRequest] = useState<{ commentId: number; signal: number }>();
  // Panes mount on first visit and then stay mounted (hidden), so switching pull requests only pays
  // for the tab on screen while drafts and scroll still survive tab switches.
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<PullRequestDetailTab>>(() => new Set([detailTab]));
  const [previousTab, setPreviousTab] = useState(detailTab);
  if (previousTab !== detailTab) {
    setPreviousTab(detailTab);
    setVisitedTabs((current) => new Set([...current, detailTab]));
  }
  const visited = (tab: PullRequestDetailTab) => visitedTabs.has(tab) || tab === detailTab;
  // GitHub image URLs expire; reload them when the conversation shows again.
  useEffect(() => {
    if (
      detailTab === 'conversation' &&
      Object.keys(detail.bodyImageUrls ?? {}).length > 0 &&
      Date.now() - Date.parse(detail.loadedAt) >= 4 * 60 * 1_000
    ) {
      onRefresh();
    }
    // Only a tab change should trigger the reload, not a new detail object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailTab]);
  // Scrolling a pane past the title condenses the header. Hidden panes keep their scroll
  // position, so the state is remembered per tab.
  const [condensedTabs, setCondensedTabs] = useState<Partial<Record<PullRequestDetailTab, boolean>>>({});
  const [activityPreferences, setActivityPreferences] = useActivityPreferences();
  const [isConflictPanelOpen, setIsConflictPanelOpen] = useState(false);
  const [isReviewDialogOpen, setIsReviewDialogOpen] = useState(false);
  const [isMergeDialogOpen, setIsMergeDialogOpen] = useState(false);
  const [reviewEvent, setReviewEvent] = useState<ReviewEvent>('comment');
  const [reviewSubmissionKey, setReviewSubmissionKey] = useState(0);
  const [imageGallery, setImageGallery] = useState<ReviewImageGallerySelection>();
  const draftStorageKey = `git-gud:pr-review-drafts:${detail.reviewPlan.targetKey}`;
  const [reviewDrafts, setReviewDrafts] = useState<PullRequestReviewDraft[]>(() =>
    loadPullRequestReviewDrafts(window.localStorage, draftStorageKey)
  );
  // A submission of these drafts may still run from a view the reader left; this view must not send them
  // again, and takes what that submission left in storage once it settles.
  const isSubmissionInFlight = useReviewSubmissionInFlight(draftStorageKey);
  const [wasSubmissionInFlight, setWasSubmissionInFlight] = useState(isSubmissionInFlight);
  if (wasSubmissionInFlight !== isSubmissionInFlight) {
    setWasSubmissionInFlight(isSubmissionInFlight);
    if (!isSubmissionInFlight) setReviewDrafts(loadPullRequestReviewDrafts(window.localStorage, draftStorageKey));
  }
  const [reviewHasUnsavedText, setReviewHasUnsavedText] = useState(false);
  useReportUnsavedText(reviewHasUnsavedText);
  // A layout effect, so adding a comment reports its draft before the closed composer reports no unsaved
  // text (a passive effect); otherwise a held revision would slip through between the two.
  const hasPendingDrafts = reviewDrafts.length > 0;
  useLayoutEffect(() => { onPendingDraftsChange(hasPendingDrafts); }, [onPendingDraftsChange, hasPendingDrafts]);

  const tour = usePullRequestTour(detail);
  const selectDetailTab = onTabChange;

  // Tour and Code share one ReviewView; `diffTab` is which of them it shows (the last one shown while a
  // reading tab is open). While a comment composer is open, moving between them would hide the composer,
  // so the workspace's tab guard refuses that change before the tab moves.
  const tourUsable = Boolean(tour.tour?.stops.length);
  const [lineComposerOpen, setComposerOpen] = useState(false);
  // A typed reply or comment edit is lost just like an open composer when its file leaves the scope.
  const composerOpen = lineComposerOpen || reviewHasUnsavedText;
  const [diffTab, setDiffTab] = useState<DiffTab>(detailTab === 'tour' ? 'tour' : 'code');
  const requestedDiffTab = diffTabFor(detailTab, tourUsable);
  if (requestedDiffTab !== undefined && requestedDiffTab !== diffTab) setDiffTab(requestedDiffTab);
  const refuseTabChange = useCallback((next: PullRequestDetailTab): boolean => {
    if (!refusesTabChange(next, { diffTab, composerOpen, tourUsable })) return false;
    setNotice({ tone: 'danger', message: COMPOSER_OPEN_NOTICE });
    return true;
  }, [diffTab, composerOpen, tourUsable, setNotice]);
  useEffect(() => { onTourUsableChange?.(tourUsable); }, [onTourUsableChange, tourUsable]);
  useLayoutEffect(() => {
    registerTabGuard?.((next) => !refuseTabChange(next));
    return () => registerTabGuard?.(undefined);
  }, [registerTabGuard, refuseTabChange]);
  const isDiffVisible = requestedDiffTab !== undefined;
  const isDiffActive = isDiffVisible && !isReviewDialogOpen && !isMergeDialogOpen && !imageGallery && !bugFinderOpen;
  const diffPaneRef = useRef<HTMLDivElement>(null);

  const navigate = useCallback((location: PullRequestCodeLocation) => {
    setNavigation((current) => ({ ...location, signal: (current?.signal ?? 0) + 1 }));
  }, []);

  function openCode(location: PullRequestCodeLocation): void {
    if (refuseTabChange('code')) return;
    selectDetailTab('code');
    navigate(location);
  }

  const tourSurface = useTourDiffSurface({
    detail,
    tourState: tour,
    diffTab,
    visible: isDiffVisible,
    active: isDiffActive,
    composerOpen,
    paneRef: diffPaneRef,
    onShowTour: () => selectDetailTab('tour'),
    onNavigate: navigate,
    onOpenCode: openCode,
    onFinishReview: () => openDialog('review'),
    onNotice: setNotice
  });

  function openConversation(commentId?: number): void {
    selectDetailTab('conversation');
    if (commentId !== undefined) setCommentRequest((current) => ({ commentId, signal: (current?.signal ?? 0) + 1 }));
  }

  function openDialog(dialog: 'review' | 'merge'): void {
    setIsReviewDialogOpen(dialog === 'review');
    setIsMergeDialogOpen(dialog === 'merge');
  }

  function toggleConflicts(): void {
    if (detailTab !== 'overview') {
      selectDetailTab('overview');
      setIsConflictPanelOpen(true);
      return;
    }
    setIsConflictPanelOpen((current) => !current);
  }

  function trackPaneScroll(event: UIEvent<HTMLDivElement>): void {
    const target = event.target;
    // Horizontal code scrollers report scrollTop 0; only vertical scrollers count.
    if (!(target instanceof HTMLElement) || target.scrollHeight <= target.clientHeight) return;
    // Hysteresis keeps the header from flickering around the threshold.
    const condensed = target.scrollTop > 48 ? true : target.scrollTop <= 4 ? false : undefined;
    if (condensed === undefined || (condensedTabs[detailTab] ?? false) === condensed) return;
    setCondensedTabs((current) => ({ ...current, [detailTab]: condensed }));
  }

  const hasMergeConflicts = hasPullRequestMergeConflicts(detail);
  const isOwnPullRequest = detail.author.toLowerCase() === detail.viewerLogin.toLowerCase();
  // Code and Tour open folded so the diff gets the height; the status then rides beside the tabs.
  const isHeaderCondensed = !bugFinderOpen && (detailTab === 'code' || detailTab === 'tour' || condensedTabs[detailTab] === true);
  const timeline = useMemo(
    () => buildPullRequestTimeline({
      commits: detail.commitTimeline,
      conversationComments: detail.conversationComments,
      reviews: detail.reviews,
      reviewComments: detail.reviewComments
    }),
    [detail.commitTimeline, detail.conversationComments, detail.reviewComments, detail.reviews]
  );
  const discussionCount = timeline.filter((entry) => entry.kind !== 'commit').length;

  const displayedLineComments = useMemo<ReviewLineComment[]>(() => {
    const published: ReviewLineComment[] = detail.reviewComments.map((comment) => ({
      ...comment,
      canEdit: comment.author === detail.viewerLogin
    }));
    const commentById = new Map(detail.reviewComments.map((comment) => [comment.id, comment]));
    const drafts = reviewDrafts.flatMap<ReviewLineComment>((draft) => {
      const base = { id: draft.id, body: draft.body, author: detail.viewerLogin, createdAt: draft.createdAt, isDraft: true };
      if (draft.kind === 'line') return [{ ...base, path: draft.path, subjectType: 'line', line: draft.line, side: draft.side }];
      if (draft.kind === 'file') return [{ ...base, path: draft.path, subjectType: 'file' }];
      const parent = commentById.get(draft.inReplyToId);
      return parent ? [{
        ...base,
        path: parent.path,
        subjectType: parent.subjectType,
        line: parent.line,
        side: parent.side,
        inReplyToId: draft.inReplyToId
      }] : [];
    });
    return [...published, ...drafts];
  }, [detail.reviewComments, detail.viewerLogin, reviewDrafts]);

  function updateReviewDrafts(updater: (current: PullRequestReviewDraft[]) => PullRequestReviewDraft[]): void {
    setReviewDrafts((current) => {
      const next = updater(current);
      savePullRequestReviewDrafts(window.localStorage, draftStorageKey, next);
      return next;
    });
  }

  function addDraft(draft: NewPullRequestReviewDraft, message: string): void {
    updateReviewDrafts((current) => [
      ...current,
      { ...draft, id: window.crypto.randomUUID(), createdAt: new Date().toISOString() }
    ]);
    setNotice({ tone: 'success', message });
  }

  const invalidatePullRequest = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: gitHubPullRequestDetailQueryKey(locator) }),
      queryClient.invalidateQueries({ queryKey: gitHubPullRequestInboxQueryKey(locator.profileId) })
    ]);
  };
  const reviewMutation = useMutation({
    mutationFn: async (event: { event: ReviewEvent; body: string }) => {
      if (isReviewSubmissionInFlight(draftStorageKey)) throw new Error('This review is still being submitted.');
      const submittedDraftIds = new Set(reviewDrafts.map((draft) => draft.id));
      const endSubmission = beginReviewSubmission(draftStorageKey);
      try {
        const result = await window.api.submitGitHubPullRequestReview({
          ...locator,
          ...event,
          commitId: detail.headSha,
          comments: reviewDrafts.flatMap((draft) => draft.kind === 'line'
            ? [{ id: draft.id, body: draft.body, path: draft.path, line: draft.line, side: draft.side, startLine: draft.startLine, startSide: draft.startSide }]
            : []),
          fileComments: reviewDrafts.flatMap((draft) => draft.kind === 'file' ? [{ id: draft.id, body: draft.body, path: draft.path }] : []),
          replies: reviewDrafts.flatMap((draft) => draft.kind === 'reply' ? [{ id: draft.id, body: draft.body, inReplyToId: draft.inReplyToId }] : [])
        });
        // Storage is cleaned before the submission counts as settled: this component may have unmounted
        // (the reader left while the request ran), and a reopened view reloads from storage at that moment.
        const remainingDrafts = removeSubmittedDraftsFromStorage(
          window.localStorage, draftStorageKey, submittedDraftIds, new Set(result.failedDraftIds ?? [])
        );
        return { result, remainingDrafts };
      } finally {
        endSubmission();
      }
    },
    onSuccess: async ({ result, remainingDrafts }) => {
      const failedDraftIds = new Set(result.failedDraftIds ?? []);
      setReviewDrafts(remainingDrafts);
      setNotice({ tone: failedDraftIds.size > 0 ? 'danger' : 'success', message: result.message });
      setIsReviewDialogOpen(false);
      setReviewSubmissionKey((key) => key + 1);
      await invalidatePullRequest();
    },
    onError: (error) => {
      setNotice({ tone: 'danger', message: error instanceof Error ? error.message : 'Could not submit the review.' });
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
    mutationFn: (summary: string) => copyPullRequestCodexPrompt(detail, reviewDrafts, summary, navigator.clipboard),
    onSuccess: () => {
      setNotice({ tone: 'success', message: 'Review prompt copied. Your draft comments are still local and were not posted to GitHub.' });
      setIsReviewDialogOpen(false);
    }
  });
  const mergeMutation = useMutation({
    mutationFn: (method: GitHubPullRequestMergeMethod) => {
      if (hasMergeConflicts) throw new Error('Resolve merge conflicts before merging this pull request.');
      // Bound to the head on screen: GitHub rejects the merge if someone pushed since.
      return window.api.mergeGitHubPullRequest({ ...locator, method, headSha: detail.headSha });
    },
    onSuccess: async (result) => {
      setNotice({ tone: 'success', message: result.message });
      onMerged();
      await refreshGitHubPullRequestInboxAfterMerge(queryClient, locator);
    },
    onError: (error) => {
      setNotice({ tone: 'danger', message: error instanceof Error ? error.message : 'Could not merge the pull request.' });
      // A rejected merge often means the pull request changed (a new head, a new blocker); show what is current.
      onRefresh();
    }
  });

  function removeDraft(id: string): void {
    updateReviewDrafts((current) => current.filter((draft) => draft.id !== id));
  }

  // The arrival fade is spent after its 180ms whether or not it ran (reduced motion, or the bug scan
  // covering the pane mid-fade), so nothing can make it play later.
  useEffect(() => {
    if (!arrivedFromSkeleton) return;
    const timer = window.setTimeout(onArrived, 220);
    return () => window.clearTimeout(timer);
  }, [arrivedFromSkeleton, onArrived]);

  const continuityIdentity = useMemo(() => ({
    key: JSON.stringify([detail.profileId, detail.reviewPlan.repoPath, detail.number]),
    headSha: detail.headSha,
    baseSha: detail.baseSha
  }), [detail.profileId, detail.reviewPlan.repoPath, detail.number, detail.headSha, detail.baseSha]);

  // The status has one place on every tab: beside the tabs. The header's meta line does not repeat it.
  const tabStatus = (
    <span className="pr-detail-status pr-tabs-status">
      <PullRequestReviewStatus
        detail={detail}
        areConflictsOpen={detailTab === 'overview' && isConflictPanelOpen}
        onToggleConflicts={toggleConflicts}
      />
    </span>
  );

  return (
    <section className="pr-review-view" data-arrived={arrivedFromSkeleton || undefined} data-tab={detailTab} aria-label={`Review ${detail.title}`}>
      <PullRequestDetailHeader
        pullRequest={detail}
        condensed={isHeaderCondensed}
        onBack={onBackToInbox}
        actions={
          <>
            {isReviewPlanEnriching ? (
              <PullRequestLoadPhase>Adding context</PullRequestLoadPhase>
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
              // Solid only where the page says the same thing: a ready verdict, on a reading tab.
              quietMerge={detailTab === 'tour' || detailTab === 'code' || pullRequestMergeVerdict(detail).tone !== 'success'}
              mergeDisabled={
                (detail.state !== undefined && detail.state !== 'open') ||
                hasMergeConflicts ||
                !detail.canMerge ||
                detail.isDraft ||
                mergeMutation.isPending
              }
              mergeTitle={mergeTitle(detail, hasMergeConflicts)}
              isMergePending={mergeMutation.isPending}
              onFinishReview={() => openDialog('review')}
              onSelectReviewDecision={(event) => {
                setReviewEvent(event);
                openDialog('review');
              }}
              onOpenMerge={() => openDialog('merge')}
              onClose={onClose}
              onNotice={setNotice}
            />
          </>
        }
      />

      {notice ? (
        // Keyed by the notice itself, so a repeated refusal rises again instead of changing text in place.
        <div className="pr-review-notice" key={noticeKey(notice)} data-tone={notice.tone} role="status">
          {notice.tone === 'success' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
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
        counts={{ conversation: discussionCount + detail.commits, code: detail.changedFiles }}
        trailing={
          <>
            {tabStatus}
            {detailTab === 'conversation' ? (
              <PullRequestConversationControls
                discussionCount={discussionCount}
                commits={detail.commits}
                approvalCount={new Set(detail.reviews.filter((review) => review.state === 'approved').map((review) => review.author)).size}
                preferences={activityPreferences}
                onChange={setActivityPreferences}
              />
            ) : null}
          </>
        }
      />

      <div
        style={bugFinderOpen ? { display: 'none' } : undefined}
        className="pr-review-workspace"
        data-panel-open={isReviewDialogOpen || isMergeDialogOpen}
        onScrollCapture={trackPaneScroll}
      >
        {/* Inactive panes stay mounted (hidden) once visited so drafts and scroll survive tab switches. */}
        <div className="pr-detail-pane pr-summary" hidden={detailTab !== 'overview'} {...pullRequestDetailPanelProps('overview')}>
          {visited('overview') ? <PullRequestOverviewTab
            detail={detail}
            active={detailTab === 'overview'}
            tour={tour}
            codexRepoPath={codexRepoPath}
            conflicts={{ isOpen: isConflictPanelOpen, onToggle: () => setIsConflictPanelOpen((current) => !current) }}
            onOpenBugScan={() => setBugFinderOpen(true)}
            onOpenTourStep={tourSurface.openStep}
            onOpenCode={openCode}
            onOpenConversation={openConversation}
            onRefresh={onRefresh}
            onNotice={setNotice}
          /> : null}
        </div>

        <div className="pr-detail-pane pr-activity" hidden={detailTab !== 'conversation'} {...pullRequestDetailPanelProps('conversation')}>
          {visited('conversation') ? <PullRequestConversationTab
            detail={detail}
            timeline={timeline}
            preferences={activityPreferences}
            commentRequest={commentRequest}
            onOpenImage={setImageGallery}
            onOpenCommit={onOpenCommit}
            onPosted={(message) => {
              setNotice({ tone: 'success', message });
              void invalidatePullRequest();
            }}
          /> : null}
        </div>

        {/* Without a usable tour (none, writing, failed, older format) the Tour tab shows its state here. */}
        <div className="pr-detail-pane pr-tour" hidden={detailTab !== 'tour' || tourUsable} {...(tourUsable ? {} : pullRequestDetailPanelProps('tour'))}>
          {visited('tour') ? <PullRequestTourTab tour={tour} /> : null}
        </div>

        {/* One ReviewView for Tour and Code: the tab only changes its file scope, left panel and strip.
            Without a usable tour the Tour panel is the state pane above, so only Code may claim this one. */}
        <div ref={diffPaneRef} className="pr-focused-review pr-diff-pane" data-diff-tab={diffTab} hidden={!isDiffVisible}
          {...(diffTab === 'tour' && !tourUsable ? {} : pullRequestDetailPanelProps(diffTab))}>
          {visited('code') || (visited('tour') && tourUsable) ? <ReviewView
            key={`${continuityIdentity.key}:${detail.headSha}:${detail.baseSha}`}
            continuityIdentity={continuityIdentity}
            repoPath={detail.reviewPlan.repoPath}
            target={detail.reviewPlan.target}
            plan={detail.reviewPlan}
            guideReferences={tourSurface.guideReferences}
            sidebarActions={<BugFinderButton pullRequest={detail} inReview iconOnly active={bugFinderOpen} onOpen={() => setBugFinderOpen(true)} />}
            reviewProgressKey={detail.reviewPlan.targetKey}
            lineComments={displayedLineComments}
            onAddDraftLineComment={async (input: ReviewLineCommentInput) => addDraft({ kind: 'line', ...input }, 'Comment added to your local review draft.')}
            onAddDraftFileComment={async (input: ReviewFileCommentInput) => addDraft({ kind: 'file', ...input }, 'File comment added to your local review draft.')}
            onAddDraftReply={async (input: ReviewLineReplyInput) => {
              const parent = detail.reviewComments.find((comment) => comment.id === input.inReplyToId && comment.inReplyToId === undefined);
              if (!parent) throw new Error('The comment thread is no longer available.');
              addDraft({ kind: 'reply', ...input }, `Reply to ${parent.author} added to your local review draft.`);
            }}
            onUpdateComment={async (commentId, body) => { await updateCommentMutation.mutateAsync({ commentId, body }); }}
            // Drafts that are being sent must not change: GitHub would receive the old text and the cleanup
            // after the submission would drop the edit. Without these handlers the Edit and Remove controls
            // are not offered, and an edit already open fails to save and keeps its text.
            onUpdateDraftComment={isSubmissionInFlight ? undefined : (id, body) => updateReviewDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, body } : draft))}
            onRemoveDraftComment={isSubmissionInFlight ? undefined : removeDraft}
            diffStyle={diffStyle}
            diffSyntaxTheme={diffSyntaxTheme}
            onSetDiffStyle={onSetDiffStyle}
            onClose={onClose}
            showCloseButton={false}
            layout="pull-request"
            navigationRequest={navigation}
            active={isDiffActive}
            onComposerOpenChange={setComposerOpen}
            {...tourSurface.reviewProps}
            onUnsavedTextChange={setReviewHasUnsavedText}
            onScopeLockRefused={() => setNotice({ tone: 'danger', message: COMPOSER_OPEN_NOTICE })}
          /> : null}
        </div>

        <PullRequestReviewSubmissionDialog
          key={reviewSubmissionKey}
          open={isReviewDialogOpen}
          event={isOwnPullRequest ? 'comment' : reviewEvent}
          onEventChange={setReviewEvent}
          isOwnPullRequest={isOwnPullRequest}
          drafts={reviewDrafts}
          isSubmitting={reviewMutation.isPending || isSubmissionInFlight}
          isCopyingPrompt={copyPromptMutation.isPending}
          errorMessage={
            copyPromptMutation.error instanceof Error
              ? copyPromptMutation.error.message
              : reviewMutation.error instanceof Error
                ? reviewMutation.error.message
                : undefined
          }
          onRemoveDraft={(id) => { if (!isSubmissionInFlight) removeDraft(id); }}
          onClose={() => setIsReviewDialogOpen(false)}
          onCopyPrompt={(summary) => copyPromptMutation.mutate(summary)}
          onSubmit={(event, body) => reviewMutation.mutate({ event, body })}
        />
        <PullRequestMergeDialog
          open={isMergeDialogOpen}
          errorMessage={mergeMutation.error instanceof Error ? mergeMutation.error.message : undefined}
          pullRequest={detail}
          isMerging={mergeMutation.isPending}
          onClose={() => setIsMergeDialogOpen(false)}
          onMerge={(method) => mergeMutation.mutate(method)}
        />
      </div>
      {imageGallery ? <ReviewImageGalleryDialog selection={imageGallery} onClose={() => setImageGallery(undefined)} /> : null}
    </section>
  );
}

function mergeTitle(detail: GitHubPullRequestDetail, hasMergeConflicts: boolean): string {
  if (detail.state === 'merged') return 'This pull request is already merged';
  if (detail.state === 'closed') return 'Closed pull requests cannot be merged';
  if (hasMergeConflicts) return 'Resolve merge conflicts before merging';
  if (detail.isDraft) return 'Draft pull requests cannot be merged';
  if (!detail.canMerge) return 'The connected account cannot merge this pull request';
  return 'Merge pull request';
}

// Every notice object is new, even with the same words; a stable number per object keys its element.
const noticeKeys = new WeakMap<PullRequestNotice, number>();
let nextNoticeKey = 0;
function noticeKey(notice: PullRequestNotice): number {
  let key = noticeKeys.get(notice);
  if (key === undefined) {
    key = nextNoticeKey += 1;
    noticeKeys.set(notice, key);
  }
  return key;
}
