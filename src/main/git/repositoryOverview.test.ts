import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { GitCommandError, gitExecutor, type GitCommandResult } from './exec';
import { loadStatus, loadWorktrees } from './repositoryOverview';

describe('loadWorktrees', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to newline-delimited porcelain output when worktree list does not support -z', async () => {
    const repoPath = '/repos/git-gud';
    const run = vi
      .spyOn(gitExecutor, 'run')
      .mockRejectedValueOnce(
        new GitCommandError(
          'unknown switch z',
          createGitResult(repoPath, ['worktree', 'list', '--porcelain', '-z'], '', 'error: unknown switch `z`', 129),
          'read'
        )
      )
      .mockResolvedValueOnce(
        createGitResult(repoPath, ['worktree', 'list', '--porcelain'], 'worktree /repos/git-gud\nHEAD aaa\nbranch refs/heads/main\n\n')
      );

    await expect(loadWorktrees(repoPath)).resolves.toEqual([
      {
        path: repoPath,
        head: 'aaa',
        branch: 'main',
        detached: false,
        bare: false,
        current: true
      }
    ]);
    expect(run.mock.calls.map(([args]) => args)).toEqual([
      ['worktree', 'list', '--porcelain', '-z'],
      ['worktree', 'list', '--porcelain']
    ]);
  });
});

describe('loadStatus', () => {
  it('scopes single-file status reads with a literal pathspec', async () => {
    const repoPath = '/repos/path-scoped-status';
    const run = vi
      .spyOn(gitExecutor, 'run')
      .mockResolvedValue(createGitResult(repoPath, [], '# branch.head main\0# branch.oid abc123\0'));

    await loadStatus(repoPath, undefined, [':(top)**']);

    expect(run).toHaveBeenCalledWith(
      [
        '--literal-pathspecs',
        'status',
        '--porcelain=v2',
        '--branch',
        '--untracked-files=all',
        '-z',
        '--',
        ':(top)**'
      ],
      { cwd: repoPath, env: undefined }
    );
  });

  it('does not coalesce a transaction read with an external read queued behind it', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-overview-'));
    const repoPath = join(rootPath, 'repo');

    try {
      await gitExecutor.run(['init', repoPath], { cwd: rootPath, kind: 'mutation' });

      let releaseTransaction: (() => void) | undefined;
      const transactionGate = new Promise<void>((resolve) => {
        releaseTransaction = resolve;
      });
      let markTransactionStarted: (() => void) | undefined;
      const transactionStarted = new Promise<void>((resolve) => {
        markTransactionStarted = resolve;
      });

      const transaction = gitExecutor.transaction(repoPath, async () => {
        markTransactionStarted?.();
        await transactionGate;
        return loadStatus(repoPath);
      });

      await transactionStarted;
      const queuedRead = loadStatus(repoPath);
      releaseTransaction?.();

      const [transactionStatus, queuedStatus] = await Promise.all([transaction, queuedRead]);
      expect(transactionStatus).toEqual(queuedStatus);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});

function createGitResult(
  cwd: string,
  args: string[],
  stdout: string,
  stderr = '',
  exitCode = 0
): GitCommandResult {
  return { args, cwd, stdout, stderr, exitCode };
}
