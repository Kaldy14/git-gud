import { describe, expect, it } from 'vitest';

import type { CommitGraphRow } from '@shared/types';

import { graphRowAriaLabel, isGraphBranchCheckedOut } from './graphRowPresentation';

const baseRow: CommitGraphRow = {
  sha: 'a'.repeat(40),
  parentShas: [],
  subject: 'Initial state',
  author: { name: 'WIP Counts Test', initials: 'WC', color: '#123456' },
  dateLabel: 'Today',
  node: { lane: 0, kind: 'commit' },
  rails: [],
  files: []
};

describe('graph row accessible labels', () => {
  it('includes the non-zero WIP status breakdown', () => {
    expect(
      graphRowAriaLabel({
        ...baseRow,
        sha: 'wip',
        node: { lane: 0, kind: 'wip' },
        worktree: { path: '/repo', branch: 'main', current: true },
        files: [
          { path: 'edited-a.ts', status: 'modified' },
          { path: 'edited-b.ts', status: 'modified' },
          { path: 'added.ts', status: 'added' },
          { path: 'deleted.ts', status: 'deleted' }
        ]
      })
    ).toBe('local changes on main, 2 modified files, 1 added file, 1 deleted file');
  });

  it('preserves commit metadata in non-WIP row labels', () => {
    expect(graphRowAriaLabel(baseRow)).toBe(
      `Initial state, WIP Counts Test, Today, ${'a'.repeat(7)}`
    );
  });
});

describe('graph branch checkout presentation', () => {
  it('treats current and linked-worktree branches as checked out', () => {
    const linkedWorktrees = new Set(['feature/linked']);

    expect(
      isGraphBranchCheckedOut({ kind: 'branch', label: 'main', current: true }, linkedWorktrees)
    ).toBe(true);
    expect(
      isGraphBranchCheckedOut({ kind: 'branch', label: 'feature/linked' }, linkedWorktrees)
    ).toBe(true);
  });

  it('leaves ordinary local and non-branch refs inactive', () => {
    const linkedWorktrees = new Set(['feature/linked']);

    expect(
      isGraphBranchCheckedOut({ kind: 'branch', label: 'feature/local' }, linkedWorktrees)
    ).toBe(false);
    expect(
      isGraphBranchCheckedOut({ kind: 'remote', label: 'origin/feature/linked' }, linkedWorktrees)
    ).toBe(false);
  });
});
