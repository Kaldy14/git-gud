import type { ReactElement } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react';

import { ReviewCommentBody } from '@renderer/components/review/ReviewCommentBody';
import type { ReviewImageGallerySelection } from '@renderer/components/review/ReviewImageGalleryDialog';
import type { GitHubPullRequestDetail } from '@shared/types';
import { PullRequestAvatar } from '../PullRequestDetailTabs';
import { isBotAuthor, type PullRequestReviewThread, type PullRequestTimelineEntry } from '../pullRequestTimeline';

export function PullRequestTimelineItem({
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
      <article className="pr-timeline-event" data-kind="conversation" data-comment-id={entry.comment.id} data-bot={isBotAuthor(entry.comment.author) || undefined}>
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
      <article className="pr-timeline-event" data-kind="review-thread" data-bot={isBotAuthor(entry.thread.root.author) || undefined}>
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
    <article className="pr-timeline-event" data-kind="review" data-state={entry.review.state} data-bot={isBotAuthor(entry.review.author) || undefined}>
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
    <div className="pr-timeline-thread-message" data-reply={isReply} data-comment-id={comment.id}>
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
            <ExternalLink size={10} />
          </a>
        </header>
        <ReviewCommentBody body={comment.body} imageUrls={comment.bodyImageUrls} onOpenImage={onOpenImage} />
      </div>
    </div>
  );
}

export function formatDiscussionDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
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
