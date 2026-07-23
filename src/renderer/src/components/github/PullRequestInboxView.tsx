import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  GitPullRequest,
  Inbox,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldCheck
} from 'lucide-react';

import type {
  GitHubPullRequestCategory,
  GitHubPullRequestInbox,
  GitHubPullRequestSummary,
  GitProfile
} from '@shared/types';

type PullRequestInboxViewProps = {
  profile?: GitProfile;
  inbox?: GitHubPullRequestInbox;
  isLoading: boolean;
  isRefreshing: boolean;
  errorMessage?: string;
  onRefresh: () => void;
  onOpenProfileSettings: () => void;
  onSelectPullRequest: (pullRequest: GitHubPullRequestSummary) => void;
};

type UpdatedRange = '7' | '30' | '90' | 'all';

const GROUPS: Array<{
  id: GitHubPullRequestCategory;
  title: string;
  description: string;
  initiallyExpanded: boolean;
}> = [
  {
    id: 'needs-your-review',
    title: 'Needs your review',
    description: 'You were requested directly as a reviewer.',
    initiallyExpanded: true
  },
  {
    id: 'needs-team-review',
    title: "Needs your teams' review",
    description: 'A team you belong to was requested.',
    initiallyExpanded: false
  },
  {
    id: 'drafts',
    title: 'Your drafts',
    description: 'Open draft pull requests you authored.',
    initiallyExpanded: false
  },
  {
    id: 'waiting',
    title: 'Waiting for review or checks',
    description: 'Your pull requests that are still progressing.',
    initiallyExpanded: true
  },
  {
    id: 'needs-action',
    title: 'Needs action',
    description: 'Changes, conflicts, or failing checks need attention.',
    initiallyExpanded: false
  },
  {
    id: 'ready-to-merge',
    title: 'Ready to merge',
    description: 'Approved pull requests with successful checks.',
    initiallyExpanded: false
  }
];

export function PullRequestInboxView({
  profile,
  inbox,
  isLoading,
  isRefreshing,
  errorMessage,
  onRefresh,
  onOpenProfileSettings,
  onSelectPullRequest
}: PullRequestInboxViewProps): ReactElement {
  const [search, setSearch] = useState('');
  const [updatedRange, setUpdatedRange] = useState<UpdatedRange>('30');
  const [expandedGroups, setExpandedGroups] = useState<Record<GitHubPullRequestCategory, boolean>>(
    () =>
      Object.fromEntries(
        GROUPS.map((group) => [group.id, group.initiallyExpanded])
      ) as Record<GitHubPullRequestCategory, boolean>
  );
  const filteredPullRequests = useMemo(
    () => filterPullRequests(inbox?.pullRequests ?? [], search, updatedRange),
    [inbox?.pullRequests, search, updatedRange]
  );

  if (!profile?.ghConfigDir || !profile.githubLogin) {
    return (
      <InboxMessage
        icon={<Inbox size={20} />}
        title="Connect a GitHub account"
        detail="Pull request inboxes use the GitHub CLI account attached to the active Git profile."
        actionLabel="Open profile settings"
        onAction={onOpenProfileSettings}
      />
    );
  }

  if (isLoading && !inbox) {
    return (
      <InboxMessage
        icon={<Loader2 size={20} className="animate-spin" />}
        title="Scanning your pull requests"
        detail={`Reading review requests and authored work for @${profile.githubLogin}.`}
      />
    );
  }

  if (errorMessage && !inbox) {
    return (
      <InboxMessage
        icon={<AlertTriangle size={20} />}
        title="Could not load the pull request inbox"
        detail={errorMessage}
        actionLabel="Try again"
        onAction={onRefresh}
        tone="danger"
      />
    );
  }

  return (
    <section className="pr-inbox-view" aria-label="Pull request inbox">
      <header className="pr-inbox-header">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="pr-kicker">GitHub</span>
            <span className="text-[11px] text-[var(--text-3)]">
              {inbox?.host ?? profile.githubHost ?? 'github.com'} · @{inbox?.viewerLogin ?? profile.githubLogin}
            </span>
          </div>
          <h1>Pull request inbox</h1>
          <p>Review requests and authored pull requests, prioritized by what needs you next.</p>
        </div>
        <button
          className="btn-subtle h-8 shrink-0 text-xs"
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : undefined} />
          {isRefreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </header>

      <div className="pr-inbox-controls">
        <label className="pr-search-field">
          <Search size={14} />
          <input
            type="search"
            value={search}
            placeholder="Search title, repository, author…"
            aria-label="Search pull requests"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <select
          className="pr-range-select"
          value={updatedRange}
          aria-label="Updated time range"
          onChange={(event) => setUpdatedRange(normalizeUpdatedRange(event.target.value))}
        >
          <option value="7">Updated: 7 days</option>
          <option value="30">Updated: 30 days</option>
          <option value="90">Updated: 90 days</option>
          <option value="all">Updated: Any time</option>
        </select>
        <span className="pr-inbox-total">
          <strong>{filteredPullRequests.length}</strong> visible
        </span>
      </div>

      {errorMessage ? (
        <div className="pr-inline-error" role="alert">
          <AlertTriangle size={13} />
          <span>{errorMessage}</span>
        </div>
      ) : null}

      <div className="pr-inbox-groups">
        {GROUPS.map((group) => {
          const rows = filteredPullRequests.filter((pullRequest) => pullRequest.category === group.id);
          const isExpanded = expandedGroups[group.id];

          return (
            <section className="pr-inbox-group" key={group.id}>
              <button
                className="pr-group-heading"
                type="button"
                aria-expanded={isExpanded}
                title={group.description}
                onClick={() =>
                  setExpandedGroups((current) => ({ ...current, [group.id]: !current[group.id] }))
                }
              >
                {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                <span>{group.title}</span>
                <span className="pr-count-badge">{rows.length}</span>
              </button>
              {isExpanded ? (
                rows.length > 0 ? (
                  <div className="pr-row-list">
                    {rows.map((pullRequest) => (
                      <PullRequestRow
                        key={pullRequest.id}
                        pullRequest={pullRequest}
                        onSelect={() => onSelectPullRequest(pullRequest)}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="pr-group-empty">Nothing here right now.</p>
                )
              ) : null}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function PullRequestRow({
  pullRequest,
  onSelect
}: {
  pullRequest: GitHubPullRequestSummary;
  onSelect: () => void;
}): ReactElement {
  const status = pullRequestStatus(pullRequest);
  const checkTone =
    pullRequest.checks.state === 'success'
      ? 'success'
      : pullRequest.checks.state === 'failure' || pullRequest.checks.state === 'error'
        ? 'danger'
        : 'pending';

  return (
    <button className="pr-inbox-row" type="button" onClick={onSelect}>
      <span className="pr-row-accent" data-category={pullRequest.category} />
      <GitPullRequest size={16} className="pr-row-icon" />
      <span className="pr-row-copy">
        <span className="pr-row-title">{pullRequest.title}</span>
        <span className="pr-row-meta">
          {pullRequest.owner}/{pullRequest.repository}#{pullRequest.number}
          <span>·</span>
          {pullRequest.author}
          <span>·</span>
          Updated {formatRelativeTime(pullRequest.updatedAt)}
        </span>
      </span>
      <span className="pr-row-state">
        <CircleDot size={11} data-tone={status.tone} />
        {status.label}
      </span>
      <span className="pr-row-checks" data-tone={checkTone}>
        {checkTone === 'success' ? <Check size={14} /> : checkTone === 'danger' ? <AlertTriangle size={13} /> : <CircleDot size={11} />}
        {pullRequest.checks.total > 0
          ? `${pullRequest.checks.passed}/${pullRequest.checks.total}`
          : 'No checks'}
      </span>
      <span className="pr-row-comments">
        <MessageSquare size={14} />
        {pullRequest.comments}
      </span>
    </button>
  );
}

function InboxMessage({
  icon,
  title,
  detail,
  actionLabel,
  onAction,
  tone
}: {
  icon: ReactElement;
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'danger';
}): ReactElement {
  return (
    <section className="pr-inbox-message" data-tone={tone}>
      <span className="pr-inbox-message-icon">{icon}</span>
      <h1>{title}</h1>
      <p>{detail}</p>
      {actionLabel && onAction ? (
        <button className="btn-primary mt-4 h-8 text-xs" type="button" onClick={onAction}>
          <ShieldCheck size={13} />
          {actionLabel}
        </button>
      ) : null}
    </section>
  );
}

function filterPullRequests(
  pullRequests: GitHubPullRequestSummary[],
  search: string,
  updatedRange: UpdatedRange
): GitHubPullRequestSummary[] {
  const normalizedSearch = search.trim().toLowerCase();
  const earliestTime =
    updatedRange === 'all'
      ? Number.NEGATIVE_INFINITY
      : Date.now() - Number(updatedRange) * 24 * 60 * 60 * 1000;

  return pullRequests.filter((pullRequest) => {
    if (Date.parse(pullRequest.updatedAt) < earliestTime) {
      return false;
    }

    if (!normalizedSearch) {
      return true;
    }

    return [
      pullRequest.title,
      pullRequest.owner,
      pullRequest.repository,
      pullRequest.author,
      String(pullRequest.number)
    ].some((value) => value.toLowerCase().includes(normalizedSearch));
  });
}

function pullRequestStatus(pullRequest: GitHubPullRequestSummary): {
  label: string;
  tone: 'success' | 'danger' | 'pending';
} {
  if (pullRequest.isDraft) {
    return { label: 'Draft', tone: 'pending' };
  }
  if (pullRequest.category === 'needs-your-review' || pullRequest.category === 'needs-team-review') {
    return { label: 'Awaiting review', tone: 'pending' };
  }
  if (pullRequest.reviewDecision === 'approved') {
    return { label: 'Approved', tone: 'success' };
  }
  if (pullRequest.reviewDecision === 'changes-requested') {
    return { label: 'Changes requested', tone: 'danger' };
  }
  return { label: 'Awaiting approval', tone: 'pending' };
}

function formatRelativeTime(value: string): string {
  const differenceMinutes = Math.round((Date.parse(value) - Date.now()) / 60_000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

  if (Math.abs(differenceMinutes) < 60) {
    return formatter.format(differenceMinutes, 'minute');
  }

  const differenceHours = Math.round(differenceMinutes / 60);
  if (Math.abs(differenceHours) < 24) {
    return formatter.format(differenceHours, 'hour');
  }

  return formatter.format(Math.round(differenceHours / 24), 'day');
}

function normalizeUpdatedRange(value: string): UpdatedRange {
  return value === '7' || value === '90' || value === 'all' ? value : '30';
}
