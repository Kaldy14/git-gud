import { BugFinderButton } from './BugFinderButton';
import type { ReactElement } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitBranch,
  Inbox,
  CircleDotDashed,
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
import { pullRequestLineBreakdown } from '@shared/lineBreakdown';
import { PullRequestLineStats } from './PullRequestLineStats';
import { PullRequestReviewerAvatars } from './PullRequestReviewerAvatars';
import { PullRequestRefreshControl } from './PullRequestRefreshControl';
import { matchesPullRequestSearch, PULL_REQUEST_INBOX_GROUPS, resolvePullRequestGroupExpansion } from './pullRequestInboxGroups';
import { pullRequestChecksTone, pullRequestStatus } from './pullRequestInboxStatus';
import { PullRequestStatusIcon } from './PullRequestStatusIcon';
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

  // J/K move between pull request rows (Enter opens), while focus is in the list or nowhere.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const results = resultsRef.current;
      if (!results || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key !== 'j' && event.key !== 'k') return;
      const target = event.target instanceof Element ? event.target : null;
      if (target && target !== document.body && !results.contains(target)) return;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const rows = [...results.querySelectorAll<HTMLButtonElement>('.pr-row-open')];
      if (rows.length === 0) return;
      event.preventDefault();
      const current = rows.findIndex((row) => row.parentElement?.contains(document.activeElement));
      const next = current === -1 ? 0 : Math.max(0, Math.min(rows.length - 1, current + (event.key === 'j' ? 1 : -1)));
      rows[next].focus();
      rows[next].parentElement?.scrollIntoView({ block: 'nearest' });
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
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
  // Status categories are not listed here: the results are already grouped by them, and each
  // group heading offers "Show only" to narrow to that category.
  const scopes: Array<{ id: InboxScope; label: string }> = [
    { id: 'all', label: 'All pull requests' },
    { id: 'review-requests', label: 'Review requests' },
    { id: 'authored', label: 'Your pull requests' }
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
    return <InboxSkeleton login={profile.githubLogin} onClose={onClose} />;
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
          <X size={16} />
        </button>
      </header>
      <div className="pr-inbox-workspace">
        <nav className="pr-inbox-scopes" aria-label="Pull request scopes">
          <h2>Inbox</h2>
          {scopes.map((item) => (
            <button
              type="button"
              key={item.id}
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
              <AlertTriangle size={14} />
              <span>{errorMessage}</span>
            </div>
          ) : null}

          {inbox?.suggestionsError ? (
            <div className="pr-inline-warning" role="status">
              <AlertTriangle size={14} />
              <span>{inbox.suggestionsError}</span>
              <button className="btn-subtle btn-compact" type="button" aria-disabled={isRefreshing || undefined} onClick={() => {
                if (isRefreshing || !profile) return;
                void window.api.retryGitHubPullRequestSuggestions(profile.id).then(onRefresh);
              }}>
                Retry
              </button>
            </div>
          ) : null}

          <div className="pr-inbox-groups">
            {PULL_REQUEST_INBOX_GROUPS.map((group) => {
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
                  <div className="pr-group-heading-row">
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
                      {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      <span>{group.title}</span>
                      <span className="pr-count-badge">{rows.length}</span>
                    </button>
                    <button
                      className="pr-group-filter"
                      type="button"
                      data-active={scope === group.id || undefined}
                      aria-label={scope === group.id ? 'Show all pull requests' : `Show only ${group.title.toLowerCase()}`}
                      onClick={() => setScope(scope === group.id ? 'all' : group.id)}
                    >
                      {scope === group.id ? 'Show all' : 'Show only'}
                    </button>
                  </div>
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
              <Inbox size={20} />
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
          {inbox ? (
            <p className="pr-inbox-scope-note">
              Showing review requests and pull requests you opened.
              {inbox.omittedCount ? ` ${inbox.omittedCount} older ${inbox.omittedCount === 1 ? 'match is' : 'matches are'} not loaded; GitHub returns the latest 50 per list.` : ''}
            </p>
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
                    <GitBranch size={16} aria-hidden="true" />
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
      <span className="pr-row-status-tile" data-tone={status.tone} aria-hidden="true">
        <PullRequestStatusIcon icon={status.icon} size={14} />
      </span>
      <span className="pr-row-copy">
        <span className="pr-row-title" title={pullRequest.title}>{pullRequest.title}</span>
        <span className="pr-row-meta">
          {pullRequest.owner}/{pullRequest.repository}#{pullRequest.number}
          <span>·</span>
          <PullRequestLineStats additions={pullRequest.additions} deletions={pullRequest.deletions} breakdown={pullRequestLineBreakdown(pullRequest)} />
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
            <span className="pr-row-author-name">{pullRequest.author}</span>
          </span>
          <span>·</span>
          <span className="pr-row-updated">Updated {formatRelativeTime(pullRequest.updatedAt)}</span>
        </span>
      </span>
      <span className="pr-row-state">
        <PullRequestReviewerAvatars reviewers={pullRequest.reviewers} />
        <span className="pr-row-label" data-tone={status.tone} title={status.label}>{status.label}</span>
      </span>
      <span className="pr-row-checks" data-tone={checkTone} title={checksTitle(pullRequest.checks)}>
        <PullRequestStatusIcon icon={checkTone === 'success' ? 'check' : checkTone === 'danger' ? 'failing' : checkTone === 'pending' ? 'running' : 'dot'} size={14} />
        {/* Skipped and neutral runs count toward GitHub's total but are not outstanding. */}
        {pullRequest.checks.total > 0
          ? <span className="pr-row-label">{pullRequest.checks.passed}/{pullRequest.checks.passed + pullRequest.checks.failed + pullRequest.checks.pending}</span>
          : <span aria-label="No checks">–</span>}
      </span>
      <PullRequestGuideIndicator pullRequest={pullRequest} onOpen={onOpenGuide} />
      <BugFinderButton pullRequest={pullRequest} onOpen={onOpenBugFinder} />
      <span className="pr-row-comments" data-empty={pullRequest.comments === 0 || undefined} aria-label={`${pullRequest.comments} comments`}>
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

/** The inbox's own shape while the first load runs: header, scopes and rows as static placeholders. */
function InboxSkeleton({ login, onClose }: { login: string; onClose: () => void }): ReactElement {
  return (
    <section className="pr-inbox-view pr-inbox-loading" aria-label="Pull request inbox" aria-busy="true">
      <header className="pr-inbox-header pr-inbox-header--queue">
        <h1>Pull requests <span className="pr-count-badge pr-inbox-loading-count" aria-hidden="true" /></h1>
        <span className="pr-inbox-account">@{login}</span>
        <span className="pr-inbox-loading-status" role="status">
          <CircleDotDashed size={14} aria-hidden="true" />
          <span>Reading review requests and your pull requests</span>
        </span>
        {/* Stand-ins for the search field, the date range and Live/refresh, at their sizes. */}
        <span className="pr-inbox-loading-control" data-shape="search" aria-hidden="true" />
        <span className="pr-inbox-loading-control" data-shape="range" aria-hidden="true" />
        <span className="pr-inbox-loading-control" data-shape="refresh" aria-hidden="true" />
        <button
          className="icon-btn icon-btn-regular"
          type="button"
          onClick={onClose}
          aria-label="Close pull request inbox and return to commit graph"
          title="Return to commit graph"
        >
          <X size={16} />
        </button>
      </header>
      <div className="pr-inbox-workspace" aria-hidden="true">
        <div className="pr-inbox-scopes">
          <h2>Inbox</h2>
          {[108, 96, 120].map((width) => <span key={width}><b style={{ width }} /></span>)}
          <h2>Repositories</h2>
          <span><b style={{ width: 104 }} /></span>
        </div>
        <div className="pr-inbox-results">
          {[2, 3, 1].map((rows, group) => (
            <div className="pr-inbox-loading-group" key={group}>
              <div><b /></div>
              {Array.from({ length: rows }, (_, row) => (
                // The loaded row's own classes, so its grid and its narrow-window forms apply here too.
                <div className="pr-inbox-row pr-inbox-loading-row" key={row}>
                  <i />
                  <span className="pr-row-copy"><b /><b /></span>
                  <span className="pr-row-state"><b /></span>
                  <span className="pr-row-checks"><b /></span>
                  <span className="pr-row-job"><i /></span>
                  <span className="pr-row-job"><i /></span>
                  <span className="pr-row-comments"><b /></span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
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
        <X size={16} />
      </button>
      <span className="pr-inbox-message-icon">{icon}</span>
      <h1>{title}</h1>
      <p>{detail}</p>
      {actionLabel && onAction ? (
        <button className="btn-primary mt-4 h-8 text-xs" type="button" onClick={onAction}>
          <ShieldCheck size={14} />
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
  const earliestTime =
    updatedRange === 'all'
      ? Number.NEGATIVE_INFINITY
      : Date.now() - Number(updatedRange) * 24 * 60 * 60 * 1000;

  return pullRequests.filter(
    (pullRequest) => Date.parse(pullRequest.updatedAt) >= earliestTime && matchesPullRequestSearch(pullRequest, search)
  );
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
