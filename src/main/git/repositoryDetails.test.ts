import type { GitStatusSummary } from '@shared/types';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GitCommandOptions, GitCommandResult } from './exec';
import { discardFile, loadFileDiff, unstageFile } from './repositoryDetails';

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

describe('discardFile', () => {
  beforeEach(() => {
    mocks.loadStatus.mockReset();
    mocks.run.mockReset();
    mocks.run.mockImplementation(async (args, options) => createGitResult(args, options.cwd, ''));
  });

  it('discards a staged deletion by restoring index and worktree from HEAD', async () => {
    mocks.loadStatus.mockResolvedValue(
      createStatusSummary([
        {
          path: 'deleted.txt',
          indexStatus: 'deleted',
          worktreeStatus: 'unmodified',
          status: 'deleted',
          staged: true,
          unstaged: false,
          conflicted: false
        }
      ])
    );

    await discardFile({ path: '/repo' }, 'deleted.txt');

    expect(mocks.run.mock.calls[1]?.[0]).toEqual([
      'restore',
      '--staged',
      '--source=HEAD',
      '--',
      'deleted.txt'
    ]);
    expect(mocks.run.mock.calls[2]?.[0]).toEqual([
      'restore',
      '--worktree',
      '--source=HEAD',
      '--',
      'deleted.txt'
    ]);
  });

  it('discards a staged addition by unstaging it and cleaning the worktree file', async () => {
    mocks.loadStatus.mockResolvedValue(
      createStatusSummary([
        {
          path: 'new.txt',
          indexStatus: 'added',
          worktreeStatus: 'unmodified',
          status: 'added',
          staged: true,
          unstaged: false,
          conflicted: false
        }
      ])
    );

    await discardFile({ path: '/repo' }, 'new.txt');

    expect(mocks.run.mock.calls[1]?.[0]).toEqual([
      'restore',
      '--staged',
      '--source=HEAD',
      '--',
      'new.txt'
    ]);
    expect(mocks.run.mock.calls[2]?.[0]).toEqual(['clean', '-f', '-d', '--', 'new.txt']);
  });

  it('discards a staged rename by restoring the original path and cleaning the renamed path', async () => {
    mocks.loadStatus.mockResolvedValue(
      createStatusSummary([
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
      ])
    );

    await discardFile({ path: '/repo' }, 'renamed.txt');

    expect(mocks.run.mock.calls[1]?.[0]).toEqual([
      'restore',
      '--staged',
      '--source=HEAD',
      '--',
      'source.txt',
      'renamed.txt'
    ]);
    expect(mocks.run.mock.calls[2]?.[0]).toEqual([
      'restore',
      '--worktree',
      '--source=HEAD',
      '--',
      'source.txt'
    ]);
    expect(mocks.run.mock.calls[3]?.[0]).toEqual(['clean', '-f', '-d', '--', 'renamed.txt']);
  });

  it('discards an untracked file with git clean', async () => {
    mocks.loadStatus.mockResolvedValue(
      createStatusSummary([
        {
          path: 'scratch.txt',
          indexStatus: 'untracked',
          worktreeStatus: 'untracked',
          status: 'untracked',
          staged: false,
          unstaged: true,
          conflicted: false
        }
      ])
    );

    await discardFile({ path: '/repo' }, 'scratch.txt');

    expect(mocks.run.mock.calls[1]?.[0]).toEqual(['clean', '-f', '-d', '--', 'scratch.txt']);
  });
});

type StatusFile = GitStatusSummary['files'][number];

function createStatusSummary(files: StatusFile[]): GitStatusSummary {
  return {
    branch: {
      head: 'main',
      ahead: 0,
      behind: 0,
      isDetached: false
    },
    files,
    stagedCount: files.filter((file) => file.staged).length,
    unstagedCount: files.filter((file) => file.unstaged).length,
    untrackedCount: files.filter((file) => file.status === 'untracked').length,
    conflictedCount: files.filter((file) => file.conflicted).length,
    dirtyCount: files.length,
    isDirty: files.length > 0
  };
}

function createGitResult(args: string[], cwd: string, stdout: string): GitCommandResult {
  return {
    args,
    cwd,
    stdout,
    stderr: '',
    exitCode: 0
  };
}
