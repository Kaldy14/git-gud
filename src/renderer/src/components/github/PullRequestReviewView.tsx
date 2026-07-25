import type { FormEvent, ReactElement } from 'react';
import { useId, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  CornerDownRight,
  ExternalLink,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Loader2,
  MessageSquare,
  Minus,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  X
} from 'lucide-react';

import { ModalSurface } from '@renderer/components/accessibility/ModalSurface';
import type { DiffStyle } from '@renderer/components/commit/fileDetailUtils';
import { ReviewCommentBody } from '@renderer/components/review/ReviewCommentBody';
import {
  ReviewView,
  type ReviewLineComment,
  type ReviewLineCommentInput,
  type ReviewLineReplyInput
} from '@renderer/components/review/ReviewView';
import {
  gitHubPullRequestDetailQueryKey,
  gitHubPullRequestInboxQueryKey,
  refreshGitHubPullRequestInboxAfterMerge,
  useGitHubPullRequestDetail
} from '@renderer/queries/github';
import type {
  DiffSyntaxTheme,
  GitHubPullRequestDetail,
  GitHubPullRequestDraftLineComment,
  GitHubPullRequestDraftReply,
  GitHubPullRequestMergeMethod,
  GitHubPullRequestReviewInput,
  GitHubPullRequestSummary
} from '@shared/types';

import {
  buildPullRequestDiscussion,
  type PullRequestDiscussionEntry
} from './pullRequestDiscussion';

type PullRequestReviewViewProps = {
  pullRequest: GitHubPullRequestSummary;
  diffStyle: DiffStyle;
  diffSyntaxTheme: DiffSyntaxTheme;
  onSetDiffStyle: (style: DiffStyle) => void;
  onBackToInbox: () => void;
  onClose: () => void;
  onMerged: () => void;
};

type ReviewEvent = GitHubPullRequestReviewInput['event'];

type PullRequestReviewDraft =
  | (GitHubPullRequestDraftLineComment & {
      kind: 'line';
      createdAt: string;
    })
  | (GitHubPullRequestDraftReply & {
      kind: 'reply';
      createdAt: string;
    });

export function PullRequestReviewView({
  pullRequest,
  diffStyle,
  diffSyntaxTheme,
  onSetDiffStyle,
  onBackToInbox,
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
  const detail = detailQuery.data;

  if (detailQuery.isLoading && !detail) {
    return (
      <ReviewMessage
        icon={<Loader2 size={18} className="animate-spin" />}
        text="Loading the pull request review…"
        actionLabel="Back to pull requests"
        onAction={onBackToInbox}
        closeLabel="Return to commit graph"
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
      diffStyle={diffStyle}
      diffSyntaxTheme={diffSyntaxTheme}
      onSetDiffStyle={onSetDiffStyle}
      onBackToInbox={onBackToInbox}
      onClose={onClose}
      onMerged={onMerged}
    />
  );
}

function PullRequestReviewContent({
  detail,
  diffStyle,
  diffSyntaxTheme,
  onSetDiffStyle,
  onBackToInbox,
  onClose,
  onMerged
}: {
  detail: GitHubPullRequestDetail;
  diffStyle: DiffStyle;
  diffSyntaxTheme: DiffSyntaxTheme;
  onSetDiffStyle: (style: DiffStyle) => void;
  onBackToInbox: () => void;
  onClose: () => void;
  onMerged: () => void;
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
  const [isReviewDialogOpen, setIsReviewDialogOpen] = useState(false);
  const [isMergeDialogOpen, setIsMergeDialogOpen] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; message: string }>();
  const generalDiscussion = useMemo(
    () => buildPullRequestDiscussion(detail.conversationComments, detail.reviews),
    [detail.conversationComments, detail.reviews]
  );
  const displayedLineComments = useMemo<ReviewLineComment[]>(() => {
    const publishedComments: ReviewLineComment[] = detail.reviewComments.map((comment) => ({
      ...comment,
      authorAvatarUrl: comment.authorAvatarUrl
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
          line: draft.line,
          side: draft.side,
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
    mutationFn: (input: GitHubPullRequestReviewInput) =>
      window.api.submitGitHubPullRequestReview(input),
    onSuccess: async (result) => {
      const failedDraftIds = new Set(result.failedDraftIds ?? []);
      updateReviewDrafts((current) =>
        current.filter((draft) => failedDraftIds.has(draft.id))
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
  const mergeMutation = useMutation({
    mutationFn: (method: GitHubPullRequestMergeMethod) =>
      window.api.mergeGitHubPullRequest({ ...locator, method }),
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
      replies: reviewDrafts
        .filter((draft): draft is Extract<PullRequestReviewDraft, { kind: 'reply' }> =>
          draft.kind === 'reply'
        )
        .map((draft) => ({
          id: draft.id,
          body: draft.body,
          inReplyToId: draft.inReplyToId
        }))
    });
  }

  return (
    <section className="pr-review-view" aria-label={`Review ${detail.title}`}>
      <header className="pr-review-header">
        <button
          className="icon-btn h-8 w-8 shrink-0"
          type="button"
          onClick={onBackToInbox}
          aria-label="Back to pull requests"
          title="Back to pull requests"
        >
          <ArrowLeft size={15} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2 text-[11px] text-[var(--text-3)]">
            <GitPullRequest size={12} className="text-[var(--success-text)]" />
            <span className="truncate">
              {detail.owner}/{detail.repository}#{detail.number}
            </span>
            <span>·</span>
            <span className="truncate">{detail.author}</span>
          </div>
          <h1 title={detail.title}>{detail.title}</h1>
          <div className="pr-review-branch-line">
            <span>{detail.headRefName}</span>
            <span>→</span>
            <span>{detail.baseRefName}</span>
            <span>·</span>
            <GitCommitHorizontal size={11} />
            <span>{detail.commits} {detail.commits === 1 ? 'commit' : 'commits'}</span>
          </div>
        </div>
        <div className="pr-review-header-actions">
          <a className="btn-subtle h-8 text-xs" href={detail.url} target="_blank" rel="noreferrer">
            <ExternalLink size={12} />
            GitHub
          </a>
          <button className="btn-subtle h-8 text-xs" type="button" onClick={() => setIsReviewDialogOpen(true)}>
            <ShieldCheck size={13} />
            {reviewDrafts.length > 0
              ? `Submit review · ${reviewDrafts.length}`
              : 'Finish review'}
          </button>
          <button
            className="btn-primary h-8 text-xs"
            type="button"
            disabled={!detail.canMerge || detail.isDraft || mergeMutation.isPending}
            title={
              detail.isDraft
                ? 'Draft pull requests cannot be merged'
                : !detail.canMerge
                  ? 'The connected account cannot merge this pull request'
                  : 'Merge pull request'
            }
            onClick={() => setIsMergeDialogOpen(true)}
          >
            <GitMerge size={13} />
            {mergeMethodLabel(detail.mergeSettings.defaultMethod)}
          </button>
          <button
            className="icon-btn h-8 w-8 shrink-0"
            type="button"
            onClick={onClose}
            aria-label="Close pull request review and return to commit graph"
            title="Return to commit graph"
          >
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="pr-review-status-strip">
        <ReviewStatus detail={detail} />
        <span>
          <Plus size={11} /> {detail.additions.toLocaleString()}
        </span>
        <span>
          <Minus size={11} /> {detail.deletions.toLocaleString()}
        </span>
        <span>
          <MessageSquare size={11} /> {generalDiscussion.length + detail.reviewComments.length} comments
        </span>
      </div>

      {notice ? (
        <div className="pr-review-notice" data-tone={notice.tone} role="status">
          {notice.tone === 'success' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
          <span>{notice.message}</span>
          <button type="button" onClick={() => setNotice(undefined)} aria-label="Dismiss message">
            <X size={12} />
          </button>
        </div>
      ) : null}

      <details className="pr-review-overview">
        <summary>
          <ChevronDown size={13} />
          Overview &amp; discussion
          <span>
            {detail.reviews.length} {detail.reviews.length === 1 ? 'review' : 'reviews'} · {generalDiscussion.length} general {generalDiscussion.length === 1 ? 'comment' : 'comments'}
          </span>
        </summary>
        <div className="pr-review-overview-body">
          <div className="pr-review-overview-main">
            <section className="pr-review-description" aria-labelledby="pr-review-description-heading">
              <h2 id="pr-review-description-heading">Description</h2>
              <ReviewCommentBody body={detail.body || 'No pull request description was provided.'} />
            </section>
            {generalDiscussion.length > 0 ? (
              <section className="pr-general-discussion" aria-labelledby="pr-general-discussion-heading">
                <h2 id="pr-general-discussion-heading">
                  General discussion
                  <span>{generalDiscussion.length}</span>
                </h2>
                <div>
                  {generalDiscussion.map((entry) => (
                    <GeneralDiscussionComment entry={entry} key={entry.key} />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
          {detail.reviews.length > 0 ? (
            <div className="pr-review-reviewers">
              {detail.reviews.slice(-8).map((review) => (
                <span key={review.id} data-state={review.state}>
                  {review.state === 'approved' ? <Check size={11} /> : <MessageSquare size={11} />}
                  {review.author} · {formatReviewState(review.state)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </details>

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
            Review and submit
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
          onAddDraftReply={addDraftReply}
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
          errorMessage={reviewMutation.error instanceof Error ? reviewMutation.error.message : undefined}
          onRemoveDraft={removeDraft}
          onClose={() => setIsReviewDialogOpen(false)}
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
    </section>
  );
}

function GeneralDiscussionComment({
  entry
}: {
  entry: PullRequestDiscussionEntry;
}): ReactElement {
  const [didAvatarFail, setDidAvatarFail] = useState(false);

  return (
    <article className="pr-general-comment">
      <header>
        {entry.authorAvatarUrl && !didAvatarFail ? (
          <img
            src={entry.authorAvatarUrl}
            alt=""
            aria-hidden="true"
            onError={() => setDidAvatarFail(true)}
          />
        ) : (
          <span className="pr-general-comment-avatar" aria-hidden="true">
            {entry.author.slice(0, 1).toUpperCase()}
          </span>
        )}
        <strong>{entry.author}</strong>
        {entry.kind === 'review' ? (
          <span className="pr-general-comment-kind" data-state={entry.reviewState}>
            {formatReviewState(entry.reviewState)}
          </span>
        ) : null}
        <a href={entry.url} target="_blank" rel="noreferrer" title="Open comment on GitHub">
          <time dateTime={entry.createdAt}>{formatDiscussionDate(entry.createdAt)}</time>
          <ExternalLink size={10} />
        </a>
      </header>
      <ReviewCommentBody body={entry.body} />
    </article>
  );
}

function ReviewSubmissionDialog({
  drafts,
  isSubmitting,
  errorMessage,
  onRemoveDraft,
  onClose,
  onSubmit
}: {
  drafts: PullRequestReviewDraft[];
  isSubmitting: boolean;
  errorMessage?: string;
  onRemoveDraft: (id: string) => void;
  onClose: () => void;
  onSubmit: (event: ReviewEvent, body: string) => void;
}): ReactElement {
  const titleId = useId();
  const [event, setEvent] = useState<ReviewEvent>('comment');
  const [body, setBody] = useState('');
  const requiresBody =
    event === 'request-changes' ||
    (event === 'comment' && drafts.length === 0);

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
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <header>
          <ShieldCheck size={17} />
          <h2 id={titleId}>Finish your review</h2>
          <button className="icon-btn h-7 w-7" type="button" onClick={onClose} aria-label="Close review dialog">
            <X size={14} />
          </button>
        </header>
        <div className="pr-action-dialog-body">
          <div>
            <span className="pr-action-field-label">Review decision</span>
            <div className="pr-review-decision-options" role="group" aria-label="Review decision">
              {([
                ['comment', 'Send comments', MessageSquare],
                ['approve', 'Approve', CheckCircle2],
                ['request-changes', 'Request changes', AlertTriangle]
              ] as const).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  data-active={event === value}
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
                        : <CornerDownRight size={11} />}
                    </span>
                    <span>
                      <strong>
                        {draft.kind === 'line'
                          ? `${draft.path}:${draft.startLine ? `${draft.startLine}–` : ''}${draft.line}`
                          : 'Reply in existing thread'}
                      </strong>
                      <small>{draft.body}</small>
                    </span>
                    <button
                      type="button"
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
              {event === 'approve' || (event === 'comment' && drafts.length > 0)
                ? 'Review summary (optional)'
                : 'Review summary'}
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
              onChange={(changeEvent) => setBody(changeEvent.target.value)}
            />
          </label>
          {errorMessage ? <p className="pr-action-error">{errorMessage}</p> : null}
        </div>
        <footer>
          <span className="pr-review-submit-note">
            {drafts.length === 0
              ? 'One action sends the review.'
              : `One action sends the review and ${drafts.length} draft comment${drafts.length === 1 ? '' : 's'}.`}
          </span>
          <button className="btn-subtle h-8 text-xs" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary h-8 text-xs" type="submit" disabled={isSubmitting || (requiresBody && !body.trim())}>
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
          <button className="icon-btn h-7 w-7" type="button" onClick={onClose} aria-label="Close merge dialog">
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
          <button className="btn-subtle h-8 text-xs" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary h-8 text-xs" type="submit" disabled={isMerging}>
            {isMerging ? <Loader2 size={13} className="animate-spin" /> : <GitMerge size={13} />}
            {mergeMethodLabel(method)}
          </button>
        </footer>
      </form>
    </ModalSurface>
  );
}

function ReviewStatus({
  detail
}: {
  detail: GitHubPullRequestSummary;
}): ReactElement {
  const checksTone =
    detail.checks.state === 'success'
      ? 'success'
      : detail.checks.state === 'failure' || detail.checks.state === 'error'
        ? 'danger'
        : 'pending';
  return (
    <>
      <span data-tone={detail.reviewDecision === 'approved' ? 'success' : detail.reviewDecision === 'changes-requested' ? 'danger' : 'pending'}>
        {detail.reviewDecision === 'approved' ? <Check size={12} /> : <CircleDot size={11} />}
        {detail.reviewDecision === 'approved'
          ? 'Approved'
          : detail.reviewDecision === 'changes-requested'
            ? 'Changes requested'
            : 'Awaiting approval'}
      </span>
      <span data-tone={checksTone}>
        {checksTone === 'success' ? <Check size={12} /> : checksTone === 'danger' ? <AlertTriangle size={12} /> : <CircleDot size={11} />}
        {detail.checks.total > 0
          ? `${detail.checks.passed}/${detail.checks.total} checks passed`
          : 'No checks reported'}
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
              className="icon-btn h-8 w-8"
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
              className="icon-btn h-8 w-8"
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

function formatReviewState(state: string): string {
  return state.replace('-', ' ');
}
