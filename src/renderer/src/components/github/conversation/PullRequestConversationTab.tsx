import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { ArrowDownUp, Bot, Check, ChevronDown, ChevronUp, ExternalLink, GitCommitHorizontal, MessageSquare } from 'lucide-react';

import { ReviewCommentBody } from '@renderer/components/review/ReviewCommentBody';
import type { ReviewImageGallerySelection } from '@renderer/components/review/ReviewImageGalleryDialog';
import type { GitHubPullRequestDetail } from '@shared/types';
import { PullRequestAvatar, PullRequestMeta } from '../PullRequestDetailTabs';
import { groupPullRequestActivity, type PullRequestTimelineEntry } from '../pullRequestTimeline';
import { pullRequestLocator } from '../tour/pullRequestTourQuery';
import { PullRequestCommentComposer } from './PullRequestCommentComposer';
import { formatDiscussionDate, PullRequestTimelineItem } from './PullRequestTimelineItem';

export type ActivityPreferences = { order: 'newest' | 'oldest'; hideBots: boolean };
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

export function useActivityPreferences(): [ActivityPreferences, (next: ActivityPreferences) => void] {
  const [preferences, setPreferences] = useState(() => loadActivityPreferences(window.localStorage));
  return [preferences, (next) => {
    setPreferences(next);
    try { window.localStorage.setItem(ACTIVITY_PREFERENCES_KEY, JSON.stringify(next)); } catch { /* a remembered view is a convenience */ }
  }];
}

/** Counts and the timeline's view controls, shown beside the tabs while Conversation is open. */
export function PullRequestConversationControls({ discussionCount, commits, approvalCount, preferences, onChange }: {
  discussionCount: number;
  commits: number;
  approvalCount: number;
  preferences: ActivityPreferences;
  onChange: (next: ActivityPreferences) => void;
}): ReactElement {
  return (
    <>
      <span className="pr-activity-counts">
        <span title="Comments and reviews"><MessageSquare size={12} aria-hidden="true" />{discussionCount}<span className="sr-only"> comments and reviews</span></span>
        <span title="Commits"><GitCommitHorizontal size={12} aria-hidden="true" />{commits}<span className="sr-only"> commits</span></span>
        {approvalCount ? <span className="pr-activity-approvals" title="Approvals"><Check size={12} aria-hidden="true" />{approvalCount}<span className="sr-only"> approvals</span></span> : null}
      </span>
      <button
        className="btn-subtle btn-compact"
        type="button"
        aria-pressed={preferences.hideBots}
        onClick={() => onChange({ ...preferences, hideBots: !preferences.hideBots })}
      >
        <Bot size={12} />
        {preferences.hideBots ? 'Bots hidden' : 'Hide bots'}
      </button>
      <button
        className="btn-subtle btn-compact"
        type="button"
        aria-label={preferences.order === 'newest' ? 'Show oldest activity first' : 'Show newest activity first'}
        onClick={() => onChange({ ...preferences, order: preferences.order === 'newest' ? 'oldest' : 'newest' })}
      >
        <ArrowDownUp size={12} />
        {preferences.order === 'newest' ? 'Newest first' : 'Oldest first'}
      </button>
    </>
  );
}

/** Conversation: the description first, then the composer and the timeline. */
export function PullRequestConversationTab({ detail, timeline, preferences, commentRequest, onOpenImage, onOpenCommit, onPosted }: {
  detail: GitHubPullRequestDetail;
  timeline: readonly PullRequestTimelineEntry[];
  preferences: ActivityPreferences;
  // Scrolls to a comment (review or conversation) by its GitHub id; bump signal to repeat.
  commentRequest?: { commentId: number; signal: number };
  onOpenImage: (selection: ReviewImageGallerySelection) => void;
  onOpenCommit?: (sha: string) => void;
  onPosted: (message: string) => void;
}): ReactElement {
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const columnRef = useRef<HTMLDivElement>(null);
  // A comment opened from Overview shows even when bots are hidden; the saved preference stays. Toggling the
  // preference afterwards drops that exception, so "Bots hidden" hides every bot entry again.
  const [lastHideBots, setLastHideBots] = useState(preferences.hideBots);
  const [droppedRequest, setDroppedRequest] = useState<typeof commentRequest>();
  if (lastHideBots !== preferences.hideBots) {
    setLastHideBots(preferences.hideBots);
    setDroppedRequest(commentRequest);
  }
  const keepCommentId = commentRequest !== droppedRequest ? commentRequest?.commentId : undefined;
  const items = groupPullRequestActivity(
    preferences.order === 'newest' ? [...timeline].reverse() : [...timeline],
    { hideBots: preferences.hideBots, keepCommentId }
  );

  // Overview's issue rows open a comment here: scroll to it and flash it once.
  useEffect(() => {
    if (!commentRequest) return;
    const target = columnRef.current?.querySelector<HTMLElement>(`[data-comment-id="${commentRequest.commentId}"]`);
    if (!target) return;
    target.scrollIntoView({ block: 'center' });
    // Removing, reading layout and re-adding restarts the one-shot highlight for a repeated request.
    target.removeAttribute('data-flash');
    void target.offsetWidth;
    target.setAttribute('data-flash', 'true');
    const timer = window.setTimeout(() => target.removeAttribute('data-flash'), 1_600);
    return () => window.clearTimeout(timer);
  }, [commentRequest]);

  return (
    <div className="pr-activity-column pr-conversation" ref={columnRef}>
      <PullRequestMeta pullRequest={detail} commits={detail.commits} />
      <PullRequestDescription detail={detail} onOpenImage={onOpenImage} />
      <div className="pr-conversation-composer">
        <PullRequestCommentComposer
          hidden={false}
          isOpen={isComposerOpen}
          formId={`pr-${detail.number}-comment-form`}
          onClose={() => setIsComposerOpen(false)}
          locator={pullRequestLocator(detail)}
          onPosted={onPosted}
        />
        {!isComposerOpen ? (
          <button className="pr-activity-add-comment" type="button" onClick={() => setIsComposerOpen(true)}>
            <MessageSquare size={14} aria-hidden="true" />
            Add a comment…
          </button>
        ) : null}
      </div>
      <div className="pr-review-timeline">
        {items.length ? (
          items.map((item) => item.kind === 'commits' ? (
            <details className="pr-commit-group" key={item.key}>
              <summary>
                <GitCommitHorizontal size={14} aria-hidden="true" />
                <span>
                  <strong>{[...new Set(item.commits.map(({ commit }) => commit.author))].join(', ')}</strong>
                  {' '}pushed {item.commits.length} commits
                </span>
                <time dateTime={item.commits.at(-1)!.createdAt}>{formatDiscussionDate(item.commits.at(-1)!.createdAt)}</time>
              </summary>
              {item.commits.map((entry) => (
                <PullRequestTimelineItem entry={entry} onOpenImage={onOpenImage} key={entry.key} onOpenCommit={onOpenCommit} />
              ))}
            </details>
          ) : (
            <PullRequestTimelineItem entry={item.entry} onOpenImage={onOpenImage} key={item.key} onOpenCommit={onOpenCommit} />
          ))
        ) : (
          <p className="pr-context-empty">
            {timeline.length ? 'Only bot activity so far.' : 'No comments or reviews yet.'}
          </p>
        )}
      </div>
    </div>
  );
}

// Taller than this, the description folds behind "Show full description" so the discussion stays near.
const DESCRIPTION_CLAMP_PX = 480;

function PullRequestDescription({ detail, onOpenImage }: {
  detail: GitHubPullRequestDetail;
  onOpenImage: (selection: ReviewImageGallerySelection) => void;
}): ReactElement {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [isLong, setIsLong] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // Images load late and change the height, so measure whenever the body resizes.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => setIsLong(body.scrollHeight > DESCRIPTION_CLAMP_PX + 48);
    measure();
    const observer = new ResizeObserver(measure);
    for (const child of body.children) observer.observe(child);
    return () => observer.disconnect();
  }, [detail.body]);

  const clamped = isLong && !isExpanded;
  return (
    <article className="pr-timeline-event pr-conversation-description" data-kind="conversation">
      <PullRequestAvatar author={detail.author} authorAvatarUrl={detail.authorAvatarUrl} />
      <div className="pr-timeline-event-content pr-timeline-comment">
        <header>
          <span><strong>{detail.author}</strong>opened this pull request</span>
          {detail.createdAt ? (
            <a href={detail.url} target="_blank" rel="noreferrer" title="Open on GitHub">
              <time dateTime={detail.createdAt}>{formatDiscussionDate(detail.createdAt)}</time>
              <ExternalLink size={10} aria-hidden="true" />
            </a>
          ) : null}
        </header>
        <div className="pr-conversation-description-body" ref={bodyRef} data-clamped={clamped || undefined}>
          <ReviewCommentBody
            body={detail.body || '_No description provided._'}
            imageUrls={detail.bodyImageUrls}
            imageLoading="eager"
            onOpenImage={onOpenImage}
          />
        </div>
        {isLong ? (
          <button
            className="pr-conversation-description-toggle"
            type="button"
            aria-expanded={isExpanded}
            onClick={() => {
              setIsExpanded(!isExpanded);
              // Folding again from the bottom of a long description: bring its top back into view.
              if (isExpanded) bodyRef.current?.closest('article')?.scrollIntoView({ block: 'nearest' });
            }}
          >
            {isExpanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
            {isExpanded ? 'Show less' : 'Show full description'}
          </button>
        ) : null}
      </div>
    </article>
  );
}
