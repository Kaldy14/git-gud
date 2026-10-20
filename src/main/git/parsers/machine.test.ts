import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

    const snapshot = parseMachineSnapshot(`${status}\0${MACHINE_REFS_MARKER}${refs}\n`);

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
});
