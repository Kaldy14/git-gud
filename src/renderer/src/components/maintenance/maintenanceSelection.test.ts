import { describe, expect, it } from 'vitest';

import type { ArtifactCleanupCandidate, BranchCleanupCandidate } from '@shared/maintenance';

import { buildStashRestoreCommand, buildWorktreeRestoreCommand } from './artifactCleanupPresentation';
import {
  applyRowClick,
  artifactKey,
  DEFAULT_SIMPLE_RULES,
  headerCheckboxState,
  isBranchSelectable,
  isSameBranchCriteria,
  matchesSearch,
  previewSimpleArtifacts,
  previewSimpleBranches,
  pruneSelection,
  revalidateReviewed,
  toggleAllVisible
} from './maintenanceSelection';

function branch(name: string, overrides: Partial<BranchCleanupCandidate> = {}): BranchCleanupCandidate {
  return {
    ref: `refs/heads/${name}`,
    name,
    sha: 'a'.repeat(40),
    scope: 'local',
    branchName: name,
    ageDays: 100,
    oldEnough: true,
    evidence: 'merged',
    explanation: '',
    upstreamGone: false,
    ...overrides
  };
}

function artifact(kind: ArtifactCleanupCandidate['kind'], id: string, overrides: Partial<ArtifactCleanupCandidate> = {}): ArtifactCleanupCandidate {
  return { kind, id, name: id, sha: 'b'.repeat(40), ageDays: 100, oldEnough: true, ...overrides };
}

const ordered = ['a', 'b', 'c', 'd', 'e'];
const allEligible = new Set(ordered);

describe('headerCheckboxState', () => {
  it('reports none, some, and all for eligible visible rows', () => {
    expect(headerCheckboxState(new Set(), [])).toBe('none');
    expect(headerCheckboxState(new Set(['x']), ['a', 'b'])).toBe('none');
    expect(headerCheckboxState(new Set(['a']), ['a', 'b'])).toBe('some');
    expect(headerCheckboxState(new Set(['a', 'b', 'x']), ['a', 'b'])).toBe('all');
  });
});

describe('toggleAllVisible', () => {
  it('selects every eligible visible row and keeps hidden selections', () => {
    const { next, skipped } = toggleAllVisible(new Set(['x']), ['a', 'b']);
    expect([...next].sort()).toEqual(['a', 'b', 'x']);
    expect(skipped).toBe(0);
  });

  it('deselects only visible rows when all are selected', () => {
    const { next } = toggleAllVisible(new Set(['a', 'b', 'x']), ['a', 'b']);
    expect([...next]).toEqual(['x']);
  });

  it('completes a partial selection and honours the limit', () => {
    const { next, skipped } = toggleAllVisible(new Set(['b']), ordered, 3);
    expect([...next].sort()).toEqual(['a', 'b', 'c']);
    expect(skipped).toBe(2);
  });
});

describe('applyRowClick', () => {
  it('toggles one row without shift', () => {
    expect([...applyRowClick({ current: new Set(), orderedIds: ordered, eligibleIds: allEligible, anchorId: 'a', targetId: 'c', shift: false }).next]).toEqual(['c']);
    expect([...applyRowClick({ current: new Set(['c']), orderedIds: ordered, eligibleIds: allEligible, anchorId: undefined, targetId: 'c', shift: true }).next]).toEqual([]);
  });

  it('selects a range in either direction, skipping ineligible rows', () => {
    const eligible = new Set(['a', 'b', 'd', 'e']);
    const down = applyRowClick({ current: new Set(), orderedIds: ordered, eligibleIds: eligible, anchorId: 'a', targetId: 'e', shift: true });
    expect([...down.next].sort()).toEqual(['a', 'b', 'd', 'e']);
    const up = applyRowClick({ current: new Set(), orderedIds: ordered, eligibleIds: eligible, anchorId: 'e', targetId: 'b', shift: true });
    expect([...up.next].sort()).toEqual(['b', 'd', 'e']);
  });

  it('deselects a range when the target was selected', () => {
    const { next } = applyRowClick({
      current: new Set(['a', 'b', 'c', 'd']),
      orderedIds: ordered,
      eligibleIds: allEligible,
      anchorId: 'b',
      targetId: 'd',
      shift: true
    });
    expect([...next]).toEqual(['a']);
  });

  it('falls back to a single toggle when the anchor is no longer visible', () => {
    const { next } = applyRowClick({ current: new Set(), orderedIds: ordered, eligibleIds: allEligible, anchorId: 'gone', targetId: 'd', shift: true });
    expect([...next]).toEqual(['d']);
  });

  it('ignores ineligible targets and caps ranges nearest the anchor', () => {
    expect(applyRowClick({ current: new Set(), orderedIds: ordered, eligibleIds: new Set(['a']), anchorId: 'a', targetId: 'c', shift: true }).next.size).toBe(0);
    const capped = applyRowClick({ current: new Set(), orderedIds: ordered, eligibleIds: allEligible, anchorId: 'e', targetId: 'a', shift: true, limit: 2 });
    expect([...capped.next].sort()).toEqual(['d', 'e']);
    expect(capped.skipped).toBe(3);
  });
});

describe('pruneSelection', () => {
  it('drops ineligible ids and preserves identity when unchanged', () => {
    const current = new Set(['a', 'b']);
    expect(pruneSelection(current, new Set(['a', 'b', 'c']))).toBe(current);
    expect([...pruneSelection(current, new Set(['b']))]).toEqual(['b']);
  });
});

describe('matchesSearch', () => {
  it('matches every term across fields, ignoring case', () => {
    expect(matchesSearch('', ['x'])).toBe(true);
    expect(matchesSearch('Feat LOGIN', ['feature/login', undefined])).toBe(true);
    expect(matchesSearch('feat wip', ['feature/login', '/tmp/wt'])).toBe(false);
    expect(matchesSearch('tmp', ['feature/login', '/tmp/wt'])).toBe(true);
  });
});

describe('isSameBranchCriteria', () => {
  it('requires both criteria and equal values', () => {
    expect(isSameBranchCriteria(undefined, { baseRef: '', olderThanDays: 30 })).toBe(false);
    expect(isSameBranchCriteria({ baseRef: '', olderThanDays: 30 }, { baseRef: '', olderThanDays: 30 })).toBe(true);
    expect(isSameBranchCriteria({ baseRef: '', olderThanDays: 30 }, { baseRef: 'refs/heads/main', olderThanDays: 30 })).toBe(false);
  });
});

describe('isBranchSelectable', () => {
  it('never allows protected or recent branches and gates unmerged ones', () => {
    expect(isBranchSelectable(branch('a', { protectedReason: 'Checked out' }), true)).toBe(false);
    expect(isBranchSelectable(branch('a', { oldEnough: false }), true)).toBe(false);
    expect(isBranchSelectable(branch('a', { evidence: 'unmerged' }), false)).toBe(false);
    expect(isBranchSelectable(branch('a', { evidence: 'unmerged' }), true)).toBe(true);
  });
});

describe('previewSimpleBranches', () => {
  const candidates = [
    branch('merged'),
    branch('squashed', { evidence: 'content-integrated' }),
    branch('stale', { evidence: 'unmerged' }),
    branch('young', { oldEnough: false }),
    branch('main', { protectedReason: 'Default branch' }),
    branch('origin/merged', { ref: 'refs/remotes/origin/merged', scope: 'remote', remote: 'origin' }),
    branch('origin/stale', { ref: 'refs/remotes/origin/stale', scope: 'remote', evidence: 'unmerged' })
  ];

  it('defaults to merged local branches only and never remote ones', () => {
    const preview = previewSimpleBranches(candidates, DEFAULT_SIMPLE_RULES);
    expect(preview.selected.map((item) => item.name)).toEqual(['merged']);
    expect(preview.counts).toEqual({ mergedLocal: 1, likelyLocal: 1, ageOnlyLocal: 1, mergedRemote: 1 });
  });

  it('adds opted-in rules, never protected, recent, or unmerged remote branches', () => {
    const preview = previewSimpleBranches(candidates, { ...DEFAULT_SIMPLE_RULES, likelyLocal: true, ageOnlyLocal: true, mergedRemote: true });
    expect(preview.selected.map((item) => item.name)).toEqual(['merged', 'squashed', 'stale', 'origin/merged']);
  });

  it('caps the selection, keeping strongest evidence first', () => {
    const many = [branch('weak', { evidence: 'unmerged', ageDays: 999 }), branch('m1'), branch('m2')];
    const preview = previewSimpleBranches(many, { ...DEFAULT_SIMPLE_RULES, ageOnlyLocal: true }, 2);
    expect(preview.selected.map((item) => item.name)).toEqual(['m1', 'm2']);
    expect(preview.overflow).toBe(1);
  });
});

describe('previewSimpleArtifacts', () => {
  const candidates = [
    artifact('stash', 'stash@{0}', { oldEnough: false }),
    artifact('stash', 'stash@{1}'),
    artifact('worktree', '/w/locked', { protectedReason: 'Locked' }),
    artifact('worktree', '/w/old')
  ];

  it('counts eligible items and selects only enabled kinds', () => {
    const none = previewSimpleArtifacts(candidates, DEFAULT_SIMPLE_RULES);
    expect(none.counts).toEqual({ stash: 1, worktree: 1 });
    expect(none.selected).toEqual([]);
    const both = previewSimpleArtifacts(candidates, { stashes: true, worktrees: true });
    expect(both.selected.map(artifactKey)).toEqual(['stash:stash@{1}', 'worktree:/w/old']);
  });
});

describe('restore commands', () => {
  it('stores a dropped stash back with its message', () => {
    expect(buildStashRestoreCommand({ name: "On main: it's wip" }, 'refs/git-gud/stash/1')).toBe(
      `git stash store -m 'On main: it'\\''s wip' 'refs/git-gud/stash/1'`
    );
  });

  it('recreates attached and detached worktrees', () => {
    expect(buildWorktreeRestoreCommand({ id: '/w/old dir', branch: 'refs/heads/feature/x' }, 'refs/r')).toBe(
      `git worktree add -- '/w/old dir' 'feature/x'`
    );
    expect(buildWorktreeRestoreCommand({ id: '/w/d' }, 'refs/r')).toBe(`git worktree add --detach -- '/w/d' 'refs/r'`);
  });
});

describe('revalidateReviewed', () => {
  const reviewed = [
    { id: 'a', name: 'a', sha: '1', evidence: 'merged' as const },
    { id: 'b', name: 'b', sha: '2', evidence: 'merged' as const },
    { id: 'c', name: 'c', sha: '3', evidence: 'merged' as const },
    { id: 'd', name: 'd', sha: '4', evidence: 'patch-equivalent' as const },
    { id: 'e', name: 'e', sha: '5', evidence: 'content-integrated' as const },
    { id: 'f', name: 'f', sha: '6' }
  ];

  it('keeps only exact reviewed commits that remain eligible with evidence at least as strong', () => {
    const result = revalidateReviewed(reviewed, new Map([
      ['a', { sha: '1', eligible: true, evidence: 'merged' as const }],
      ['b', { sha: '9', eligible: true, evidence: 'merged' as const }],
      ['d', { sha: '4', eligible: true, evidence: 'merged' as const }],
      ['e', { sha: '5', eligible: true, evidence: 'unmerged' as const }],
      ['f', { sha: '6', eligible: false }],
      ['new', { sha: '7', eligible: true, evidence: 'merged' as const }]
    ]));

    expect(result.kept).toEqual(['a', 'd']);
    expect(result.changed.map((item) => item.id)).toEqual(['b']);
    expect(result.missing.map((item) => item.id)).toEqual(['c']);
    expect(result.ineligible.map((item) => item.id)).toEqual(['e', 'f']);
  });

  it('keeps artifacts without evidence when the commit is unchanged', () => {
    const result = revalidateReviewed([{ id: 'stash:stash@{0}', name: 'wip', sha: 'x' }], new Map([['stash:stash@{0}', { sha: 'x', eligible: true }]]));
    expect(result.kept).toEqual(['stash:stash@{0}']);
  });
});
