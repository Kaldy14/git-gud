import { afterEach, describe, expect, it, vi } from 'vitest';

import { GitCommandError, gitExecutor, type GitCommandResult } from './exec';
import { loadWorktrees } from './repositoryOverview';

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

function createGitResult(
  cwd: string,
  args: string[],
  stdout: string,
  stderr = '',
  exitCode = 0
): GitCommandResult {
  return { args, cwd, stdout, stderr, exitCode };
}
