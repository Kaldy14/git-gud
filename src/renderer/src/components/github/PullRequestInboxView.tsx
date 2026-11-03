import { BugFinderButton } from './BugFinderButton';
import type { ReactElement } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  ExternalLink,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Inbox,
  Loader2,
  MessageSquare,
  Search,
  ShieldCheck,
  X
} from 'lucide-react';

import type {
  GitHubPullRequestCategory,
  GitHubPullRequestInbox,
  GitHubPullRequestSummary,
  GitProfile
} from '@shared/types';

import { PullRequestGuideIndicator } from './PullRequestGuideIndicator';
import { PullRequestLineStats } from './PullRequestLineStats';
import { PullRequestReviewerAvatars } from './PullRequestReviewerAvatars';
import { PullRequestRefreshControl } from './PullRequestRefreshControl';
import { resolvePullRequestGroupExpansion } from './pullRequestInboxGroups';
import { pullRequestChecksTone, pullRequestStatus } from './pullRequestInboxStatus';
import {
  loadDismissedPullRequestSuggestionIds,
  saveDismissedPullRequestSuggestionIds
} from './pullRequestSuggestions';

type PullRequestInboxViewProps = {
  profile?: GitProfile;
  inbox?: GitHubPullRequestInbox;
  isLoading: boolean;
  isRefreshing: boolean;
  errorMessage?: string;
  onRefresh: () => void;
  onClose: () => void;
  onOpenProfileSettings: () => void;
  onSelectPullRequest: (pullRequest: GitHubPullRequestSummary, openGuide?: boolean, openBugFinder?: boolean) => void;
};

type UpdatedRange = '7' | '30' | '90' | 'all';

const GROUPS: Array<{
  id: GitHubPullRequestCategory;
  title: string;
  description: string;
}> = [
  {
    id: 'needs-your-review',
    title: 'Needs your review',
    description: 'You were requested directly as a reviewer.'
  },
  {
    id: 'needs-team-review',
    title: "Needs your teams' review",
    description: 'A team you belong to was requested.'
  },
  {
    id: 'needs-action',
    title: 'Needs action',
    description: 'Requested changes or failing checks need attention.'
  },
  {
    id: 'ready-to-merge',
    title: 'Ready to merge',
    description: 'Approved pull requests with successful checks.'
  },
  {
    id: 'waiting',
    title: 'Waiting for review or checks',
    description: 'Your pull requests that are still progressing.'
  },
  {
    id: 'drafts',
    title: 'Your drafts',
    description: 'Open draft pull requests you authored.'
  }
];

type InboxScope = 'all' | 'review-requests' | 'authored' | GitHubPullRequestCategory;

type InboxViewMemory = {
  search: string;
  scope: InboxScope;
  repository: string;
  updatedRange: UpdatedRange;
  expandedGroups: Partial<Record<GitHubPullRequestCategory, boolean>>;
  scrollTop: number;
};

// The inbox unmounts while a pull request is open. Remember filters and scroll for the
// session so Back returns to the same list.
const inboxViewMemory = new Map<string, InboxViewMemory>();

export function PullRequestInboxView({
  profile,
  inbox,
  isLoading,
  isRefreshing,
  errorMessage,
  onRefresh,
  onClose,
  onOpenProfileSettings,
  onSelectPullRequest
}: PullRequestInboxViewProps): ReactElement {
  const memoryKey = profile?.id ?? '';
  const [remembered] = useState(() => inboxViewMemory.get(memoryKey));
  const [search, setSearch] = useState(remembered?.search ?? '');
  const [scope, setScope] = useState<InboxScope>(remembered?.scope ?? 'all');
  const [repository, setRepository] = useState(remembered?.repository ?? 'all');
  const [updatedRange, setUpdatedRange] = useState<UpdatedRange>(remembered?.updatedRange ?? '30');
  const [expandedGroups, setExpandedGroups] = useState<
    Partial<Record<GitHubPullRequestCategory, boolean>>
  >(remembered?.expandedGroups ?? {});
  const resultsRef = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef(remembered?.scrollTop ?? 0);
  useEffect(() => {
    inboxViewMemory.set(memoryKey, { search, scope, repository, updatedRange, expandedGroups, scrollTop: scrollTopRef.current });
  }, [memoryKey, search, scope, repository, updatedRange, expandedGroups]);
  const hasInbox = Boolean(inbox);
  useLayoutEffect(() => {
    if (hasInbox && resultsRef.current) resultsRef.current.scrollTop = scrollTopRef.current;
  }, [hasInbox]);
  const suggestionProfileId = inbox?.profileId ?? profile?.id ?? '';
  const persistedDismissedSuggestions = useMemo(
    () =>
      typeof window === 'undefined' || !suggestionProfileId
        ? new Set<string>()
        : loadDismissedPullRequestSuggestionIds(window.localStorage, suggestionProfileId),
    [suggestionProfileId]
  );
  const [dismissedSuggestions, setDismissedSuggestions] = useState<{
    profileId: string;
    ids: Set<string>;
  }>({ profileId: suggestionProfileId, ids: persistedDismissedSuggestions });
  const dismissedSuggestionIds =
    dismissedSuggestions.profileId === suggestionProfileId
      ? dismissedSuggestions.ids
      : persistedDismissedSuggestions;
  const filteredPullRequests = useMemo(
    () => filterPullRequests(inbox?.pullRequests ?? [], search, updatedRange),
    [inbox?.pullRequests, search, updatedRange]
  );
  const visibleSuggestions = (inbox?.suggestions ?? []).filter(
    (suggestion) => !dismissedSuggestionIds.has(suggestion.id)
  );

  function dismissSuggestion(suggestionId: string): void {
    setDismissedSuggestions((current) => {
      const ids = new Set(
        current.profileId === suggestionProfileId ? current.ids : persistedDismissedSuggestions
      );
      ids.add(suggestionId);

      if (suggestionProfileId) {
        saveDismissedPullRequestSuggestionIds(window.localStorage, suggestionProfileId, ids);
      }

      return { profileId: suggestionProfileId, ids };
    });
  }

  const repositories = [
    ...new Set((inbox?.pullRequests ?? []).map((pr) => `${pr.owner}/${pr.repository}`))
  ].sort();
  const matchesScope = (pr: GitHubPullRequestSummary, candidate: InboxScope): boolean => {
    const requested = pr.category === 'needs-your-review' || pr.category === 'needs-team-review';
    if (candidate === 'all') return true;
    if (candidate === 'review-requests') return requested;
    if (candidate === 'authored') return pr.author === (inbox?.viewerLogin ?? profile?.githubLogin);
    return pr.category === candidate;
  };
  const repositoryPullRequests = filteredPullRequests.filter(
    (pr) => repository === 'all' || `${pr.owner}/${pr.repository}` === repository
  );
  const scopedPullRequests = repositoryPullRequests.filter((pr) => matchesScope(pr, scope));
  const hasActiveFilters = Boolean(search) || scope !== 'all' || repository !== 'all' || updatedRange !== 'all';
  const scopes: Array<{ id: InboxScope; label: string }> = [
    { id: 'all', label: 'All pull requests' },
    { id: 'review-requests', label: 'Review requests' },
    { id: 'authored', label: 'Your pull requests' },
    { id: 'needs-action', label: 'Needs action' },
    { id: 'ready-to-merge', label: 'Ready to merge' },
    { id: 'waiting', label: 'Waiting' },
    { id: 'drafts', label: 'Drafts' }
  ];

  if (!profile?.ghConfigDir || !profile.githubLogin) {
    return (
      <InboxMessage
        icon={<Inbox size={20} />}
        title="Connect a GitHub account"
        detail="Pull request inboxes use the GitHub CLI account attached to the active Git profile."
        actionLabel="Open profile settings"
        onAction={onOpenProfileSettings}
        onClose={onClose}
      />
    );
  }

  if (isLoading && !inbox) {
    return (
      <InboxMessage
        icon={<Loader2 size={20} className="animate-spin" />}
        title="Scanning your pull requests"
        detail={`Reading review requests and authored work for @${profile.githubLogin}.`}
        onClose={onClose}
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
        onClose={onClose}
        tone="danger"
      />
    );
  }

  return (
    <section className="pr-inbox-view" aria-label="Pull request inbox">
      <header className="pr-inbox-header pr-inbox-header--queue">
        <h1>
          Pull requests <span className="pr-count-badge">{inbox?.pullRequests.length ?? 0}</span>
        </h1>
        <span className="pr-inbox-account">@{inbox?.viewerLogin ?? profile.githubLogin}</span>
        <label className="pr-search-field">
          <Search size={14} />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search title, repository, author…"
            aria-label="Search pull requests"
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
        <PullRequestRefreshControl
          lastRefreshedAt={inbox?.loadedAt}
          isRefreshing={isRefreshing}
          errorMessage={errorMessage}
          compact
          onRefresh={onRefresh}
        />
        <button
          className="icon-btn icon-btn-regular"
          type="button"
          onClick={onClose}
          aria-label="Close pull request inbox and return to commit graph"
          title="Return to commit graph"
        >
          <X size={14} />
        </button>
      </header>
      <div className="pr-inbox-workspace">
        <nav className="pr-inbox-scopes" aria-label="Pull request scopes">
          {scopes.map((item) => (
            <button
              type="button"
              key={item.id}
              className={item.id === 'needs-action' ? 'pr-scope-group-start' : undefined}
              aria-current={scope === item.id ? 'page' : undefined}
              onClick={() => setScope(item.id)}
            >
              <span>{item.label}</span>
              <span>{repositoryPullRequests.filter((pr) => matchesScope(pr, item.id)).length}</span>
            </button>
          ))}
          {repositories.length > 0 ? <h2>Repositories</h2> : null}
          {repositories.map((name) => (
            <button
              type="button"
              key={name}
              title={name}
              aria-current={repository === name ? 'page' : undefined}
              aria-pressed={repository === name}
              // Scope and repository combine; clicking the active repository clears it.
              onClick={() => setRepository(repository === name ? 'all' : name)}
            >
              <span>{name}</span>
              <span>
                {
                  filteredPullRequests.filter((pr) => `${pr.owner}/${pr.repository}` === name)
                    .length
                }
              </span>
            </button>
          ))}
        </nav>
        <div
          className="pr-inbox-results"
          ref={resultsRef}
          onScroll={(event) => {
            scrollTopRef.current = event.currentTarget.scrollTop;
            const current = inboxViewMemory.get(memoryKey);
            if (current) current.scrollTop = scrollTopRef.current;
          }}
        >
          {errorMessage ? (
            <div className="pr-inline-error" role="alert">
              <AlertTriangle size={13} />
              <span>{errorMessage}</span>
            </div>
          ) : null}

          {inbox?.suggestionsError ? (
            <div className="pr-inline-warning" role="status">
              <AlertTriangle size={13} />
              <span>{inbox.suggestionsError}</span>
            </div>
          ) : null}

          <div className="pr-inbox-groups">
            {GROUPS.map((group) => {
              const rows = scopedPullRequests.filter(
                (pullRequest) => pullRequest.category === group.id
              );
              if (rows.length === 0) return null;
              const isExpanded = resolvePullRequestGroupExpansion(
                expandedGroups[group.id],
                rows.length
              );

              return (
                <section className="pr-inbox-group" key={group.id}>
                  <button
                    className="pr-group-heading"
                    type="button"
                    aria-expanded={isExpanded}
                    title={group.description}
                    onClick={() =>
                      setExpandedGroups((current) => ({
                        ...current,
                        [group.id]: !resolvePullRequestGroupExpansion(
                          current[group.id],
                          rows.length
                        )
                      }))
                    }
                  >
                    {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    <span>{group.title}</span>
                    <span className="pr-count-badge">{rows.length}</span>
                  </button>
                  {isExpanded ? (
                    <div className="pr-row-list">
                      {rows.map((pullRequest) => (
                        <PullRequestRow
                          key={pullRequest.id}
                          pullRequest={pullRequest}
                          onSelect={() => onSelectPullRequest(pullRequest)}
                          onOpenGuide={() => onSelectPullRequest(pullRequest, true)}
                          onOpenBugFinder={() => onSelectPullRequest(pullRequest, false, true)}
                        />
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
          {scopedPullRequests.length === 0 ? (
            <div className="pr-inbox-empty-results">
              <Inbox size={24} />
              <h2>
                {(inbox?.pullRequests.length ?? 0) === 0
                  ? `No open pull requests for @${profile.githubLogin}`
                  : search || repository !== 'all' || scope !== 'all'
                    ? 'No matching pull requests'
                    : 'No pull requests in this time range'}
              </h2>
              <p>
                {(inbox?.pullRequests.length ?? 0) === 0
                  ? 'Review requests and pull requests you open will appear here.'
                  : 'Change the filters or refresh to check for new pull requests.'}
              </p>
              {(inbox?.pullRequests.length ?? 0) > 0 && hasActiveFilters ? (
                <button
                  className="btn-subtle btn-regular"
                  type="button"
                  onClick={() => {
                    setSearch('');
                    setScope('all');
                    setRepository('all');
                    setUpdatedRange('all');
                  }}
                >
                  Clear filters
                </button>
              ) : (
                <button className="btn-subtle btn-regular" type="button" onClick={onRefresh}>
                  Refresh
                </button>
              )}
            </div>
          ) : null}
          {visibleSuggestions.length ? (
            <section className="pr-create-suggestions" aria-label="Recently pushed branches">
              <div className="pr-create-suggestions-heading">
                <div>
                  <h2>Recently pushed branches</h2>
                  <p>Start a pull request for your branches that do not have one yet.</p>
                </div>
                <span>{visibleSuggestions.length}</span>
              </div>
              <div className="pr-create-suggestion-list">
                {visibleSuggestions.map((suggestion) => (
                  <article className="pr-create-suggestion" key={suggestion.id}>
                    <GitBranch size={15} aria-hidden="true" />
                    <span className="pr-create-suggestion-copy">
                      <strong>{suggestion.branch}</strong>
                      <span>
                        {suggestion.owner}/{suggestion.repository} · pushed{' '}
                        {formatRelativeTime(suggestion.pushedAt)}
                      </span>
                    </span>
                    <a
                      className="pr-create-suggestion-action"
                      href={suggestion.compareUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={`Compare ${suggestion.branch} with ${suggestion.defaultBranch} and create a pull request on GitHub`}
                    >
                      Compare &amp; create pull request
                      <ExternalLink size={12} aria-hidden="true" />
                    </a>
                    <button
                      className="icon-btn icon-btn-compact pr-create-suggestion-dismiss"
                      type="button"
                      aria-label={`Dismiss pull request suggestion for ${suggestion.branch}`}
                      title="Dismiss suggestion"
                      onClick={() => dismissSuggestion(suggestion.id)}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function PullRequestRow({
  pullRequest,
  onSelect,
  onOpenGuide,
  onOpenBugFinder
}: {
  pullRequest: GitHubPullRequestSummary;
  onSelect: () => void;
  onOpenGuide: () => void;
  onOpenBugFinder: () => void;
}): ReactElement {
  const [didAvatarFail, setDidAvatarFail] = useState(false);
  const status = pullRequestStatus(pullRequest);
  const checkTone = pullRequestChecksTone(pullRequest.checks);

  return (
    <div className="pr-inbox-row" onClick={onSelect}>
      <button className="pr-row-open" type="button" aria-label={`Open pull request ${pullRequest.title}`} />
      <span className="pr-row-accent" data-category={pullRequest.category} />
      <GitPullRequest size={16} className="pr-row-icon" />
      <span className="pr-row-copy">
        <span className="pr-row-title">{pullRequest.title}</span>
        <span className="pr-row-meta">
          {pullRequest.owner}/{pullRequest.repository}#{pullRequest.number}
          <span>·</span>
          <PullRequestLineStats additions={pullRequest.additions} deletions={pullRequest.deletions} />
          <span>·</span>
          <span className="pr-row-author">
            {pullRequest.authorAvatarUrl && !didAvatarFail ? (
              <img
                className="pr-row-author-avatar"
                src={pullRequest.authorAvatarUrl}
                alt=""
                aria-hidden="true"
                referrerPolicy="no-referrer"
                onError={() => setDidAvatarFail(true)}
              />
            ) : (
              <span className="pr-row-author-avatar" aria-hidden="true">
                {pullRequest.author.slice(0, 1).toUpperCase()}
              </span>
            )}
            {pullRequest.author}
          </span>
          <span>·</span>
          Updated {formatRelativeTime(pullRequest.updatedAt)}
        </span>
      </span>
      <span className="pr-row-state">
        <PullRequestReviewerAvatars reviewers={pullRequest.reviewers} />
        {status.icon === 'warning' ? (
          <AlertTriangle size={13} data-tone={status.tone} />
        ) : status.icon === 'check' ? (
          <Check size={13} data-tone={status.tone} />
        ) : status.icon === 'merge' ? (
          <GitMerge size={13} data-tone={status.tone} />
        ) : (
          <CircleDot size={11} data-tone={status.tone} />
        )}
        <span className="pr-row-label" title={status.label}>{status.label}</span>
      </span>
      <span className="pr-row-checks" data-tone={checkTone} title={checksTitle(pullRequest.checks)}>
        {checkTone === 'success' ? <Check size={14} /> : checkTone === 'danger' ? <AlertTriangle size={13} /> : <CircleDot size={11} />}
        {/* Skipped and neutral runs count toward GitHub's total but are not outstanding. */}
        {pullRequest.checks.total > 0
          ? <span className="pr-row-label">{pullRequest.checks.passed}/{pullRequest.checks.passed + pullRequest.checks.failed + pullRequest.checks.pending}</span>
          : <span aria-label="No checks">–</span>}
      </span>
      <PullRequestGuideIndicator pullRequest={pullRequest} onOpen={onOpenGuide} />
      <BugFinderButton pullRequest={pullRequest} onOpen={onOpenBugFinder} />
      <span className="pr-row-comments" aria-label={`${pullRequest.comments} comments`}>
        <MessageSquare size={14} />
        <span>{pullRequest.comments}</span>
      </span>
    </div>
  );
}

function checksTitle(checks: GitHubPullRequestSummary['checks']): string {
  if (checks.total === 0) return 'No checks reported';
  const skipped = Math.max(0, checks.total - checks.passed - checks.failed - checks.pending);
  return [
    `${checks.passed} passed`,
    checks.failed ? `${checks.failed} failed` : '',
    checks.pending ? `${checks.pending} pending` : '',
    skipped ? `${skipped} skipped` : ''
  ].filter(Boolean).join(' · ');
}

function InboxMessage({
  icon,
  title,
  detail,
  actionLabel,
  onAction,
  onClose,
  tone
}: {
  icon: ReactElement;
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
  onClose: () => void;
  tone?: 'danger';
}): ReactElement {
  return (
    <section className="pr-inbox-message" data-tone={tone}>
      <button
        className="icon-btn absolute right-3 top-3 h-8 w-8"
        type="button"
        onClick={onClose}
        aria-label="Close pull request inbox and return to commit graph"
        title="Return to commit graph"
      >
        <X size={14} />
      </button>
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
