import { describe, expect, it } from 'vitest';

import { buildBranchTree, prioritizeWorktreeBranches } from './branchTree';

describe('buildBranchTree', () => {
  it('groups slash-delimited branches and keeps root branches at the root', () => {
    const tree = buildBranchTree(
      ['feature/add-search', 'feature/fix-search', 'main'],
      (branch) => branch
    );

    expect(tree).toEqual([
      {
        kind: 'folder',
        name: 'feature',
        path: 'feature',
        children: [
          {
            kind: 'branch',
            name: 'add-search',
            path: 'feature/add-search',
            item: 'feature/add-search'
          },
          {
            kind: 'branch',
            name: 'fix-search',
            path: 'feature/fix-search',
            item: 'feature/fix-search'
          }
        ]
      },
      { kind: 'branch', name: 'main', path: 'main', item: 'main' }
    ]);
  });

  it('creates a folder for every slash-delimited path segment', () => {
    const tree = buildBranchTree(
      ['origin/feature/branch-folders', 'origin/main', 'upstream/main'],
      (branch) => branch
    );

    expect(tree).toMatchObject([
      {
        kind: 'folder',
        name: 'origin',
        children: [
          {
            kind: 'folder',
            name: 'feature',
            children: [{ kind: 'branch', name: 'branch-folders' }]
          },
          { kind: 'branch', name: 'main' }
        ]
      },
      {
        kind: 'folder',
        name: 'upstream',
        children: [{ kind: 'branch', name: 'main' }]
      }
    ]);
  });

  it('preserves the source order for folders and branches', () => {
    const tree = buildBranchTree(['release/next', 'main', 'feature/card'], (branch) => branch);

    expect(tree.map((node) => node.name)).toEqual(['release', 'main', 'feature']);
  });
});

describe('prioritizeWorktreeBranches', () => {
  it('keeps the current branch first and promotes linked-worktree branches above regular branches', () => {
    const branches = [
      { name: 'alpha/branch', current: false },
      { name: 'main', current: true },
      { name: 't3code/two', current: false },
      { name: 't3code/one', current: false }
    ];

    expect(
      prioritizeWorktreeBranches(
        branches,
        (branch) => branch.name,
        (branch) => branch.current,
        new Set(['t3code/one', 't3code/two'])
      ).map((branch) => branch.name)
    ).toEqual(['main', 't3code/one', 't3code/two', 'alpha/branch']);
  });
});
