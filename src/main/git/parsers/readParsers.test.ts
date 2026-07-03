import { describe, expect, it } from 'vitest';

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
        ['refs/remotes/origin/main', 'origin/main', 'bbb', '', '', '', '2026-07-02T09:00:00+02:00'].join('\0'),
        ['refs/tags/v0.1.0', 'v0.1.0', 'ccc', '', '', '', '2026-07-01T09:00:00+02:00'].join('\0')
      ].join('\n')
    );
    const remotes = parseRemoteVerbose('origin\tgit@github.com:kaldy/git-gud.git (fetch)\norigin\tgit@github.com:kaldy/git-gud.git (push)\n');

    expect(refs.localBranches[0]).toMatchObject({ name: 'main', current: true, ahead: 1, behind: 2 });
    expect(refs.remoteBranches[0]).toMatchObject({ name: 'origin/main', remote: 'origin' });
    expect(refs.tags[0]).toMatchObject({ name: 'v0.1.0', sha: 'ccc' });
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
    const commits = parseGitLog(
      ['abc', 'def ghi', 'Kaldy', 'kaldy@example.com', '2026-07-02T10:00:00+02:00', '2026-07-02T10:01:00+02:00', 'HEAD -> main, tag: v1', 'subject'].join(
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
    expect(commits[0]).toMatchObject({
      sha: 'abc',
      parentShas: ['def', 'ghi'],
      refs: ['HEAD -> main', 'tag: v1'],
      subject: 'subject'
    });
  });
});
