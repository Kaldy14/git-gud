import type { GitStatusSummary } from '@shared/types';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GitCommandOptions, GitCommandResult } from './exec';
import { discardAllChanges, discardFile, loadFileDiff, stageFile, unstageFile } from './repositoryDetails';

const mocks = vi.hoisted(() => ({
  loadStatus: vi.fn<() => Promise<GitStatusSummary>>(),
  run: vi.fn<(args: string[], options: GitCommandOptions) => Promise<GitCommandResult>>()
}));

vi.mock('./exec', () => ({
  GitCommandError: class GitCommandError extends Error {},
  GitOutputLimitError: class GitOutputLimitError extends Error {},
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

  it('keeps staging refreshes scoped away from commit history', async () => {
    const result = await stageFile({ path: '/repo' }, 'changed.txt');

    expect(result.invalidates).toEqual(['overview', 'wip-detail', 'file-diff', 'review-plan']);
  });

  it('requests commit rename patches with both rename paths', async () => {
    await loadFileDiff(
      { path: '/repo' },
      { kind: 'commit', sha: 'abc123', path: 'renamed.txt', originalPath: 'source.txt' }
    );

    const patchCall = mocks.run.mock.calls.find(([args]) => args.includes('--patch'));

    expect(patchCall?.[0]).toEqual([
      '--literal-pathspecs',
      'show',
      '--format=',
      '--first-parent',
      '--diff-merges=first-parent',
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
        oid: 'abc123',
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
    const patchCall = mocks.run.mock.calls.find(([args]) => args.includes('--patch') && !args.includes('--unified=0'));

    expect(patchCall?.[0]).toEqual([
      '--literal-pathspecs',
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
        oid: 'abc123',
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

    const result = await unstageFile({ path: '/repo' }, 'renamed.txt');

    expect(mocks.run.mock.calls[0]?.[0]).toEqual([
      '--literal-pathspecs',
      'restore',
      '--staged',
      '--',
      'source.txt',
      'renamed.txt'
    ]);
    expect(result.invalidates).not.toContain('graph');
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

    expect(mocks.run.mock.calls[0]?.[0]).toEqual([
      '--literal-pathspecs',
      'restore',
      '--staged',
      '--source=HEAD',
      '--',
      'deleted.txt'
    ]);
    expect(mocks.run.mock.calls[1]?.[0]).toEqual([
      '--literal-pathspecs',
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

    expect(mocks.run.mock.calls[0]?.[0]).toEqual([
      '--literal-pathspecs',
      'restore',
      '--staged',
      '--source=HEAD',
      '--',
      'new.txt'
    ]);
    expect(mocks.run.mock.calls[1]?.[0]).toEqual([
      '--literal-pathspecs',
      'clean',
      '-f',
      '-d',
      '--',
      'new.txt'
    ]);
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

    expect(mocks.run.mock.calls[0]?.[0]).toEqual([
      '--literal-pathspecs',
      'restore',
      '--staged',
      '--source=HEAD',
      '--',
      'source.txt',
      'renamed.txt'
    ]);
    expect(mocks.run.mock.calls[1]?.[0]).toEqual([
      '--literal-pathspecs',
      'restore',
      '--worktree',
      '--source=HEAD',
      '--',
      'source.txt'
    ]);
    expect(mocks.run.mock.calls[2]?.[0]).toEqual([
      '--literal-pathspecs',
      'clean',
      '-f',
      '-d',
      '--',
      'renamed.txt'
    ]);
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

    expect(mocks.run.mock.calls[0]?.[0]).toEqual([
      '--literal-pathspecs',
      'clean',
      '-f',
      '-d',
      '--',
      'scratch.txt'
    ]);
  });
});

describe('discardAllChanges', () => {
  beforeEach(() => {
    mocks.loadStatus.mockReset();
    mocks.run.mockReset();
    mocks.run.mockImplementation(async (args, options) => createGitResult(args, options.cwd, ''));
  });

  it('hard-resets tracked changes and cleans untracked files', async () => {
    mocks.loadStatus.mockResolvedValue(
      createStatusSummary([
        {
          path: 'tracked.txt',
          indexStatus: 'modified',
          worktreeStatus: 'modified',
          status: 'modified',
          staged: true,
          unstaged: true,
          conflicted: false
        },
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

    const result = await discardAllChanges({ path: '/repo' });

    expect(mocks.run.mock.calls.map(([args]) => args)).toEqual([
      ['reset', '--hard', 'HEAD'],
      ['clean', '-f', '-d', '--', '.']
    ]);
    expect(result.invalidates).toContain('graph');
  });

  it('blocks bulk discard while the repository has conflicts', async () => {
    mocks.loadStatus.mockResolvedValue(
      createStatusSummary([
        {
          path: 'conflicted.txt',
          indexStatus: 'conflicted',
          worktreeStatus: 'conflicted',
          status: 'conflicted',
          staged: false,
          unstaged: true,
          conflicted: true
        }
      ])
    );

    await expect(discardAllChanges({ path: '/repo' })).rejects.toThrow('blocked during a conflict');
    expect(mocks.run).not.toHaveBeenCalled();
  });
});

type StatusFile = GitStatusSummary['files'][number];

function createStatusSummary(files: StatusFile[]): GitStatusSummary {
  return {
    branch: {
      head: 'main',
      oid: 'abc123',
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
