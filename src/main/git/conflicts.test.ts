import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GitStatusSummary } from '@shared/types';

import { describe, expect, it, vi } from 'vitest';

import { loadConflictFile, loadConflictState, resolveConflictFile } from './conflicts';
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

  it('loads both sides of common conflict types and stages an edited result', async () => {
    const repoPath = await mkdtemp(join(tmpdir(), 'git-gud-conflicts-'));

    try {
      await runGit(repoPath, ['init', '-b', 'main']);
      await runGit(repoPath, ['config', 'user.name', 'Conflict Test']);
      await runGit(repoPath, ['config', 'user.email', 'conflict@test.local']);
      await writeFile(join(repoPath, 'conflict.txt'), 'base\n');
      await writeFile(join(repoPath, 'legacy.txt'), 'base\n');
      await runGit(repoPath, ['add', '.']);
      await runGit(repoPath, ['commit', '-m', 'base']);

      await runGit(repoPath, ['switch', '-c', 'feature/conflict']);
      await writeFile(join(repoPath, 'conflict.txt'), 'feature\n');
      await writeFile(join(repoPath, 'added.txt'), 'feature\n');
      await runGit(repoPath, ['rm', 'legacy.txt']);
      await runGit(repoPath, ['add', '.']);
      await runGit(repoPath, ['commit', '-m', 'feature changes']);

      await runGit(repoPath, ['switch', 'main']);
      await writeFile(join(repoPath, 'conflict.txt'), 'main\n');
      await writeFile(join(repoPath, 'added.txt'), 'main\n');
      await writeFile(join(repoPath, 'legacy.txt'), 'main\n');
      await runGit(repoPath, ['add', '.']);
      await runGit(repoPath, ['commit', '-m', 'main changes']);
      await runGit(repoPath, ['merge', 'feature/conflict'], [0, 1]);

      const tab = { path: repoPath, assignedProfileId: undefined };
      const contentConflict = await loadConflictFile(tab, 'conflict.txt');
      const addConflict = await loadConflictFile(tab, 'added.txt');
      const deleteConflict = await loadConflictFile(tab, 'legacy.txt');

      expect(contentConflict).toMatchObject({
        kind: 'both-modified',
        oursLabel: 'main',
        theirsLabel: 'feature/conflict',
        ours: { content: 'main\n' },
        theirs: { content: 'feature\n' }
      });
      expect(contentConflict.result).toContain('<<<<<<< HEAD');
      expect(addConflict.kind).toBe('both-added');
      expect(deleteConflict.kind).toBe('deleted-by-them');

      const result = await resolveConflictFile(tab, {
        path: 'conflict.txt',
        resolution: 'content',
        content: 'resolved\n'
      });

      expect(result.conflictState?.files.map((file) => file.path)).not.toContain('conflict.txt');
      expect(await readFile(join(repoPath, 'conflict.txt'), 'utf8')).toBe('resolved\n');
      expect((await runGit(repoPath, ['diff', '--cached', '--name-only'])).stdout).toContain('conflict.txt');
    } finally {
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

function runGit(repoPath: string, args: string[], allowedExitCodes: readonly number[] = [0]): Promise<GitCommandResult> {
  return gitExecutor.run(args, { cwd: repoPath, kind: 'mutation', allowedExitCodes });
}
