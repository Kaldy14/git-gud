import { describe, expect, it } from 'vitest';

import type { CommitGraphRow, GitStatusSummary } from '@shared/types';

import { commitSubjectsForShas, resolveSelectedGraphRow, syncWipGraphRow } from './selection';

const firstRow: CommitGraphRow = {
  sha: 'a'.repeat(40),
  parentShas: [],
  subject: 'First',
  author: { name: 'Author', initials: 'A', color: '#123456' },
  dateLabel: 'Today',
  node: { lane: 0, kind: 'commit' },
  rails: [],
  files: []
};

describe('selected graph row resolution', () => {
  it('keeps an explicitly selected commit even when it is older than the loaded graph page', () => {
    const oldSha = 'b'.repeat(40);
    const selected = resolveSelectedGraphRow([firstRow], oldSha);

    expect(selected?.sha).toBe(oldSha);
    expect(selected?.subject).toBe('Loading selected commit...');
  });

  it('uses the first graph row when no explicit selection exists', () => {
    expect(resolveSelectedGraphRow([firstRow], undefined)).toBe(firstRow);
  });
});

describe('commit subject resolution', () => {
  it('keeps the requested commit order while replacing SHAs with subjects', () => {
    const secondRow: CommitGraphRow = {
      ...firstRow,
      sha: 'b'.repeat(40),
      subject: 'Second'
    };

    expect(commitSubjectsForShas([firstRow, secondRow], [secondRow.sha, firstRow.sha])).toEqual([
      'Second',
      'First'
    ]);
  });

  it('does not expose a SHA when a commit subject is unavailable', () => {
    expect(commitSubjectsForShas([firstRow], ['missing'])).toEqual(['Commit message unavailable']);
  });
});

describe('WIP graph synchronization', () => {
  it('updates path cardinality from overview status after unstaging a rename', () => {
    const wipRow: CommitGraphRow = {
      ...firstRow,
      sha: 'wip',
      node: { lane: 0, kind: 'wip' },
      files: [{ path: 'renamed.txt', status: 'modified' }]
    };
    const status: GitStatusSummary = {
      branch: { head: 'main', oid: firstRow.sha, ahead: 0, behind: 0, isDetached: false },
      files: [
        {
          path: 'source.txt',
          indexStatus: 'unmodified',
          worktreeStatus: 'deleted',
          status: 'deleted',
          staged: false,
          unstaged: true,
          conflicted: false
        },
        {
          path: 'renamed.txt',
          indexStatus: 'untracked',
          worktreeStatus: 'untracked',
          status: 'untracked',
          staged: false,
          unstaged: true,
          conflicted: false
        }
      ],
      stagedCount: 0,
      unstagedCount: 2,
      untrackedCount: 1,
      conflictedCount: 0,
      dirtyCount: 2,
      isDirty: true
    };

    expect(syncWipGraphRow([wipRow, firstRow], status)[0]?.files).toEqual([
      { path: 'source.txt', status: 'deleted' },
      { path: 'renamed.txt', status: 'added' }
    ]);
  });
});
