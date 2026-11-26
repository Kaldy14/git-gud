import type { GitHubPullRequestCategory, GitHubPullRequestSummary } from '@shared/types';

import { matchesPullRequestSearch, PULL_REQUEST_INBOX_GROUPS, resolvePullRequestGroupExpansion } from '../pullRequestInboxGroups';

// The rail's model: the inbox grouped as the inbox page groups it, a "Viewing" group for pull requests
// opened from elsewhere, and the visible order J/K walk.

export type RailSectionId = 'viewing' | GitHubPullRequestCategory;
export type RailSection = { id: RailSectionId; title: string; description: string; rows: GitHubPullRequestSummary[] };
export type RailExpansion = Partial<Record<RailSectionId, boolean>>;

/** One identity for a pull request across the inbox, deep links and the detail. */
export function pullRequestKey(pullRequest: Pick<GitHubPullRequestSummary, 'owner' | 'repository' | 'number'>): string {
  return `${pullRequest.owner}/${pullRequest.repository}#${pullRequest.number}`.toLowerCase();
}

/** Sections with at least one row matching `search`; "Viewing" first, then the inbox groups in order. */
export function buildRailSections(
  inbox: readonly GitHubPullRequestSummary[],
  viewing: readonly GitHubPullRequestSummary[],
  search: string
): RailSection[] {
  const inInbox = new Set(inbox.map(pullRequestKey));
  const matches = (pullRequest: GitHubPullRequestSummary) => matchesPullRequestSearch(pullRequest, search);
  const sections: RailSection[] = [{
    id: 'viewing',
    title: 'Viewing',
    description: 'Opened from a link; not in your inbox.',
    rows: viewing.filter((pullRequest) => !inInbox.has(pullRequestKey(pullRequest)) && matches(pullRequest))
  }];
  for (const group of PULL_REQUEST_INBOX_GROUPS) {
    sections.push({ ...group, rows: inbox.filter((pullRequest) => pullRequest.category === group.id && matches(pullRequest)) });
  }
  return sections.filter((section) => section.rows.length > 0);
}

export function isRailSectionExpanded(section: RailSection, expansion: RailExpansion): boolean {
  return resolvePullRequestGroupExpansion(expansion[section.id], section.rows.length);
}

/** The rows J/K walk: every row of every expanded section, top to bottom. */
export function visibleRailOrder(sections: readonly RailSection[], expansion: RailExpansion): GitHubPullRequestSummary[] {
  return sections.flatMap((section) => isRailSectionExpanded(section, expansion) ? section.rows : []);
}

/**
 * The row one step from `currentKey` in `order`, or undefined at either end (J/K do not wrap).
 * When the current pull request has left the list, `lastIndex` (where it was) stands in for it:
 * the row now at that index is the next one, the row before it the previous one.
 */
export function adjacentRailRow(
  order: readonly GitHubPullRequestSummary[],
  currentKey: string,
  lastIndex: number,
  direction: 1 | -1
): { pullRequest: GitHubPullRequestSummary; index: number } | undefined {
  const index = order.findIndex((pullRequest) => pullRequestKey(pullRequest) === currentKey);
  const target = index >= 0
    ? index + direction
    : direction === 1 ? Math.max(0, lastIndex) : Math.min(Math.max(0, lastIndex), order.length) - 1;
  const pullRequest = order[target];
  return target >= 0 && pullRequest ? { pullRequest, index: target } : undefined;
}

// Collapsed groups are remembered per device.
const EXPANSION_KEY = 'git-gud:pr-rail-groups:v1';

export function loadRailExpansion(storage: Pick<Storage, 'getItem'>): RailExpansion {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(EXPANSION_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'boolean'));
  } catch {
    return {};
  }
}

export function saveRailExpansion(storage: Pick<Storage, 'setItem'>, expansion: RailExpansion): void {
  try { storage.setItem(EXPANSION_KEY, JSON.stringify(expansion)); } catch { /* a remembered group is a convenience */ }
}
