import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parsePatchFiles } from '@pierre/diffs';

import {
  MACHINE_MISSING_MARKER,
  MACHINE_REFS_MARKER,
  machineFileDiffCommand,
  machineSnapshotCommand,
  parseMachineSnapshot,
  quoteRemoteShell,
  remoteShellPath
} from './machine';

const run = promisify(execFile);
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

describe('machine snapshot parsing', () => {
  it('quotes remote paths so the home prefix still expands', () => {
    expect(quoteRemoteShell("it's")).toBe(`'it'\\''s'`);
    expect(remoteShellPath('~')).toBe('~');
    expect(remoteShellPath('~/Data/My Repo')).toBe(`~/'Data/My Repo'`);
    expect(remoteShellPath('/srv/repo')).toBe(`'/srv/repo'`);
  });

  it('parses status and branches, putting the checked-out branch first', () => {
    const status = [
      `# branch.oid ${SHA_A}`,
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +1 -0',
      `1 .M N... 100644 100644 100644 ${SHA_A} ${SHA_A} src/app.ts`,
      '? notes.txt'
    ].join('\0');
    const refs = [
      ['feature/x', SHA_B, '', ''].join('\0'),
      ['main', SHA_A, 'origin/main', 'ahead 1, behind 2'].join('\0')
    ].join('\n');

    const snapshot = parseMachineSnapshot(`${status}${MACHINE_REFS_MARKER}${refs}\n`);

    expect(snapshot.kind).toBe('repository');
    if (snapshot.kind !== 'repository') return;
    expect(snapshot.status.files.map((file) => [file.path, file.status])).toEqual([
      ['src/app.ts', 'modified'],
      ['notes.txt', 'untracked']
    ]);
    expect(snapshot.branches).toEqual([
      { name: 'main', sha: SHA_A, upstream: 'origin/main', ahead: 1, behind: 2, current: true },
      { name: 'feature/x', sha: SHA_B, ahead: 0, behind: 0, current: false }
    ]);
  });

  it('reports a missing checkout and rejects unexpected output', () => {
    expect(parseMachineSnapshot(MACHINE_MISSING_MARKER)).toEqual({ kind: 'missing' });
    expect(() => parseMachineSnapshot('bash: git: command not found')).toThrow(/unexpected/);
  });
});

describe('machine shell commands', () => {
  let repoPath = '';

  beforeAll(async () => {
    repoPath = await mkdtemp(join(tmpdir(), "git-gud machine '"));
    const git = (...args: string[]) => run('git', ['-C', repoPath, ...args]);
    await git('init', '-q', '-b', 'main');
    await git('config', 'user.email', 'machine@example.test');
    await git('config', 'user.name', 'Machine Test');
    await writeFile(join(repoPath, 'tracked.txt'), 'one\n');
    await git('add', 'tracked.txt');
    await git('commit', '-q', '-m', 'initial');
    await writeFile(join(repoPath, 'tracked.txt'), 'two\n');
    await writeFile(join(repoPath, 'new file.txt'), 'hello\n');
  });

  afterAll(async () => {
    await rm(repoPath, { recursive: true, force: true });
  });

  it('reads a snapshot without touching the index', async () => {
    const indexBefore = await stat(join(repoPath, '.git', 'index'));
    const { stdout } = await run('sh', ['-c', machineSnapshotCommand(repoPath)], { encoding: 'utf8' });
    const indexAfter = await stat(join(repoPath, '.git', 'index'));

    const snapshot = parseMachineSnapshot(stdout);
    expect(snapshot.kind).toBe('repository');
    if (snapshot.kind !== 'repository') return;
    expect(snapshot.status.files.map((file) => file.path).sort()).toEqual(['new file.txt', 'tracked.txt']);
    expect(snapshot.branches.map((branch) => [branch.name, branch.current])).toEqual([['main', true]]);
    expect(indexAfter.mtimeMs).toBe(indexBefore.mtimeMs);
  });

  it('reports missing checkouts and reads tracked and untracked diffs', async () => {
    const missing = await run('sh', ['-c', machineSnapshotCommand(join(repoPath, 'nope'))], { encoding: 'utf8' });
    expect(parseMachineSnapshot(missing.stdout)).toEqual({ kind: 'missing' });

    const tracked = await run('sh', ['-c', machineFileDiffCommand(repoPath, { path: 'tracked.txt', staged: false, untracked: false })], {
      encoding: 'utf8'
    });
    expect(tracked.stdout).toContain('+two');

    const untracked = await run('sh', ['-c', machineFileDiffCommand(repoPath, { path: 'new file.txt', staged: false, untracked: true })], {
      encoding: 'utf8'
    });
    expect(untracked.stdout).toContain('+hello');

    await expect(
      run('sh', ['-c', machineFileDiffCommand(join(repoPath, 'nope'), { path: 'tracked.txt', staged: false, untracked: false })])
    ).rejects.toMatchObject({ code: 2 });
  });

  it('reports unavailable Git as a command failure instead of a missing checkout', async () => {
    const shellOnlyPath = await mkdtemp(join(tmpdir(), 'git-gud-shell-only-'));
    try {
      await symlink('/bin/sh', join(shellOnlyPath, 'sh'));
      await expect(run('/bin/sh', ['-c', machineSnapshotCommand(repoPath)], {
        env: { ...process.env, PATH: shellOnlyPath }
      })).rejects.toMatchObject({ code: 127, stdout: '', stderr: expect.stringContaining('Git is not available') });
    } finally {
      await rm(shellOnlyPath, { recursive: true, force: true });
    }
  });

  it('fails the snapshot when Git cannot read the index instead of returning clean status', async () => {
    const corruptIndex = join(repoPath, 'corrupt-index');
    await writeFile(corruptIndex, 'invalid index');
    await expect(run('sh', ['-c', machineSnapshotCommand(repoPath)], {
      env: { ...process.env, GIT_INDEX_FILE: corruptIndex }
    })).rejects.toMatchObject({ code: 128, stdout: '', stderr: expect.stringContaining('index') });
  });

  it('preserves a Git ownership error instead of reporting a missing checkout', async () => {
    await expect(run('sh', ['-c', machineSnapshotCommand(repoPath)], {
      env: {
        ...process.env, GIT_TEST_ASSUME_DIFFERENT_OWNER: '1',
        GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: ''
      }
    })).rejects.toMatchObject({ code: 128, stdout: '', stderr: expect.stringContaining('dubious ownership') });
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0).each(['checkout', 'git directory'])(
    'does not clear machine refs when the %s is inaccessible', async (target) => {
      const directory = await mkdtemp(join(tmpdir(), 'git-gud-inaccessible-'));
      const inaccessible = target === 'checkout' ? directory : join(directory, '.git');
      try {
        await run('git', ['init', '-q', directory]);
        await chmod(inaccessible, 0);
        await expect(run('sh', ['-c', machineSnapshotCommand(directory)]))
          .rejects.toMatchObject({ code: 128, stdout: '', stderr: expect.stringContaining('fatal:') });
      } finally {
        await chmod(inaccessible, 0o700);
        await rm(directory, { recursive: true, force: true });
      }
    }
  );

  it('reports an existing directory without a repository as missing', async () => {
    const emptyDirectory = await mkdtemp(join(tmpdir(), 'git-gud-no-repository-'));
    try {
      const { stdout } = await run('sh', ['-c', machineSnapshotCommand(emptyDirectory)]);
      expect(parseMachineSnapshot(stdout)).toEqual({ kind: 'missing' });
    } finally {
      await rm(emptyDirectory, { recursive: true, force: true });
    }
  });

  it('does not read an enclosing repository as the mapped checkout', async () => {
    const nested = join(repoPath, 'not-a-checkout');
    await mkdir(nested);
    const { stdout } = await run('sh', ['-c', machineSnapshotCommand(nested)]);
    expect(parseMachineSnapshot(stdout)).toEqual({ kind: 'missing' });
  });

  it('still accepts a linked worktree as a checkout root', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'git-gud-machine-worktree-'));
    const worktree = join(directory, 'linked');
    try {
      await run('git', ['-C', repoPath, 'worktree', 'add', '--detach', worktree]);
      const { stdout } = await run('sh', ['-c', machineSnapshotCommand(worktree)]);
      expect(parseMachineSnapshot(stdout).kind).toBe('repository');
    } finally {
      await run('git', ['-C', repoPath, 'worktree', 'remove', '--force', worktree]);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([false, true])('reads only the selected literal filename when staged=%s', async (staged) => {
    const directory = await mkdtemp(join(tmpdir(), 'git-gud-literal-diff-'));
    const git = (...args: string[]) => run('git', ['-C', directory, ...args]);
    try {
      await git('init', '-q', '-b', 'main');
      await git('config', 'user.email', 'machine@example.test');
      await git('config', 'user.name', 'Machine Test');
      for (const name of ['file[1].txt', 'file1.txt']) await writeFile(join(directory, name), 'original\n');
      await git('add', '.');
      await git('commit', '-qm', 'initial');
      for (const name of ['file[1].txt', 'file1.txt']) await writeFile(join(directory, name), `changed ${name}\n`);
      if (staged) await git('add', '.');
      const { stdout } = await run('sh', ['-c', machineFileDiffCommand(directory, {
        path: 'file[1].txt', staged, untracked: false
      })]);
      expect(stdout).toContain('+changed file[1].txt');
      expect(stdout).not.toContain('+changed file1.txt');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('reads branch tracking counts with a non-English login locale', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'git-gud-tracking-locale-'));
    const git = (...args: string[]) => run('git', ['-C', directory, ...args]);
    try {
      await git('init', '-q', '-b', 'main');
      await git('config', 'user.email', 'machine@example.test');
      await git('config', 'user.name', 'Machine Test');
      await git('commit', '--allow-empty', '-qm', 'base');
      await git('branch', 'upstream');
      await git('branch', '--set-upstream-to=upstream', 'main');
      await git('commit', '--allow-empty', '-qm', 'ahead');
      const { stdout } = await run('sh', ['-c', machineSnapshotCommand(directory)], {
        env: { ...process.env, LC_ALL: 'fr_FR.UTF-8', LANG: 'fr_FR.UTF-8', LANGUAGE: 'fr' }
      });
      const snapshot = parseMachineSnapshot(stdout);
      expect(snapshot.kind).toBe('repository');
      if (snapshot.kind === 'repository') expect(snapshot.branches.find((branch) => branch.name === 'main'))
        .toMatchObject({ upstream: 'upstream', ahead: 1, behind: 0 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps a rename from a marker-like filename separate from branch data', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'git-gud-snapshot-framing-'));
    const git = (...args: string[]) => run('git', ['-C', directory, ...args]);
    try {
      await git('init', '-q', '-b', 'main');
      await git('config', 'user.email', 'machine@example.test');
      await git('config', 'user.name', 'Machine Test');
      await writeFile(join(directory, '__GG_REFS__'), 'rename me\n');
      await git('add', '.');
      await git('commit', '-qm', 'initial');
      await git('mv', '__GG_REFS__', 'renamed.txt');
      const { stdout } = await run('sh', ['-c', machineSnapshotCommand(directory)]);
      const snapshot = parseMachineSnapshot(stdout);
      expect(snapshot.kind).toBe('repository');
      if (snapshot.kind !== 'repository') return;
      expect(snapshot.status.files).toMatchObject([{ path: 'renamed.txt', originalPath: '__GG_REFS__', staged: true }]);
      expect(snapshot.branches).toMatchObject([{ name: 'main', current: true }]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ['external', false], ['external', true], ['textconv', false], ['textconv', true]
  ] as const)('never runs a configured %s helper for untracked=%s', async (helperKind, untracked) => {
    const directory = await mkdtemp(join(tmpdir(), 'git-gud-read-only-diff-'));
    const git = (...args: string[]) => run('git', ['-C', directory, ...args]);
    const marker = join(directory, 'helper-ran');
    const helper = join(directory, 'helper.sh');
    try {
      await git('init', '-q', '-b', 'main');
      await git('config', 'user.email', 'machine@example.test');
      await git('config', 'user.name', 'Machine Test');
      await writeFile(join(directory, 'file.txt'), 'original\n');
      await git('add', 'file.txt');
      await git('commit', '-qm', 'initial');
      await writeFile(helper, `printf invoked >> ${quoteRemoteShell(marker)}\nprintf 'helper output\\n'\n`);
      await git('config', helperKind === 'external' ? 'diff.external' : 'diff.fixture.textconv', `sh ${quoteRemoteShell(helper)}`);
      await writeFile(join(directory, '.gitattributes'), '*.txt diff=fixture\n');
      const path = untracked ? 'new.txt' : 'file.txt';
      await writeFile(join(directory, path), 'changed\n');
      const { stdout } = await run('sh', ['-c', machineFileDiffCommand(directory, { path, staged: false, untracked })]);
      expect(existsSync(marker)).toBe(false);
      expect(stdout).toContain('+changed');
      expect(parsePatchFiles(stdout).flatMap((patch) => patch.files)).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.runIf(existsSync('/bin/csh'))('reads snapshots and diffs through a non-POSIX login shell', async () => {
    const snapshot = await run('/bin/csh', ['-f', '-c', machineSnapshotCommand(repoPath)]);
    expect(parseMachineSnapshot(snapshot.stdout).kind).toBe('repository');
    const diff = await run('/bin/csh', ['-f', '-c', machineFileDiffCommand(repoPath, {
      path: 'tracked.txt', staged: false, untracked: false
    })]);
    expect(diff.stdout).toContain('+two');
  });

  it('returns a renderable diff with conflict markers for an unmerged file', async () => {
    const git = (...args: string[]) => run('git', ['-C', repoPath, ...args]);
    await git('checkout', '-qb', 'theirs');
    await writeFile(join(repoPath, 'tracked.txt'), 'theirs\n');
    await git('commit', '-qam', 'theirs');
    await git('checkout', '-q', 'main');
    await writeFile(join(repoPath, 'tracked.txt'), 'ours\n');
    await git('commit', '-qam', 'ours');
    await expect(git('merge', 'theirs')).rejects.toMatchObject({ code: 1 });

    const { stdout } = await run('sh', ['-c', machineFileDiffCommand(repoPath, {
      path: 'tracked.txt', staged: false, untracked: false
    })]);
    expect(stdout).toContain('+<<<<<<< HEAD');
    const files = parsePatchFiles(stdout).flatMap((patch) => patch.files);
    expect(files).toHaveLength(1);
    expect(files.flatMap((file) => file.hunks)).not.toHaveLength(0);
  });
});
