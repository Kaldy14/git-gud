import { ChildProcess, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RemoteMachine } from '@shared/types';

const data = vi.hoisted(() => ({ machines: [] as RemoteMachine[] }));
vi.mock('electron-store', () => ({
  default: class {
    get() { return data.machines; }
    set(_key: string, value: RemoteMachine[]) { data.machines = value; }
  }
}));
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(), spawn: vi.fn()
}));
vi.mock('./profiles', () => ({ createProfileCommandEnv: vi.fn() }));
vi.mock('./git/exec', () => ({
  gitExecutor: {
    run: vi.fn(),
    transaction: vi.fn((_directory: string, operation: () => Promise<unknown>) => operation())
  }
}));

import { gitExecutor } from './git/exec';
import { deleteMachine, listMachines, loadCommitGraphMachines, loadMachineFileDiff, remoteRepositoryPath, saveMachine, testMachine, type RefMutationRunner } from './machines';

const runGuard: RefMutationRunner = (_directory, operation) => operation();
const tab = { path: '/repo', commonDir: '/repo/.git' };
const sha = 'a'.repeat(40);
const snapshotOutput = `# branch.oid ${sha}\0# branch.head main\0\0main\0${sha}\0\0\n`;

function pendingSsh() {
  const child = Object.assign(new ChildProcess(), { stdout: new PassThrough(), stderr: new PassThrough() });
  vi.mocked(spawn).mockReturnValueOnce(child);
  return child;
}

beforeEach(() => {
  vi.clearAllMocks();
  data.machines = [];
  vi.mocked(gitExecutor.run).mockResolvedValue({ args: [], cwd: '/repo', stdout: '', stderr: '', exitCode: 0 });
  vi.mocked(spawn).mockImplementation(() => {
    const child = Object.assign(new ChildProcess(), { stdout: new PassThrough(), stderr: new PassThrough() });
    queueMicrotask(() => {
      child.stdout.end('__GG_MISSING__');
      child.emit('close', 0);
    });
    return child;
  });
});

describe('missing machine checkout', () => {
  it('keeps healthy machine snapshots when a missing checkout cannot prune its local refs', async () => {
    saveMachine({ name: 'missing', sshHost: 'missing' });
    saveMachine({ name: 'online', sshHost: 'online' });
    const missing = pendingSsh();
    const online = pendingSsh();
    vi.mocked(gitExecutor.run).mockRejectedValueOnce(new Error('permission denied'));

    const pending = loadCommitGraphMachines(tab, runGuard);
    missing.stdout.end('__GG_MISSING__');
    missing.emit('close', 0);
    online.stdout.end(snapshotOutput);
    online.emit('close', 0);

    const result = await pending;
    expect(result.machines).toHaveLength(2);
    expect(result.machines[0]).toMatchObject({ state: 'missing', message: expect.stringContaining('permission denied') });
    expect(result.machines[1]).toMatchObject({ state: 'online', branches: [{ name: 'main', sha }] });
  });

  it.each([true, false])('prunes only its mirrored refs and reports graph invalidation when refs exist=%s', async (hasRefs) => {
    const [machine] = saveMachine({ name: 'omarchy', sshHost: 'omarchy' });
    const ref = `refs/machines/${machine!.id}/heads/main`;
    vi.mocked(gitExecutor.run).mockResolvedValue({ args: [], cwd: '/repo', stdout: hasRefs ? `${ref}\n` : '', stderr: '', exitCode: 0 });
    const guardCalls = vi.fn();
    const guard: RefMutationRunner = (directory, operation) => {
      guardCalls(directory);
      return operation();
    };
    const result = await loadCommitGraphMachines(tab, guard);

    expect(result.refsChanged).toBe(hasRefs);
    expect(result.machines[0]).toMatchObject({ state: 'missing', current: true, branches: [] });
    expect(gitExecutor.transaction).toHaveBeenCalledWith(tab.commonDir, expect.any(Function));
    expect(guardCalls).toHaveBeenCalledWith(tab.commonDir);
    if (hasRefs) {
      expect(gitExecutor.run).toHaveBeenCalledWith(['update-ref', '--stdin'], {
        cwd: '/repo', kind: 'mutation', input: `delete ${ref}\n`
      });
    } else {
      expect(gitExecutor.run).toHaveBeenCalledTimes(1);
    }
  });
});

describe('machine poll lifecycle', () => {
  it('keeps failed removals disabled for retry while cleaning other repositories', async () => {
    const [machine] = saveMachine({ name: 'omarchy', sshHost: 'omarchy' });
    const otherTab = { path: '/other', commonDir: '/other/.git' };
    let locked = true;
    vi.mocked(gitExecutor.run).mockImplementation(async (args, options) => {
      if (args[0] === 'update-ref' && options?.cwd === tab.path && locked) throw new Error('ref is locked');
      return { args: [...args], cwd: options?.cwd ?? tab.path, stdout: args[0] === 'for-each-ref' ? `refs/machines/${machine!.id}/HEAD\n` : '', stderr: '', exitCode: 0 };
    });
    await expect(deleteMachine(machine!.id, [tab, tab, otherTab], runGuard)).rejects.toThrow('/repo: ref is locked');
    expect(listMachines()).toMatchObject([{ id: machine!.id, enabled: false }]);
    expect(gitExecutor.run).toHaveBeenCalledWith(['update-ref', '--stdin'], expect.objectContaining({ cwd: otherTab.path }));
    expect(gitExecutor.transaction).toHaveBeenCalledTimes(2);
    expect((await loadCommitGraphMachines(tab, runGuard)).machines).toEqual([]);
    expect(spawn).not.toHaveBeenCalled();

    locked = false;
    await expect(deleteMachine(machine!.id, [tab, otherTab], runGuard)).resolves.toEqual([]);
    expect(listMachines()).toEqual([]);
  });

  it.each([
    { output: 'diff --git a/new.txt b/new.txt\n+content\n', error: '', succeeds: true },
    { output: '', error: 'Could not access new.txt', succeeds: false },
    { output: 'diff --git a/new.txt b/new.txt\n', error: 'Could not read new.txt', succeeds: false }
  ])('distinguishes a no-index patch from a failed read: $succeeds, $error', async ({ output, error, succeeds }) => {
    const [machine] = saveMachine({ name: 'omarchy', sshHost: 'omarchy' });
    const status = pendingSsh();
    const snapshot = loadCommitGraphMachines(tab, runGuard);
    status.stdout.end(snapshotOutput.replace('\0\0', '\0? new.txt\0\0'));
    status.emit('close', 0);
    await snapshot;
    const child = pendingSsh();
    const diff = loadMachineFileDiff(tab, { machineId: machine!.id, path: 'new.txt', staged: false, untracked: true });
    child.stdout.end(output);
    child.stderr.end(error);
    child.emit('close', 1);
    if (succeeds) await expect(diff).resolves.toBe(output);
    else await expect(diff).rejects.toThrow(error);
  });

  it('fails the connection check when the POSIX shell needed by polling is unavailable', async () => {
    vi.mocked(spawn).mockImplementationOnce((_executable, args) => {
      const child = Object.assign(new ChildProcess(), { stdout: new PassThrough(), stderr: new PassThrough() });
      queueMicrotask(() => {
        const needsShell = args?.at(-1)?.startsWith('sh -c');
        if (needsShell) child.stderr.end('sh is not recognized');
        else child.stdout.end('git version 2.50.0\nwindows-host\n');
        child.emit('close', needsShell ? 127 : 0);
      });
      return child;
    });
    await expect(testMachine({ sshHost: 'windows-host' })).resolves.toMatchObject({ ok: false, message: expect.stringContaining('sh is not recognized') });
  });

  it('prunes a mirrored HEAD for an unborn checkout and does not fetch again on the next poll', async () => {
    const [machine] = saveMachine({ name: 'omarchy', sshHost: 'omarchy' });
    const headRef = `refs/machines/${machine!.id}/HEAD`;
    let hasHead = true;
    vi.mocked(gitExecutor.run).mockImplementation(async (args) => {
      if (args[0] === 'update-ref' && args[1] === '-d' && args[2] === headRef) hasHead = false;
      return {
        args: [...args], cwd: tab.path, stdout: args[0] === 'for-each-ref' && hasHead ? `${headRef}\0${sha}\n` : '',
        stderr: '', exitCode: 0
      };
    });
    for (const refsChanged of [true, false]) {
      const child = pendingSsh();
      const pending = loadCommitGraphMachines(tab, runGuard);
      child.stdout.end('# branch.oid (initial)\0# branch.head orphan\0\0');
      child.emit('close', 0);
      expect((await pending).refsChanged).toBe(refsChanged);
    }
    expect(gitExecutor.run).toHaveBeenCalledWith(['update-ref', '-d', headRef], expect.objectContaining({ kind: 'mutation' }));
    expect(vi.mocked(gitExecutor.run).mock.calls.filter(([args]) => args[0] === 'fetch')).toHaveLength(1);
  });

  it('only reads untracked files that Git listed in the snapshot', async () => {
    const [machine] = saveMachine({ name: 'omarchy', sshHost: 'omarchy' });
    const child = pendingSsh();
    const pending = loadCommitGraphMachines(tab, runGuard);
    child.stdout.end(snapshotOutput.replace('\0\0', '\0? new.txt\0\0'));
    child.emit('close', 0);
    await pending;
    const request = { machineId: machine!.id, staged: false, untracked: true };

    for (const path of ['symlink/secret.txt', '.git/config', '../outside.txt']) {
      await expect(loadMachineFileDiff(tab, { ...request, path })).rejects.toThrow('not untracked');
    }
    expect(spawn).toHaveBeenCalledTimes(1);

    const diff = pendingSsh();
    const read = loadMachineFileDiff(tab, { ...request, path: 'new.txt' });
    diff.stdout.end('file diff');
    diff.emit('close', 0);
    expect(await read).toBe('file diff');
  });

  it('does not recreate refs when a machine is removed during its SSH read', async () => {
    const [machine] = saveMachine({ name: 'omarchy', sshHost: 'omarchy' });
    const child = pendingSsh();
    const pending = loadCommitGraphMachines(tab, runGuard);
    await deleteMachine(machine!.id, [tab], runGuard);
    child.stdout.end(snapshotOutput);
    child.emit('close', 0);

    expect((await pending).machines).toEqual([]);
    expect(vi.mocked(gitExecutor.run).mock.calls.some(([args]) => args[0] === 'fetch')).toBe(false);
  });

  it('does not cache an old host snapshot after the host is changed', async () => {
    const [machine] = saveMachine({ name: 'omarchy', sshHost: 'old-host' });
    const child = pendingSsh();
    const pending = loadCommitGraphMachines(tab, runGuard);
    saveMachine({ id: machine!.id, name: 'omarchy', sshHost: 'new-host' });
    child.stdout.end(snapshotOutput);
    child.emit('close', 0);
    expect((await pending).machines).toEqual([]);

    const failed = pendingSsh();
    const retry = loadCommitGraphMachines(tab, runGuard);
    failed.stderr.end('connection refused');
    failed.emit('close', 1);
    expect((await retry).machines[0]).toMatchObject({ state: 'offline', machine: { sshHost: 'new-host' } });
    expect((await retry).machines[0]?.status).toBeUndefined();
  });

  it('uses platform-supported SSH options', async () => {
    saveMachine({ name: 'omarchy', sshHost: 'omarchy' });
    await loadCommitGraphMachines(tab, runGuard);
    const options = vi.mocked(spawn).mock.calls[0]?.[1];
    if (process.platform === 'win32') {
      expect(options).not.toContain('ControlMaster=auto');
      expect(options).not.toContain('ControlPersist=120');
    } else {
      expect(options).toContain('ControlPath=~/.ssh/gg-%C');
    }
  });
});

describe('remote repository paths', () => {
  it('maps native home-relative and linked worktree paths to remote POSIX paths', () => {
    const mainPath = join(homedir(), 'Data', 'Repos', 'project');
    expect(remoteRepositoryPath({ path: mainPath, commonDir: join(mainPath, '.git') })).toBe('~/Data/Repos/project');
    expect(remoteRepositoryPath({ path: join(homedir(), 'worktrees', 'project'), commonDir: join(mainPath, '.git') })).toBe('~/Data/Repos/project');
    expect(remoteRepositoryPath({ path: homedir(), commonDir: join(homedir(), '.git') })).toBe('~');
    expect(remoteRepositoryPath({ path: `${homedir()}-other`, commonDir: join(`${homedir()}-other`, '.git') })).toBe(`${homedir()}-other`);
  });
});
