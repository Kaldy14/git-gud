import { describe, expect, it } from 'vitest';

import type { CommitGraphRow, GitRefsSummary } from '@shared/types';

import {
  branchVisibilityModeForRef,
  EMPTY_BRANCH_VISIBILITY,
  filterGraphRowsByBranchVisibility,
  toggleBranchVisibility,
  type BranchVisibilityState
} from './branchVisibility';

const refs: GitRefsSummary = {
  localBranches: [
    branch('main', 'a'),
    branch('t3code/one', 'c'),
    branch('t3code/two', 'd'),
    branch('feature/other', 'e')
  ],
  remoteBranches: [],
  tags: []
};

const rows = [
  row('e', ['b'], 'feature/other'),
  row('d', ['b'], 't3code/two'),
  row('c', ['b'], 't3code/one'),
  row('b', ['a']),
  row('a', [], 'main')
];

describe('branch visibility selection', () => {
  it('supports multiple solo targets and changes a target to hidden without clearing others', () => {
    let state = toggleBranchVisibility(EMPTY_BRANCH_VISIBILITY, 'solo', {
      scope: 'local', kind: 'branch', path: 'main'
    });
    state = toggleBranchVisibility(state, 'solo', {
      scope: 'local', kind: 'folder', path: 't3code'
    });
    state = toggleBranchVisibility(state, 'hidden', {
      scope: 'local', kind: 'branch', path: 'main'
    });

    expect(state.solo).toEqual([{ scope: 'local', kind: 'folder', path: 't3code' }]);
    expect(state.hidden).toEqual([{ scope: 'local', kind: 'branch', path: 'main' }]);
    expect(branchVisibilityModeForRef(state, 'local', 't3code/one')).toBe('solo');
  });
});

describe('graph branch visibility', () => {
  it('solos the union of selected branches while keeping shared ancestry', () => {
    const state: BranchVisibilityState = {
      solo: [
        { scope: 'local', kind: 'branch', path: 't3code/one' },
        { scope: 'local', kind: 'branch', path: 'feature/other' }
      ],
      hidden: []
    };

    const filtered = filterGraphRowsByBranchVisibility(rows, refs, state);

    expect(filtered.map((candidate) => candidate.sha)).toEqual(['e', 'c', 'b', 'a']);
    expect(filtered.flatMap((candidate) => candidate.refs?.map((ref) => ref.label) ?? []))
      .toEqual(['feature/other', 't3code/one']);
  });

  it('hides only branch-exclusive commits and preserves history reachable from visible refs', () => {
    const state: BranchVisibilityState = {
      solo: [],
      hidden: [{ scope: 'local', kind: 'folder', path: 't3code' }]
    };

    const filtered = filterGraphRowsByBranchVisibility(rows, refs, state);

    expect(filtered.map((candidate) => candidate.sha)).toEqual(['e', 'b', 'a']);
    expect(filtered.flatMap((candidate) => candidate.refs?.map((ref) => ref.label) ?? []))
      .toEqual(['feature/other', 'main']);
  });

  it('lets a hidden child override a soloed folder', () => {
    const state: BranchVisibilityState = {
      solo: [{ scope: 'local', kind: 'folder', path: 't3code' }],
      hidden: [{ scope: 'local', kind: 'branch', path: 't3code/two' }]
    };

    expect(filterGraphRowsByBranchVisibility(rows, refs, state).map((candidate) => candidate.sha))
      .toEqual(['c', 'b', 'a']);
  });

  it('keeps local and remote refs distinct when their short names match', () => {
    const matchingRefs: GitRefsSummary = {
      localBranches: [branch('origin/topic', 'l')],
      remoteBranches: [{
        name: 'origin/topic',
        fullName: 'refs/remotes/origin/topic',
        sha: 'r',
        remote: 'origin'
      }],
      tags: []
    };
    const matchingRows = [
      row('r', ['a'], 'origin/topic', 'remote'),
      row('l', ['a'], 'origin/topic'),
      row('a', [])
    ];

    const filtered = filterGraphRowsByBranchVisibility(matchingRows, matchingRefs, {
      solo: [],
      hidden: [{ scope: 'remote', kind: 'branch', path: 'origin/topic' }]
    });

    expect(filtered.map((candidate) => candidate.sha)).toEqual(['l', 'a']);
    expect(filtered[0]?.refs).toEqual([{ kind: 'branch', label: 'origin/topic', current: false }]);
  });
});

function branch(name: string, sha: string) {
  return {
    name,
    fullName: `refs/heads/${name}`,
    sha,
    current: name === 'main',
    ahead: 0,
    behind: 0
  };
}

function row(
  sha: string,
  parentShas: string[],
  ref?: string,
  kind: 'branch' | 'remote' = 'branch'
): CommitGraphRow {
  return {
    sha,
    parentShas,
    subject: sha,
    author: { name: 'Author', initials: 'A', color: '#123456' },
    dateLabel: 'Today',
    node: { lane: 0, kind: 'commit' },
    rails: [],
    refs: ref ? [{ kind, label: ref, current: kind === 'branch' && ref === 'main' }] : undefined,
    files: []
  };
}
