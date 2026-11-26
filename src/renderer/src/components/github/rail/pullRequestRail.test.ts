import { describe, expect, it } from 'vitest';

import type { GitHubPullRequestCategory, GitHubPullRequestSummary } from '@shared/types';
import { matchesPullRequestSearch } from '../pullRequestInboxGroups';
import { adjacentRailRow, buildRailSections, pullRequestKey, visibleRailOrder } from './pullRequestRailModel';
import { isRailFloating, isRailOpen, railTabKind } from './pullRequestRailVisibility';

function pr(number: number, category: GitHubPullRequestCategory, extra: Partial<GitHubPullRequestSummary> = {}): GitHubPullRequestSummary {
  return {
    profileId: 'p',
    owner: 'acme',
    repository: 'widgets',
    number,
    id: `id-${number}`,
    title: `Change ${number}`,
    url: `https://github.com/acme/widgets/pull/${number}`,
    author: 'ana',
    updatedAt: '2026-11-01T00:00:00Z',
    category,
    isDraft: false,
    reviewDecision: 'unknown',
    mergeState: 'clean',
    mergeable: 'mergeable',
    canMerge: true,
    reviewers: [],
    comments: 0,
    changedFiles: 1,
    additions: 1,
    deletions: 0,
    headRefName: 'feature',
    baseRefName: 'main',
    checks: { state: 'success', total: 0, passed: 0, failed: 0, pending: 0 },
    ...extra
  };
}

const numbers = (rows: readonly GitHubPullRequestSummary[]) => rows.map((row) => row.number);

describe('rail sections', () => {
  const inbox = [pr(1, 'ready-to-merge'), pr(2, 'needs-your-review'), pr(3, 'needs-action'), pr(4, 'needs-your-review')];

  it('groups in the inbox order and puts a pull request opened from elsewhere under Viewing first', () => {
    const sections = buildRailSections(inbox, [pr(9, 'waiting'), pr(1, 'ready-to-merge')], '');
    expect(sections.map((section) => [section.id, numbers(section.rows)])).toEqual([
      ['viewing', [9]],
      ['needs-your-review', [2, 4]],
      ['needs-action', [3]],
      ['ready-to-merge', [1]]
    ]);
  });

  it('filters by title, repository, author and number, and drops empty groups', () => {
    const rows = [pr(12, 'waiting', { title: 'Fix the rail' }), pr(34, 'waiting', { author: 'bob', repository: 'gadgets' })];
    expect(numbers(buildRailSections(rows, [], 'rail').flatMap((section) => section.rows))).toEqual([12]);
    expect(numbers(buildRailSections(rows, [], 'acme/gadgets').flatMap((section) => section.rows))).toEqual([34]);
    expect(numbers(buildRailSections(rows, [], 'BOB').flatMap((section) => section.rows))).toEqual([34]);
    expect(numbers(buildRailSections(rows, [], '#12').flatMap((section) => section.rows))).toEqual([12]);
    expect(buildRailSections(rows, [], 'nothing')).toEqual([]);
    expect(matchesPullRequestSearch(rows[0]!, '  ')).toBe(true);
  });
});

describe('rail navigation', () => {
  const sections = buildRailSections([pr(1, 'needs-your-review'), pr(2, 'needs-your-review'), pr(3, 'needs-action'), pr(4, 'ready-to-merge')], [], '');

  it('walks the visible order and skips collapsed groups', () => {
    expect(numbers(visibleRailOrder(sections, {}))).toEqual([1, 2, 3, 4]);
    const order = visibleRailOrder(sections, { 'needs-action': false });
    expect(numbers(order)).toEqual([1, 2, 4]);
    expect(adjacentRailRow(order, pullRequestKey(pr(2, 'needs-your-review')), 1, 1)?.pullRequest.number).toBe(4);
  });

  it('stops at the first and last row', () => {
    const order = visibleRailOrder(sections, {});
    expect(adjacentRailRow(order, pullRequestKey(pr(4, 'ready-to-merge')), 3, 1)).toBeUndefined();
    expect(adjacentRailRow(order, pullRequestKey(pr(1, 'needs-your-review')), 0, -1)).toBeUndefined();
  });

  it('continues from the old position when the open pull request left the list', () => {
    // #2 was at index 1 and is gone: #3 now sits there.
    const order = visibleRailOrder(buildRailSections([pr(1, 'needs-your-review'), pr(3, 'needs-action'), pr(4, 'ready-to-merge')], [], ''), {});
    const gone = pullRequestKey(pr(2, 'needs-your-review'));
    expect(adjacentRailRow(order, gone, 1, 1)).toEqual({ pullRequest: order[1], index: 1 });
    expect(adjacentRailRow(order, gone, 1, -1)).toEqual({ pullRequest: order[0], index: 0 });
    // It was last: J has nowhere to go, K goes to the new last row.
    expect(adjacentRailRow(order, gone, 3, 1)).toBeUndefined();
    expect(adjacentRailRow(order, gone, 3, -1)?.pullRequest.number).toBe(4);
  });
});

describe('rail visibility', () => {
  it('opens for reading tabs from 1240px and for code tabs from 1840px by default', () => {
    expect(railTabKind('overview')).toBe('reading');
    expect(railTabKind('conversation')).toBe('reading');
    expect(railTabKind('tour')).toBe('code');
    expect(railTabKind('code')).toBe('code');
    const open = (width: number, kind: 'reading' | 'code') => isRailOpen({ width, kind, saved: {}, floatingOpen: false });
    expect(open(1240, 'reading')).toBe(true);
    expect(open(1839, 'code')).toBe(false);
    expect(open(1840, 'code')).toBe(true);
  });

  it('remembers each tab kind separately when docked', () => {
    expect(isRailOpen({ width: 1800, kind: 'reading', saved: { reading: false }, floatingOpen: false })).toBe(false);
    expect(isRailOpen({ width: 1300, kind: 'code', saved: { code: true }, floatingOpen: false })).toBe(true);
  });

  it('floats below 1240px, closed until opened, ignoring saved choices', () => {
    expect(isRailFloating(1239)).toBe(true);
    expect(isRailFloating(1240)).toBe(false);
    expect(isRailOpen({ width: 1100, kind: 'reading', saved: { reading: true }, floatingOpen: false })).toBe(false);
    expect(isRailOpen({ width: 1100, kind: 'code', saved: {}, floatingOpen: true })).toBe(true);
  });
});
