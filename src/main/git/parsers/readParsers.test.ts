import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GitCommandError, gitExecutor } from '../exec';
import { parseNameStatus, parseShortStat } from './details';
import { parseGitLog } from './log';
import { parseForEachRef, parseRemoteVerbose } from './refs';
import { parseStashList } from './stash';
import { parseStatusPorcelainV2 } from './status';
import { parseWorktreeList } from './worktree';

describe('git read parsers', () => {
  it('parses porcelain v2 status with branch metadata and dirty counts', () => {
    const output = [
      '# branch.oid abc123',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa src/app.ts',
      '1 A. N... 000000 100644 100644 0000000000000000000000000000000000000000 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb src/new.ts',
      '? scratch.txt',
      'u UU N... 100644 100644 100644 100644 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb cccccccccccccccccccccccccccccccccccccccc src/conflict.ts'
    ].join('\0');

    const status = parseStatusPorcelainV2(`${output}\0`);

    expect(status.branch).toMatchObject({
      head: 'main',
      oid: 'abc123',
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
      isDetached: false
    });
    expect(status.files.map((file) => [file.path, file.status])).toEqual([
      ['src/app.ts', 'modified'],
      ['src/new.ts', 'added'],
      ['scratch.txt', 'untracked'],
      ['src/conflict.ts', 'conflicted']
    ]);
    expect(status.stagedCount).toBe(1);
    expect(status.unstagedCount).toBe(2);
    expect(status.untrackedCount).toBe(1);
    expect(status.conflictedCount).toBe(1);
  });

  it('parses refs and remote URLs', () => {
    const refs = parseForEachRef(
      [
        [
          'refs/heads/main',
          'main',
          'aaa',
          'origin/main',
          '[ahead 1, behind 2]',
          '*',
          '2026-07-02T10:00:00+02:00'
        ].join('\0'),
        ['refs/remotes/origin/HEAD', 'origin', 'bbb', '', '', '', '2026-07-02T09:00:00+02:00'].join('\0'),
        ['refs/remotes/origin/main', 'origin/main', 'bbb', '', '', '', '2026-07-02T09:00:00+02:00'].join('\0'),
        ['refs/tags/v0.1.0', 'v0.1.0', 'ccc', '', '', '', '2026-07-01T09:00:00+02:00', 'commit', '', ''].join(
          '\0'
        ),
        ['refs/tags/v0.10.0', 'v0.10.0', 'ddd', '', '', '', '2026-07-01T11:00:00+02:00', 'commit', '', ''].join(
          '\0'
        ),
        [
          'refs/tags/v0.2.0',
          'v0.2.0',
          'annotated-tag-object',
          '',
          '',
          '',
          '2026-07-01T10:00:00+02:00',
          'tag',
          'peeled-commit',
          'commit'
        ].join('\0')
      ].join('\n')
    );
    const remotes = parseRemoteVerbose('origin\tgit@github.com:kaldy/git-gud.git (fetch)\norigin\tgit@github.com:kaldy/git-gud.git (push)\n');

    expect(refs.localBranches[0]).toMatchObject({ name: 'main', current: true, ahead: 1, behind: 2 });
    expect(refs.remoteBranches).toHaveLength(1);
    expect(refs.remoteBranches[0]).toMatchObject({ name: 'origin/main', remote: 'origin' });
    expect(refs.tags.map((tag) => tag.name)).toEqual(['v0.10.0', 'v0.2.0', 'v0.1.0']);
    expect(refs.tags[1]).toMatchObject({ sha: 'peeled-commit' });
    expect(remotes).toEqual([
      {
        name: 'origin',
        fetchUrl: 'git@github.com:kaldy/git-gud.git',
        pushUrl: 'git@github.com:kaldy/git-gud.git'
      }
    ]);
  });

  it('parses worktrees, stashes, and fixed-field log output', () => {
    const worktrees = parseWorktreeList(
      ['worktree /repos/git-gud', 'HEAD aaa', 'branch refs/heads/main', '', 'worktree /repos/git-gud-linked', 'HEAD bbb', 'detached'].join('\0'),
      '/repos/git-gud'
    );
    const stashes = parseStashList(['aaa', 'bbb ccc', 'stash@{0}', '2026-07-02T10:00:00+02:00', 'WIP on main'].join('\0'));
    const emptyFieldStashes = parseStashList(['ddd', 'eee', 'stash@{1}', '', ''].join('\0'));
    const commits = parseGitLog(
      ['abc', 'def ghi', 'Kaldy', 'kaldy@example.com', '2026-07-02T10:00:00+02:00', '2026-07-02T10:01:00+02:00', 'HEAD -> main, tag: v1', 'subject', 'searchable body'].join(
        '\0'
      )
    );

    expect(worktrees).toEqual([
      {
        path: '/repos/git-gud',
        head: 'aaa',
        branch: 'main',
        detached: false,
        bare: false,
        current: true
      },
      {
        path: '/repos/git-gud-linked',
        head: 'bbb',
        branch: undefined,
        detached: true,
        bare: false,
        current: false
      }
    ]);
    expect(stashes[0]).toMatchObject({ selector: 'stash@{0}', parentShas: ['bbb', 'ccc'], subject: 'WIP on main' });
    expect(emptyFieldStashes[0]).toEqual({
      sha: 'ddd',
      parentShas: ['eee'],
      selector: 'stash@{1}',
      date: undefined,
      subject: ''
    });
    expect(commits[0]).toMatchObject({
      sha: 'abc',
      parentShas: ['def', 'ghi'],
      refs: ['HEAD -> main', 'tag: v1'],
      subject: 'subject',
      body: 'searchable body'
    });
  });

  it('parses newline-delimited worktrees emitted by Git versions without worktree list -z', () => {
    const currentRepoPath = '/repos/git gud';
    const linkedRepoPath = '/repos/Gr\u00fcn 👍\nlinked';
    const worktrees = parseWorktreeList(
      [
        `worktree ${currentRepoPath}`,
        'HEAD aaa',
        'branch refs/heads/main',
        '',
        'worktree "/repos/Gr\\303\\274n 👍\\nlinked"',
        'HEAD bbb',
        'detached',
        ''
      ].join('\n'),
      currentRepoPath
    );

    expect(worktrees).toEqual([
      {
        path: currentRepoPath,
        head: 'aaa',
        branch: 'main',
        detached: false,
        bare: false,
        current: true
      },
      {
        path: linkedRepoPath,
        head: 'bbb',
        branch: undefined,
        detached: true,
        bare: false,
        current: false
      }
    ]);
  });

  it('keeps worktree order stable when the current worktree changes', () => {
    const output = [
      'worktree /repos/project',
      'HEAD aaa',
      'branch refs/heads/main',
      '',
      'worktree /repos/project-feature',
      'HEAD bbb',
      'branch refs/heads/feature',
      ''
    ].join('\0');

    const mainPaths = parseWorktreeList(output, '/repos/project').map((worktree) => worktree.path);
    const featurePaths = parseWorktreeList(output, '/repos/project-feature').map((worktree) => worktree.path);

    expect(mainPaths).toEqual(['/repos/project', '/repos/project-feature']);
    expect(featurePaths).toEqual(mainPaths);
  });

  it('parses commit detail file lists and short stats', () => {
    const files = parseNameStatus(
      [
        'M',
        'src/app.ts',
        'A',
        'src/new file.ts',
        'D',
        'old.txt',
        'R100',
        'src/old-name.ts',
        'src/new-name.ts',
        'C085',
        'src/source.ts',
        'src/copy.ts'
      ].join('\0')
    );

    expect(files).toEqual([
      {
        path: 'old.txt',
        originalPath: undefined,
        status: 'deleted',
        staged: false,
        unstaged: false,
        conflicted: false
      },
      {
        path: 'src/app.ts',
        originalPath: undefined,
        status: 'modified',
        staged: false,
        unstaged: false,
        conflicted: false
      },
      {
        path: 'src/copy.ts',
        originalPath: 'src/source.ts',
        status: 'copied',
        staged: false,
        unstaged: false,
        conflicted: false
      },
      {
        path: 'src/new file.ts',
        originalPath: undefined,
        status: 'added',
        staged: false,
        unstaged: false,
        conflicted: false
      },
      {
        path: 'src/new-name.ts',
        originalPath: 'src/old-name.ts',
        status: 'renamed',
        staged: false,
        unstaged: false,
        conflicted: false
      }
    ]);
    expect(parseShortStat(' 3 files changed, 12 insertions(+), 4 deletions(-)\n')).toEqual({
      filesChanged: 3,
      additions: 12,
      deletions: 4
    });
    expect(parseShortStat(' 1 file changed, 2 deletions(-)\n')).toEqual({
      filesChanged: 1,
      additions: 0,
      deletions: 2
    });
  });

  it('parses porcelain v2 output from real repositories with edge-case paths and conflicts', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-parser-'));

    try {
      const dirtyRepoPath = join(rootPath, 'dirty');
      const remotePath = join(rootPath, 'remote.git');
      const remoteClonePath = join(rootPath, 'remote-clone');
      await mkdir(dirtyRepoPath);

      await git(dirtyRepoPath, ['init']);
      await git(dirtyRepoPath, ['config', 'user.name', 'Parser Test']);
      await git(dirtyRepoPath, ['config', 'user.email', 'parser@example.test']);
      await writeRepoFile(dirtyRepoPath, '1 notes.txt', 'rename source\n');
      await writeRepoFile(dirtyRepoPath, 'delete me.txt', 'delete source\n');
      await writeRepoFile(dirtyRepoPath, 'conflict.txt', 'base\n');
      await git(dirtyRepoPath, ['add', '.']);
      await git(dirtyRepoPath, ['commit', '-m', 'base']);
      await git(dirtyRepoPath, ['checkout', '-B', 'main']);

      await git(rootPath, ['init', '--bare', remotePath]);
      await git(dirtyRepoPath, ['remote', 'add', 'origin', remotePath]);
      await git(dirtyRepoPath, ['push', '-u', 'origin', 'main']);

      await writeRepoFile(dirtyRepoPath, 'local ahead.txt', 'ahead\n');
      await git(dirtyRepoPath, ['add', 'local ahead.txt']);
      await git(dirtyRepoPath, ['commit', '-m', 'local ahead']);

      await git(rootPath, ['clone', '--branch', 'main', remotePath, remoteClonePath]);
      await git(remoteClonePath, ['config', 'user.name', 'Parser Test']);
      await git(remoteClonePath, ['config', 'user.email', 'parser@example.test']);
      await writeRepoFile(remoteClonePath, 'remote behind.txt', 'behind\n');
      await git(remoteClonePath, ['add', 'remote behind.txt']);
      await git(remoteClonePath, ['commit', '-m', 'remote behind']);
      await git(remoteClonePath, ['push', 'origin', 'main']);
      await git(dirtyRepoPath, ['fetch', 'origin']);

      await git(dirtyRepoPath, ['mv', '1 notes.txt', 'renamed one.txt']);
      await git(dirtyRepoPath, ['rm', 'delete me.txt']);
      await writeRepoFile(dirtyRepoPath, 'odd name @!.txt', 'untracked\n');

      const dirtyStatus = parseStatusPorcelainV2(
        (await git(dirtyRepoPath, ['status', '--porcelain=v2', '--branch', '-z'])).stdout
      );

      expect(dirtyStatus.branch).toMatchObject({
        head: 'main',
        upstream: 'origin/main',
        ahead: 1,
        behind: 1
      });
      expect(dirtyStatus.files.find((file) => file.path === 'renamed one.txt')).toMatchObject({
        originalPath: '1 notes.txt',
        status: 'renamed',
        staged: true
      });
      expect(dirtyStatus.files.find((file) => file.path === 'delete me.txt')).toMatchObject({
        status: 'deleted',
        staged: true
      });
      expect(dirtyStatus.files.find((file) => file.path === 'odd name @!.txt')).toMatchObject({
        status: 'untracked',
        unstaged: true
      });

      const conflictRepoPath = join(rootPath, 'conflict');
      await mkdir(conflictRepoPath);
      await git(conflictRepoPath, ['init']);
      await git(conflictRepoPath, ['config', 'user.name', 'Parser Test']);
      await git(conflictRepoPath, ['config', 'user.email', 'parser@example.test']);
      await writeRepoFile(conflictRepoPath, 'conflict.txt', 'base\n');
      await git(conflictRepoPath, ['add', '.']);
      await git(conflictRepoPath, ['commit', '-m', 'base']);
      await git(conflictRepoPath, ['checkout', '-B', 'main']);
      await git(conflictRepoPath, ['checkout', '-b', 'feature']);
      await writeRepoFile(conflictRepoPath, 'conflict.txt', 'feature\n');
      await git(conflictRepoPath, ['commit', '-am', 'feature edit']);
      await git(conflictRepoPath, ['checkout', 'main']);
      await writeRepoFile(conflictRepoPath, 'conflict.txt', 'main\n');
      await git(conflictRepoPath, ['commit', '-am', 'main edit']);
      await expectGitFailure(conflictRepoPath, ['merge', 'feature']);

      const conflictStatus = parseStatusPorcelainV2(
        (await git(conflictRepoPath, ['status', '--porcelain=v2', '--branch', '-z'])).stdout
      );

      expect(conflictStatus.files.find((file) => file.path === 'conflict.txt')).toMatchObject({
        status: 'conflicted',
        conflicted: true
      });
      expect(conflictStatus.conflictedCount).toBe(1);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});

async function writeRepoFile(repoPath: string, relativePath: string, contents: string): Promise<void> {
  const filePath = join(repoPath, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function git(cwd: string, args: string[]) {
  return gitExecutor.run(args, { cwd, kind: 'mutation' });
}

async function expectGitFailure(cwd: string, args: string[]): Promise<void> {
  try {
    await git(cwd, args);
  } catch (error) {
    if (error instanceof GitCommandError) {
      return;
    }

    throw error;
  }

  throw new Error(`git ${args.join(' ')} unexpectedly succeeded`);
}
