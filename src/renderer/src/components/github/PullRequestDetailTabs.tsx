import { useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { ArrowLeft, ChevronRight, ExternalLink, FileDiff } from 'lucide-react';

import type { GitHubPullRequestSummary } from '@shared/types';
import { PullRequestLineStats } from './PullRequestLineStats';
import {
  PULL_REQUEST_DETAIL_TABS,
  pullRequestDetailPanelId,
  pullRequestDetailTabId,
  type PullRequestDetailTab
} from './pullRequestDetailTab';

const LABELS: Record<PullRequestDetailTab, string> = {
  summary: 'Summary',
  guide: 'Guide',
  activity: 'Activity',
  code: 'Code'
};

/**
 * T3 Code's detail header: a crumb row (repository and number) with the actions, then the title,
 * status line, and branch line. Once the active pane scrolls, the fold collapses and the crumb row
 * shows the number and title instead.
 */
export function PullRequestDetailHeader({ pullRequest, condensed = false, commits, status, actions, onBack }: {
  pullRequest: GitHubPullRequestSummary;
  condensed?: boolean;
  commits?: number;
  status: ReactNode;
  actions: ReactNode;
  onBack: () => void;
}): ReactElement {
  // Show the fork owner when the head branch lives outside the base repository.
  const headLabel = pullRequest.headRepositoryOwner && pullRequest.headRepositoryOwner.toLowerCase() !== pullRequest.owner.toLowerCase()
    ? `${pullRequest.headRepositoryOwner}:${pullRequest.headRefName}`
    : pullRequest.headRefName;
  const number = (
    <a className="pr-detail-number" href={pullRequest.url} target="_blank" rel="noreferrer" title="Open on GitHub">
      #{pullRequest.number}
      <ExternalLink size={10} aria-hidden="true" />
    </a>
  );

  return (
    <header className="pr-detail-header" data-condensed={condensed}>
      <div className="pr-detail-crumbs">
        <button className="icon-btn icon-btn-tertiary" type="button" onClick={onBack} aria-label="Back to pull requests" title="Back to pull requests">
          <ArrowLeft size={14} />
        </button>
        {condensed ? (
          <span className="pr-detail-crumb-path">
            {number}
            <span className="pr-detail-crumb-title" title={pullRequest.title}>{pullRequest.title}</span>
          </span>
        ) : (
          <span className="pr-detail-crumb-path">
            <span className="pr-detail-crumb-repo">{pullRequest.owner}/{pullRequest.repository}</span>
            {number}
          </span>
        )}
        <div className="pr-detail-actions">{actions}</div>
      </div>
      <div className="pr-detail-fold" inert={condensed}>
        <div>
          <h1 title={pullRequest.title}>{pullRequest.title}</h1>
          <div className="pr-detail-line">
            <span className="pr-detail-status">{status}</span>
            <span className="pr-detail-divider" aria-hidden="true" />
            <span className="pr-detail-byline">
              <PullRequestAvatar author={pullRequest.author} authorAvatarUrl={pullRequest.authorAvatarUrl} size="small" />
              <strong>{pullRequest.author}</strong>
              <span>
                updated <time dateTime={pullRequest.updatedAt} title={new Date(pullRequest.updatedAt).toLocaleString()}>{formatRelativeTime(pullRequest.updatedAt)}</time>
              </span>
              {commits !== undefined ? <span>{commits.toLocaleString()} {commits === 1 ? 'commit' : 'commits'}</span> : null}
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
              <PullRequestLineStats additions={pullRequest.additions} deletions={pullRequest.deletions} />
            </span>
          </div>
        </div>
      </div>
    </header>
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

export function PullRequestDetailTabs({ value, onChange, hidden, disabled, counts, trailing }: {
  value: PullRequestDetailTab;
  onChange: (tab: PullRequestDetailTab) => void;
  hidden?: boolean;
  disabled?: boolean;
  counts: Partial<Record<PullRequestDetailTab, number>>;
  trailing?: ReactNode;
}): ReactElement {
  const refs = useRef<Partial<Record<PullRequestDetailTab, HTMLButtonElement | null>>>({});

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
    onChange(next);
    refs.current[next]?.focus();
  }

  return (
    <div className="pr-detail-tabs" hidden={hidden}>
      <div role="tablist" aria-label="Pull request" onKeyDown={onKeyDown}>
        {PULL_REQUEST_DETAIL_TABS.map((tab) => (
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
            {LABELS[tab]}
            {counts[tab] ? <span className="pr-detail-tab-count">{counts[tab]!.toLocaleString()}</span> : null}
          </button>
        ))}
      </div>
      {trailing ? <div className="pr-detail-tabs-trailing">{trailing}</div> : null}
    </div>
  );
}

export function PullRequestMetaRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }): ReactElement {
  return (
    <div className="pr-meta-row">
      <span className="pr-meta-label">{icon}{label}</span>
      <span className="pr-meta-value">{children}</span>
    </div>
  );
}

export function PullRequestSection({ title, defaultOpen = true, children }: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}): ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="pr-summary-section" aria-label={title}>
      <button type="button" className="pr-summary-section-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {title}
        <ChevronRight size={13} aria-hidden="true" data-open={open} />
      </button>
      {open ? <div className="pr-summary-section-body">{children}</div> : null}
    </section>
  );
}
