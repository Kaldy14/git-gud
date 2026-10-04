import { afterEach, describe, expect, it } from 'vitest';

import type { BranchCleanupCandidate } from '@shared/maintenance';

import {
  addWithinLimit,
  buildRestoreCommand,
  formatAge,
  isAnalyzed,
  parseAgeDays,
  shellQuote,
  shortRefName
} from './branchCleanupPresentation';

// The renderer tsconfig has no Node types. Load the few Node APIs these tests
// need through untyped specifiers so Node globals do not leak into the web build.
type ExecOptions = { cwd?: string; encoding?: 'utf8'; stdio?: 'pipe'; env?: Record<string, string | undefined> };
const nodeModule = (name: string): Promise<unknown> => import(/* @vite-ignore */ `node:${name}`);
const { execFileSync } = (await nodeModule('child_process')) as {
  execFileSync: (file: string, args: string[], options?: ExecOptions) => string;
};
const { mkdtempSync, rmSync } = (await nodeModule('fs')) as {
  mkdtempSync: (prefix: string) => string;
  rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void;
};
const { tmpdir } = (await nodeModule('os')) as { tmpdir: () => string };
const { join } = (await nodeModule('path')) as { join: (...parts: string[]) => string };
const testEnv = {
  ...(globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env,
  GIT_CONFIG_NOSYSTEM: '1'
};

function candidate(overrides: Partial<BranchCleanupCandidate>): BranchCleanupCandidate {
  return {
    ref: 'refs/heads/feature/a',
    name: 'feature/a',
    sha: 'a'.repeat(40),
    scope: 'local',
    branchName: 'feature/a',
    oldEnough: true,
    evidence: 'merged',
    explanation: '',
    upstreamGone: false,
    ...overrides
  };
}

describe('parseAgeDays', () => {
  it('accepts whole numbers in range', () => {
    expect(parseAgeDays('0')).toBe(0);
    expect(parseAgeDays(' 30 ')).toBe(30);
    expect(parseAgeDays('36500')).toBe(36500);
  });

  it('rejects empty, fractional, negative, and out-of-range values', () => {
    for (const value of ['', '1.5', '-1', '36501', '1e3', 'abc']) {
      expect(parseAgeDays(value)).toBeUndefined();
    }
  });
});

describe('formatAge', () => {
  it('formats compact ages', () => {
    expect(formatAge(undefined)).toBe('Unknown');
    expect(formatAge(0.4)).toBe('Today');
    expect(formatAge(12.9)).toBe('12 d');
    expect(formatAge(95)).toBe('3 mo');
    expect(formatAge(800)).toBe('2 y');
  });
});

describe('shortRefName', () => {
  it('strips local and remote prefixes', () => {
    expect(shortRefName('refs/heads/main')).toBe('main');
    expect(shortRefName('refs/remotes/origin/main')).toBe('origin/main');
  });
});

describe('isAnalyzed', () => {
  it('excludes protected and recent branches', () => {
    expect(isAnalyzed({ oldEnough: true })).toBe(true);
    expect(isAnalyzed({ oldEnough: false })).toBe(false);
    expect(isAnalyzed({ oldEnough: true, protectedReason: 'Mainline or default branch' })).toBe(false);
  });
});

describe('addWithinLimit', () => {
  it('adds refs in order until the limit and counts the rest', () => {
    const { next, skipped } = addWithinLimit(new Set(['a']), ['a', 'b', 'c', 'd'], 3);
    expect(Array.from(next)).toEqual(['a', 'b', 'c']);
    expect(skipped).toBe(1);
  });

  it('does not mutate the current selection', () => {
    const current = new Set(['a']);
    addWithinLimit(current, ['b'], 5);
    expect(Array.from(current)).toEqual(['a']);
  });
});

const tricky = [`it's`, 'a$HOME', 'a`id`b', 'semi;colon', 'back\\slash', '"quoted"', 'spa ce', ''];

function shellArgs(command: string): string[] {
  // Prints each argument the shell parsed, NUL-separated.
  const output = execFileSync('/bin/sh', ['-c', `printf '%s\\0' ${command}`], { encoding: 'utf8' });
  return output.split('\0').slice(0, -1);
}

describe('shellQuote', () => {
  it('quotes apostrophes', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });

  it('round-trips metacharacters through a POSIX shell', () => {
    for (const value of tricky) {
      expect(shellArgs(shellQuote(value))).toEqual([value]);
    }
  });
});

describe('buildRestoreCommand', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...testEnv, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(cwd, 'test-global.gitconfig') } }).trim();
  }

  function run(cwd: string, command: string): void {
    execFileSync('/bin/sh', ['-c', command], { cwd, stdio: 'pipe', env: { ...testEnv, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(cwd, 'test-global.gitconfig') } });
  }

  function repository(): { root: string; work: string; remote: string; sha: string } {
    const root = mkdtempSync(join(tmpdir(), 'git-gud-restore-'));
    directories.push(root);
    const work = join(root, 'work');
    const remote = join(root, 'remote.git');
    execFileSync('git', ['init', '-q', '--bare', remote]);
    execFileSync('git', ['init', '-q', '-b', 'main', work]);
    git(work, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '--allow-empty', '-m', 'init');
    git(work, 'remote', 'add', 'origin', remote);
    const sha = git(work, 'rev-parse', 'HEAD');
    git(work, 'update-ref', 'refs/git-gud/cleanup/1/local/x', sha);
    return { root, work, remote, sha };
  }

  it('recreates a local branch from its recovery ref', () => {
    expect(buildRestoreCommand(candidate({ branchName: "fix/it's" }), 'refs/git-gud/backup/1')).toBe(
      `git branch -- 'fix/it'\\''s' 'refs/git-gud/backup/1'`
    );
  });

  it('pushes a remote branch back only if it does not exist', () => {
    expect(
      buildRestoreCommand(
        candidate({ scope: 'remote', remote: 'upstream', ref: 'refs/remotes/upstream/feature/a', name: 'upstream/feature/a' }),
        'refs/git-gud/backup/2'
      )
    ).toBe(
      `git push --no-mirror --no-follow-tags --recurse-submodules=no '--force-with-lease=refs/heads/feature/a:' -- 'upstream' 'refs/git-gud/backup/2:refs/heads/feature/a'`
    );
  });

  it('parses into the intended arguments for unusual names', () => {
    const command = buildRestoreCommand(
      candidate({ scope: 'remote', remote: 'o$r', branchName: "it's/`x`" }),
      'refs/git-gud/cleanup/1/remote/a'
    );
    expect(shellArgs(command)).toEqual([
      'git', 'push', '--no-mirror', '--no-follow-tags', '--recurse-submodules=no',
      "--force-with-lease=refs/heads/it's/`x`:", '--', 'o$r', "refs/git-gud/cleanup/1/remote/a:refs/heads/it's/`x`"
    ]);
  });

  it('restores branches with real Git and refuses to overwrite existing ones', () => {
    const { work, remote, sha } = repository();
    const recoveryRef = 'refs/git-gud/cleanup/1/local/x';
    const local = buildRestoreCommand(candidate({ branchName: "fix/it's" }), recoveryRef);
    const pushed = buildRestoreCommand(candidate({ scope: 'remote', remote: 'origin', branchName: 'feature/$a' }), recoveryRef);

    run(work, local);
    expect(git(work, 'rev-parse', "refs/heads/fix/it's")).toBe(sha);
    expect(() => run(work, local)).toThrow();

    run(work, pushed);
    expect(git(remote, 'rev-parse', 'refs/heads/feature/$a')).toBe(sha);

    // An ordinary push would fast-forward this recreated branch, but the
    // restore command still requires the destination to be absent.
    git(work, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '--allow-empty', '-m', 'next');
    const next = git(work, 'rev-parse', 'HEAD');
    git(work, 'update-ref', recoveryRef, next);
    expect(git(work, 'push', '--dry-run', 'origin', `${recoveryRef}:refs/heads/feature/$a`)).toBe('');
    expect(() => run(work, pushed)).toThrow();
    expect(git(remote, 'rev-parse', 'refs/heads/feature/$a')).toBe(sha);

    // Diverged destinations are preserved too.
    git(work, 'push', '-q', '--force', 'origin', 'HEAD:refs/heads/feature/$a');
    git(work, 'update-ref', recoveryRef, sha);
    const moved = git(work, 'rev-parse', 'HEAD');
    expect(() => run(work, pushed)).toThrow();
    expect(git(remote, 'rev-parse', 'refs/heads/feature/$a')).toBe(moved);
  });
});
