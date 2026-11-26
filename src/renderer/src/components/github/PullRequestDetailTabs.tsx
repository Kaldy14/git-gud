import { useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { ArrowLeft, CodeXml, ExternalLink, FileDiff, LayoutDashboard, MessagesSquare, PanelLeftClose, PanelLeftOpen, Route, type LucideIcon } from 'lucide-react';

import { pullRequestLineBreakdown, type FileLineStat } from '@shared/lineBreakdown';
import { useSlidingIndicator } from '@renderer/components/ui/useSlidingIndicator';
import type { GitHubPullRequestSummary } from '@shared/types';
import { PullRequestLineStats } from './PullRequestLineStats';
import {
  PULL_REQUEST_DETAIL_TABS,
  pullRequestDetailPanelId,
  pullRequestDetailTabId,
  type PullRequestDetailTab
} from './pullRequestDetailTab';
import { isMacPlatform } from './shortcuts/pullRequestShortcutList';
import { usePullRequestWorkspaceChrome } from './workspace/pullRequestWorkspaceChrome';

const TABS: Record<PullRequestDetailTab, { label: string; icon: LucideIcon }> = {
  overview: { label: 'Overview', icon: LayoutDashboard },
  conversation: { label: 'Conversation', icon: MessagesSquare },
  tour: { label: 'Tour', icon: Route },
  code: { label: 'Code', icon: CodeXml }
};

/**
 * The pull request's header: one row on every tab (list toggle, back, repository, number, title, actions),
 * so the tab strip beneath it never moves. The author and branch line is `PullRequestMeta`, shown at the
 * top of Overview and Conversation.
 */
export function PullRequestDetailHeader({ pullRequest, condensed = false, actions, onBack }: {
  pullRequest: GitHubPullRequestSummary;
  /** Code and Tour: the title is set smaller. The row keeps its height. */
  condensed?: boolean;
  actions: ReactNode;
  onBack: () => void;
}): ReactElement {
  const number = (
    <a className="pr-detail-number" href={pullRequest.url} target="_blank" rel="noreferrer" title="Open on GitHub">
      #{pullRequest.number}
      <ExternalLink size={12} aria-hidden="true" />
    </a>
  );

  return (
    <header className="pr-detail-header" data-condensed={condensed}>
      <div className="pr-detail-crumbs">
        <RailToggle />
        <button className="icon-btn icon-btn-tertiary" type="button" onClick={onBack} aria-label="Back to pull requests" title="Back to pull requests">
          <ArrowLeft size={16} />
        </button>
        <span className="pr-detail-crumb-path">
          <span className="pr-detail-crumb-repo">{pullRequest.owner}/{pullRequest.repository}</span>
          {number}
          <span className="pr-detail-crumb-title" role="heading" aria-level={1} title={pullRequest.title}>{pullRequest.title}</span>
        </span>
        <div className="pr-detail-actions">{actions}</div>
      </div>
    </header>
  );
}

/**
 * Who, when and which branches: the line that opens Overview and Conversation. It lives in the page, not
 * in the header, so the header is one row of the same height on every tab and the tabs never move.
 */
export function PullRequestMeta({ pullRequest, commits, commitsPending }: {
  pullRequest: GitHubPullRequestSummary & { files?: readonly FileLineStat[] };
  commits?: number;
  /** The count is on its way: hold its place so the line does not shift when it arrives. */
  commitsPending?: boolean;
}): ReactElement {
  // Show the fork owner when the head branch lives outside the base repository.
  const headLabel = pullRequest.headRepositoryOwner && pullRequest.headRepositoryOwner.toLowerCase() !== pullRequest.owner.toLowerCase()
    ? `${pullRequest.headRepositoryOwner}:${pullRequest.headRefName}`
    : pullRequest.headRefName;
  return (
    <div className="pr-detail-meta">
            <div className="pr-detail-line">
              <span className="pr-detail-byline">
                <PullRequestAvatar author={pullRequest.author} authorAvatarUrl={pullRequest.authorAvatarUrl} size="small" />
                <strong>{pullRequest.author}</strong>
                <span>
                  updated <time dateTime={pullRequest.updatedAt} title={new Date(pullRequest.updatedAt).toLocaleString()}>{formatRelativeTime(pullRequest.updatedAt)}</time>
                </span>
                {commits !== undefined ? <span>{commits.toLocaleString()} {commits === 1 ? 'commit' : 'commits'}</span>
                  : commitsPending ? <span className="pr-review-skeleton pr-detail-commits-pending" aria-hidden="true" /> : null}
              </span>
            </div>
            <div className="pr-detail-line">
              <code className="pr-detail-branches" title={`${headLabel} merges into ${pullRequest.baseRefName}`}>
                <span>{pullRequest.baseRefName}</span>
                <ArrowLeft size={12} aria-label="receives changes from" />
                <span>{headLabel}</span>
              </code>
              <span className="pr-detail-diffstat">
                <span>
                  <FileDiff size={12} aria-hidden="true" />
                  {pullRequest.changedFiles.toLocaleString()} {pullRequest.changedFiles === 1 ? 'file' : 'files'}
                </span>
                <PullRequestLineStats additions={pullRequest.additions} deletions={pullRequest.deletions} breakdown={pullRequestLineBreakdown(pullRequest)} />
              </span>
            </div>
          </div>
  );
}

/** Shows or hides the pull request list; first in the crumb row, before the back arrow. */
function RailToggle(): ReactElement | null {
  const chrome = usePullRequestWorkspaceChrome();
  if (!chrome) return null;
  const label = `${chrome.railOpen ? 'Hide' : 'Show'} pull request list (${isMacPlatform() ? '⌘' : 'Ctrl+'}B)`;
  const Icon = chrome.railOpen ? PanelLeftClose : PanelLeftOpen;
  return (
    <button
      className="icon-btn icon-btn-tertiary pr-rail-toggle"
      type="button"
      data-rail-toggle
      aria-expanded={chrome.railOpen}
      aria-controls={chrome.railOpen ? chrome.railId : undefined}
      aria-label={label}
      title={label}
      onClick={chrome.toggleRail}
    >
      <Icon size={16} />
    </button>
  );
}

function formatRelativeTime(value: string): string {
  const minutes = Math.round((Date.parse(value) - Date.now()) / 60_000);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return format.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return format.format(hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return format.format(days, 'day');
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function PullRequestAvatar({ author, authorAvatarUrl, size = 'regular' }: {
  author: string;
  authorAvatarUrl?: string;
  size?: 'regular' | 'compact' | 'small';
}): ReactElement {
  const [failedUrl, setFailedUrl] = useState<string>();
  return authorAvatarUrl && failedUrl !== authorAvatarUrl ? (
    <img
      className="pr-timeline-avatar"
      data-size={size}
      src={authorAvatarUrl}
      alt=""
      aria-hidden="true"
      referrerPolicy="no-referrer"
      onError={() => setFailedUrl(authorAvatarUrl)}
    />
  ) : (
    <span className="pr-timeline-avatar" data-size={size} aria-hidden="true">
      {author.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function PullRequestDetailTabs({ value, onChange, hidden, disabled, counts, pendingCounts, trailing }: {
  value: PullRequestDetailTab;
  // Returns whether the tab changed; the open pull request can refuse (a composer would be hidden).
  onChange: (tab: PullRequestDetailTab) => boolean;
  hidden?: boolean;
  disabled?: boolean;
  counts: Partial<Record<PullRequestDetailTab, number>>;
  /** Tabs whose count is still loading: an empty pill holds its place. */
  pendingCounts?: readonly PullRequestDetailTab[];
  trailing?: ReactNode;
}): ReactElement {
  const refs = useRef<Partial<Record<PullRequestDetailTab, HTMLButtonElement | null>>>({});
  const listRef = useRef<HTMLDivElement>(null);

  useSlidingIndicator(listRef, value, 10);

  // Arrow, Home, and End keys move between tabs, following the WAI-ARIA tabs pattern.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const count = PULL_REQUEST_DETAIL_TABS.length;
    const index = PULL_REQUEST_DETAIL_TABS.indexOf(value);
    const target = event.key === 'ArrowRight' ? (index + 1) % count
      : event.key === 'ArrowLeft' ? (index - 1 + count) % count
        : event.key === 'Home' ? 0
          : event.key === 'End' ? count - 1
            : undefined;
    if (target === undefined) return;
    event.preventDefault();
    const next = PULL_REQUEST_DETAIL_TABS[target]!;
    // Focus follows only a change that happened; a refused one leaves it on the selected tab.
    if (onChange(next)) refs.current[next]?.focus();
  }

  return (
    <div className="pr-detail-tabs" hidden={hidden}>
      <div ref={listRef} role="tablist" aria-label="Pull request" onKeyDown={onKeyDown}>
        {PULL_REQUEST_DETAIL_TABS.map((tab) => {
          const { label, icon: Icon } = TABS[tab];
          return (
          <button
            key={tab}
            ref={(node) => { refs.current[tab] = node; }}
            type="button"
            role="tab"
            id={pullRequestDetailTabId(tab)}
            aria-controls={pullRequestDetailPanelId(tab)}
            aria-selected={value === tab}
            disabled={disabled}
            tabIndex={value === tab ? 0 : -1}
            onClick={() => onChange(tab)}
          >
            <Icon size={14} aria-hidden="true" />
            {label}
            {counts[tab] !== undefined ? <span className="pr-detail-tab-count">{counts[tab].toLocaleString()}</span>
              : pendingCounts?.includes(tab) ? <span className="pr-detail-tab-count" data-pending="" aria-hidden="true" /> : null}
          </button>
          );
        })}
        <span className="sliding-indicator" aria-hidden="true" />
      </div>
      {trailing ? <div className="pr-detail-tabs-trailing">{trailing}</div> : null}
    </div>
  );
}
