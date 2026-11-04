import { describe, expect, it } from 'vitest';

import { filterQuickJumpItems, type QuickJumpSearchable } from './quickJumpSearch';

type Item = QuickJumpSearchable & { label: string };

const action = (label: string): Item => ({ label, scoreTarget: label });
const commit = (subject: string, sha = 'a1b2c3d4e5', authorName = 'Richie', authorEmail?: string): Item => ({
  label: subject,
  scoreTarget: subject,
  commit: { subject, sha, authorName, authorEmail }
});
const labels = (items: Item[]): string[] => items.map((item) => item.label);

describe('command palette search', () => {
  const rebaseCommit = commit('Rebase worktrees before merging');
  const noise = commit('Prevent background fetch starvation across open repositories');

  it('ignores commits that only hold the query as scattered letters', () => {
    expect(labels(filterQuickJumpItems([noise, rebaseCommit], 'rebase', 10))).toEqual(['Rebase worktrees before merging']);
  });

  it('keeps fuzzy matching for actions and refs', () => {
    expect(labels(filterQuickJumpItems([action('Interactive rebase from commit')], 'intrb', 10))).toEqual([
      'Interactive rebase from commit'
    ]);
    expect(labels(filterQuickJumpItems([action('feature/ui-polish-overhaul')], 'fupo', 10))).toEqual([
      'feature/ui-polish-overhaul'
    ]);
  });

  it('ranks an exact action above a commit that mentions the same word', () => {
    const results = filterQuickJumpItems([rebaseCommit, action('Rebase current branch')], 'rebase', 10);

    expect(labels(results)[0]).toBe('Rebase current branch');
  });

  it('ranks a whole-word commit above a scattered action', () => {
    const results = filterQuickJumpItems([action('Reset branch with a side'), commit('Fix rebase conflict view')], 'rebase', 10);

    expect(labels(results)).toEqual(['Fix rebase conflict view', 'Reset branch with a side']);
  });

  it('requires every query word in a commit, in any order', () => {
    const items = [commit('Fix sidebar width'), commit('Fix graph width')];

    expect(labels(filterQuickJumpItems(items, 'width graph', 10))).toEqual(['Fix graph width']);
  });

  it('matches word parts of a subject and prefers word starts', () => {
    const items = [commit('Prebuild assets'), commit('Build release assets')];

    expect(labels(filterQuickJumpItems(items, 'build', 10))).toEqual(['Build release assets', 'Prebuild assets']);
  });

  it('finds commits by SHA prefix of four or more characters only', () => {
    const item = commit('Unrelated subject', 'deadbeef12');

    expect(filterQuickJumpItems([item], 'dead', 10)).toHaveLength(1);
    expect(filterQuickJumpItems([item], 'de', 10)).toHaveLength(0);
    expect(filterQuickJumpItems([item], 'beef', 10)).toHaveLength(0);
  });

  it('finds commits by author name or email start', () => {
    const item = commit('Unrelated subject', 'a1b2c3d4e5', 'Ada Lovelace', 'ada@example.com');

    expect(filterQuickJumpItems([item], 'lovelace', 10)).toHaveLength(1);
    expect(filterQuickJumpItems([item], 'example', 10)).toHaveLength(1);
    expect(filterQuickJumpItems([item], 'velace', 10)).toHaveLength(0);
  });

  it('finds stashes by selector', () => {
    const stash: Item = { label: 'WIP', scoreTarget: 'WIP', commit: { subject: 'WIP', sha: 'a1b2c3d4', authorName: 'Richie', stashSelector: 'stash@{2}' } };

    expect(filterQuickJumpItems([stash], 'stash@{2}', 10)).toHaveLength(1);
  });

  it('returns the first items for an empty query and respects the limit', () => {
    const items = [action('One'), action('Two'), action('Three')];

    expect(labels(filterQuickJumpItems(items, '  ', 2))).toEqual(['One', 'Two']);
  });
});
