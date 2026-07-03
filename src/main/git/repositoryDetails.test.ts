import type { GitStatusSummary } from '@shared/types';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GitCommandOptions, GitCommandResult } from './exec';
import { loadFileDiff, unstageFile } from './repositoryDetails';

const mocks = vi.hoisted(() => ({
  loadStatus: vi.fn<() => Promise<GitStatusSummary>>(),
  run: vi.fn<(args: string[], options: GitCommandOptions) => Promise<GitCommandResult>>()
}));

vi.mock('./exec', () => ({
  GitCommandError: class GitCommandError extends Error {},
  gitExecutor: {
    run: mocks.run
  }
}));

vi.mock('./repositoryOverview', () => ({
  loadStatus: mocks.loadStatus
}));

vi.mock('../profiles', () => ({
  createProfileCommandEnv: () => undefined
}));

describe('loadFileDiff', () => {
  beforeEach(() => {
    mocks.loadStatus.mockReset();
    mocks.run.mockReset();
    mocks.run.mockImplementation(async (args, options) => createGitResult(args, options.cwd, 'diff patch'));
  });

  it('requests commit rename patches with both rename paths', async () => {
    await loadFileDiff(
      { path: '/repo' },
      { kind: 'commit', sha: 'abc123', path: 'renamed.txt', originalPath: 'source.txt' }
    );

    expect(mocks.run.mock.calls[0]?.[0]).toEqual([
      'show',
      '--format=',
      '--patch',
      '--binary',
      '--find-renames',
      '--find-copies',
      'abc123',
      '--',
      'source.txt',
      'renamed.txt'
    ]);
  });

  it('requests staged WIP rename patches with both rename paths from status', async () => {
    mocks.loadStatus.mockResolvedValue({
      branch: {
        head: 'main',
        ahead: 0,
        behind: 0,
        isDetached: false
      },
      files: [
        {
          path: 'renamed.txt',
          originalPath: 'source.txt',
          indexStatus: 'renamed',
          worktreeStatus: 'unmodified',
          status: 'renamed',
          staged: true,
          unstaged: false,
          conflicted: false
        }
      ],
      stagedCount: 1,
      unstagedCount: 0,
      untrackedCount: 0,
      conflictedCount: 0,
      dirtyCount: 1,
      isDirty: true
    });

    const diff = await loadFileDiff({ path: '/repo' }, { kind: 'wip', path: 'renamed.txt', staged: true });

    expect(diff.originalPath).toBe('source.txt');
    expect(mocks.run.mock.calls[0]?.[0]).toEqual([
      'diff',
      '--cached',
      '--binary',
      '--patch',
      '--find-renames',
      '--find-copies',
      '--',
      'source.txt',
      'renamed.txt'
    ]);
  });

  it('unstages rename paths together so the index is fully cleared', async () => {
    mocks.loadStatus.mockResolvedValue({
      branch: {
        head: 'main',
        ahead: 0,
        behind: 0,
        isDetached: false
      },
      files: [
        {
          path: 'renamed.txt',
          originalPath: 'source.txt',
          indexStatus: 'renamed',
          worktreeStatus: 'unmodified',
          status: 'renamed',
          staged: true,
          unstaged: false,
          conflicted: false
        }
      ],
      stagedCount: 1,
      unstagedCount: 0,
      untrackedCount: 0,
      conflictedCount: 0,
      dirtyCount: 1,
      isDirty: true
    });

    await unstageFile({ path: '/repo' }, 'renamed.txt');

    expect(mocks.run.mock.calls[1]?.[0]).toEqual([
      'restore',
      '--staged',
      '--',
      'source.txt',
      'renamed.txt'
    ]);
  });
});

function createGitResult(args: string[], cwd: string, stdout: string): GitCommandResult {
  return {
    args,
    cwd,
    stdout,
    stderr: '',
    exitCode: 0
  };
}
