import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GitStatusSummary } from '@shared/types';

import { describe, expect, it, vi } from 'vitest';

import { loadConflictState } from './conflicts';
import { gitExecutor, type GitCommandResult } from './exec';

describe('loadConflictState', () => {
  it('resolves all conflict control paths with one Git command', async () => {
    const repoPath = await mkdtemp(join(tmpdir(), 'git-gud-conflicts-'));

    try {
      await mkdir(join(repoPath, '.git'));
      await writeFile(join(repoPath, '.git', 'MERGE_HEAD'), 'abc123\n');
      const stdout = [
        '.git/rebase-merge',
        '.git/rebase-apply',
        '.git/MERGE_HEAD',
        '.git/CHERRY_PICK_HEAD',
        '.git/REVERT_HEAD'
      ].join('\n');
      const run = vi
        .spyOn(gitExecutor, 'run')
        .mockResolvedValue(createGitResult(repoPath, ['rev-parse'], stdout));

      const state = await loadConflictState(repoPath, undefined, cleanStatus());

      expect(state.operation).toBe('merge');
      expect(run).toHaveBeenCalledTimes(1);
      expect(run.mock.calls[0]?.[0]).toEqual([
        'rev-parse',
        '--git-path',
        'rebase-merge',
        '--git-path',
        'rebase-apply',
        '--git-path',
        'MERGE_HEAD',
        '--git-path',
        'CHERRY_PICK_HEAD',
        '--git-path',
        'REVERT_HEAD'
      ]);
    } finally {
      vi.restoreAllMocks();
      await rm(repoPath, { recursive: true, force: true });
    }
  });
});

function cleanStatus(): GitStatusSummary {
  return {
    branch: { head: 'main', oid: 'abc123', ahead: 0, behind: 0, isDetached: false },
    files: [],
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    conflictedCount: 0,
    dirtyCount: 0,
    isDirty: false
  };
}

function createGitResult(cwd: string, args: string[], stdout: string): GitCommandResult {
  return { args, cwd, stdout, stderr: '', exitCode: 0 };
}
