import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactElement, type RefObject } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Search, X } from 'lucide-react';

import type { GitHubPullRequestSummary } from '@shared/types';
import { pullRequestChecksTone, pullRequestStatus } from '../pullRequestInboxStatus';
import { PullRequestRefreshControl } from '../PullRequestRefreshControl';
import { PullRequestStatusIcon } from '../PullRequestStatusIcon';
import { isRailSectionExpanded, pullRequestKey, type RailExpansion, type RailSection, type RailSectionId } from './pullRequestRailModel';

export type PullRequestListRailProps = {
  id: string;
  sections: readonly RailSection[];
  expansion: RailExpansion;
  /** The row shown as selected: the open pull request, or the one J/K just moved to. */
  selectedKey: string;
  totalCount: number;
  omittedCount?: number;
  isLoading: boolean;
  isRefreshing: boolean;
  errorMessage?: string;
  lastRefreshedAt?: string;
  search: string;
  searchRef: RefObject<HTMLInputElement | null>;
  floating: boolean;
  onSearchChange: (search: string) => void;
  onToggleSection: (id: RailSectionId) => void;
  onSelect: (pullRequest: GitHubPullRequestSummary) => void;
  onRefresh: () => void;
  onClose: () => void;
};

/**
 * The queue beside the open pull request: the profile's whole inbox, grouped as the inbox groups it.
 * A tree with one tab stop: ↑/↓, Home/End move, ←/→ fold groups, Enter opens. J/K work from anywhere.
 */
export function PullRequestListRail(props: PullRequestListRailProps): ReactElement {
  const { id, sections, expansion, selectedKey, totalCount, omittedCount, isLoading, errorMessage, search, searchRef, floating } = props;
  const treeRef = useRef<HTMLDivElement>(null);
  const spansRepositories = new Set(sections.flatMap((section) => section.rows.map((row) => `${row.owner}/${row.repository}`))).size > 1;
  const hasSelectedRow = sections.some((section) => isRailSectionExpanded(section, expansion) && section.rows.some((row) => pullRequestKey(row) === selectedKey));

  // Keep the selected row in view; when the list has focus, focus follows J/K so arrows continue from there.
  useEffect(() => {
    const tree = treeRef.current;
    const row = tree?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(selectedKey)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest' });
    if (tree?.contains(document.activeElement) && document.activeElement !== row) row.focus({ preventScroll: true });
  }, [selectedKey]);

  // One highlight slides to the selected row, so J/K reads as moving through the list. It is placed again
  // whenever the rows can have moved (a group folding, rows arriving, a search) and slides only when the
  // selection itself changed.
  const highlighted = useRef(selectedKey);
  useLayoutEffect(() => {
    placeRailHighlight(treeRef.current, highlighted.current !== selectedKey);
    highlighted.current = selectedKey;
  }, [selectedKey, sections, expansion, search, isLoading]);
  useEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;
    // A width change re-wraps titles, which moves every row below.
    const observer = new ResizeObserver(() => placeRailHighlight(tree, false));
    observer.observe(tree);
    return () => observer.disconnect();
  }, [isLoading]);

  function onTreeKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const items = [...(treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])];
    const current = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    const index = current ? items.indexOf(current) : -1;
    const isSection = current?.dataset.sectionId !== undefined;
    const focus = (item: HTMLElement | undefined) => {
      if (!item) return;
      event.preventDefault();
      item.focus();
      item.scrollIntoView({ block: 'nearest' });
    };

    switch (event.key) {
      case 'ArrowDown': focus(items[index + 1]); return;
      case 'ArrowUp': focus(items[Math.max(0, index - 1)]); return;
      case 'Home': focus(items[0]); return;
      case 'End': focus(items.at(-1)); return;
      case 'ArrowRight':
        if (isSection && current?.getAttribute('aria-expanded') === 'false') {
          event.preventDefault();
          props.onToggleSection(current.dataset.sectionId as RailSectionId);
        } else if (isSection) focus(items[index + 1]);
        return;
      case 'ArrowLeft':
        if (isSection && current?.getAttribute('aria-expanded') === 'true') {
          event.preventDefault();
          props.onToggleSection(current.dataset.sectionId as RailSectionId);
        } else if (!isSection) focus(current?.parentElement?.closest<HTMLElement>('[role="treeitem"]') ?? undefined);
        return;
      case 'Enter':
      case ' ':
        if (!current) return;
        event.preventDefault();
        if (isSection) props.onToggleSection(current.dataset.sectionId as RailSectionId);
        else current.click();
        return;
      case 'Escape':
        if (floating) { event.preventDefault(); props.onClose(); }
    }
  }

  return (
    <nav className="pr-rail" id={id} data-floating={floating || undefined} aria-label="Pull request list">
      <header className="pr-rail-header">
        <h2>
          Pull requests
          <span className="pr-rail-count" aria-label={`${totalCount} open`}>{totalCount}</span>
        </h2>
        <PullRequestRefreshControl
          lastRefreshedAt={props.lastRefreshedAt}
          isRefreshing={props.isRefreshing}
          errorMessage={errorMessage}
          compact
          onRefresh={props.onRefresh}
        />
        {/* Floating over a narrow window it covers the header's toggle, so it carries its own close. */}
        {floating ? (
          <button className="icon-btn icon-btn-compact" type="button" aria-label="Close pull request list" title="Close (Esc)" onClick={props.onClose}>
            <X size={14} />
          </button>
        ) : null}
      </header>
      <label className="pr-rail-search">
        <Search size={14} aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          value={search}
          placeholder="Search pull requests"
          aria-label="Search pull requests by title, repository, author or number"
          onChange={(event) => props.onSearchChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && search) {
              event.preventDefault();
              event.stopPropagation();
              props.onSearchChange('');
            } else if (event.key === 'Escape' && floating) {
              event.preventDefault();
              props.onClose();
            } else if (event.key === 'Escape') {
              // Nothing left to clear: leave the field so J/K and the other single keys work again.
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === 'ArrowDown' || event.key === 'Enter') {
              // Into the list: the first match, so search + Enter opens it.
              const first = treeRef.current?.querySelector<HTMLElement>('[role="treeitem"][data-row-key]');
              if (!first) return;
              event.preventDefault();
              if (event.key === 'Enter') first.click();
              else first.focus();
            }
          }}
        />
        {search ? null : <kbd aria-hidden="true">/</kbd>}
      </label>

      {isLoading && totalCount === 0 ? (
        <div className="pr-rail-skeleton" aria-busy="true" aria-label="Loading pull requests">
          {Array.from({ length: 5 }, (_, index) => <span key={index}><b /><i /></span>)}
        </div>
      ) : (
        <div
          ref={treeRef}
          className="pr-rail-tree"
          role="tree"
          aria-label="Pull requests"
          onKeyDown={onTreeKeyDown}
        >
          <span className="pr-rail-highlight" role="presentation" aria-hidden="true" />
          {errorMessage && totalCount === 0 ? (
            <div className="pr-rail-message" data-tone="danger" role="alert">
              <AlertTriangle size={14} aria-hidden="true" />
              <span>Could not load the inbox. {errorMessage}</span>
              <button className="btn-subtle btn-compact" type="button" onClick={props.onRefresh}>Try again</button>
            </div>
          ) : null}
          {sections.map((section, sectionIndex) => {
            const expanded = isRailSectionExpanded(section, expansion);
            return (
              <div
                key={section.id}
                className="pr-rail-section"
                role="treeitem"
                aria-level={1}
                aria-expanded={expanded}
                aria-label={`${section.title}, ${section.rows.length}`}
                data-section-id={section.id}
                tabIndex={!hasSelectedRow && sectionIndex === 0 ? 0 : -1}
              >
                <div className="pr-rail-section-heading" title={section.description} onClick={() => props.onToggleSection(section.id)}>
                  {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                  <span>{section.title}</span>
                  <span className="pr-rail-section-count">{section.rows.length}</span>
                </div>
                {expanded ? (
                  <div role="group">
                    {section.rows.map((pullRequest) => (
                      <RailRow
                        key={pullRequestKey(pullRequest)}
                        pullRequest={pullRequest}
                        selected={pullRequestKey(pullRequest) === selectedKey}
                        showRepository={spansRepositories}
                        onSelect={props.onSelect}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
          {sections.length === 0 && !(errorMessage && totalCount === 0) ? (
            <div className="pr-rail-message">
              {search ? (
                <>
                  <span>No pull requests match “{search}”.</span>
                  <button className="btn-subtle btn-compact" type="button" onClick={() => props.onSearchChange('')}>
                    <X size={12} aria-hidden="true" />
                    Clear search
                  </button>
                </>
              ) : <span>No open pull requests need you.</span>}
            </div>
          ) : null}
        </div>
      )}
      {omittedCount ? (
        <p className="pr-rail-foot">
          {omittedCount} older {omittedCount === 1 ? 'match' : 'matches'} not shown; GitHub returns the latest 50 per list.
        </p>
      ) : null}
    </nav>
  );
}

// A step to a neighbour slides; a jump across the list would streak over everything between, so it snaps.
const RAIL_SLIDE_MAX_DISTANCE = 200;

function placeRailHighlight(tree: HTMLElement | null, slide: boolean): void {
  if (!tree) return;
  const row = tree.querySelector<HTMLElement>('.pr-rail-row[aria-selected="true"]');
  // The selected row can be folded away or filtered out: the highlight leaves with it.
  if (!row) {
    tree.removeAttribute('data-highlight');
    return;
  }
  const rect = row.getBoundingClientRect();
  const top = Math.round(rect.top - tree.getBoundingClientRect().top + tree.scrollTop);
  const y = `${top}px`;
  // Both edges are rounded, so the highlight ends exactly where the row does at any zoom.
  const height = `${Math.round(rect.bottom) - Math.round(rect.top)}px`;
  const placed = tree.hasAttribute('data-highlight');
  const previous = Number.parseFloat(tree.style.getPropertyValue('--rail-highlight-y'));
  if (placed && previous === top && tree.style.getPropertyValue('--rail-highlight-height') === height) return;
  if (!slide || !placed || Math.abs(top - previous) > RAIL_SLIDE_MAX_DISTANCE) tree.removeAttribute('data-highlight-slide');
  tree.style.setProperty('--rail-highlight-y', y);
  tree.style.setProperty('--rail-highlight-height', height);
  tree.setAttribute('data-highlight', '');
  if (tree.hasAttribute('data-highlight-slide')) return;
  // Commit the new place while the transition is off, then allow slides again (a frame callback would
  // run before the style pass and the snap would slide).
  void tree.offsetHeight;
  tree.setAttribute('data-highlight-slide', '');
}

function RailRow({ pullRequest, selected, showRepository, onSelect }: {
  pullRequest: GitHubPullRequestSummary;
  selected: boolean;
  showRepository: boolean;
  onSelect: (pullRequest: GitHubPullRequestSummary) => void;
}): ReactElement {
  const status = pullRequestStatus(pullRequest);
  const { checks } = pullRequest;
  const checksTone = pullRequestChecksTone(checks);
  // Skipped and neutral runs count toward GitHub's total but are not outstanding.
  const checksCounted = checks.passed + checks.failed + checks.pending;

  return (
    <div
      className="pr-rail-row"
      role="treeitem"
      aria-level={2}
      aria-selected={selected}
      data-row-key={pullRequestKey(pullRequest)}
      tabIndex={selected ? 0 : -1}
      onClick={() => onSelect(pullRequest)}
    >
      <span className="pr-rail-row-status" data-tone={status.tone} title={status.label}>
        <PullRequestStatusIcon icon={status.icon} size={14} />
        <span className="sr-only">{status.label}.</span>
      </span>
      <span className="pr-rail-row-copy">
        <span className="pr-rail-row-title" title={pullRequest.title}>
          <span className="pr-rail-row-number">#{pullRequest.number}</span> {pullRequest.title}
        </span>
        <span className="pr-rail-row-meta">
          {showRepository ? <span className="pr-rail-row-repo">{pullRequest.repository}</span> : null}
          <span className="pr-rail-row-author">{pullRequest.author}</span>
          <time dateTime={pullRequest.updatedAt} title={new Date(pullRequest.updatedAt).toLocaleString()}>{formatAge(pullRequest.updatedAt)}</time>
          {checks.total > 0 && checksCounted > 0 ? (
            <span className="pr-rail-row-checks" data-tone={checksTone} title={checksTitle(checks)}>
              {checks.passed}/{checksCounted}
              <span className="sr-only"> checks passed</span>
            </span>
          ) : null}
        </span>
      </span>
    </div>
  );
}

function checksTitle(checks: GitHubPullRequestSummary['checks']): string {
  const skipped = Math.max(0, checks.total - checks.passed - checks.failed - checks.pending);
  return [
    `${checks.passed} passed`,
    checks.failed ? `${checks.failed} failed` : '',
    checks.pending ? `${checks.pending} running` : '',
    skipped ? `${skipped} skipped` : ''
  ].filter(Boolean).join(' · ');
}

/** Compact age for a 280px row: 5m, 3h, 12d, then a date. */
export function formatAge(value: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(value)) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 60) return `${days}d`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
