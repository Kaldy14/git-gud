import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';

import Store from 'electron-store';

import type {
  CommitGraphMachines,
  GraphMachine,
  RemoteMachine,
  RemoteMachineFileDiffRequest,
  RemoteMachineInput,
  RemoteMachineRepository,
  RemoteMachineTestResult,
  RepoTab
} from '@shared/types';

import { gitExecutor } from './git/exec';
import { machineFileDiffCommand, machineSnapshotCommand, machineTestCommand, machineUploadPackCommand, parseMachineSnapshot } from './git/parsers/machine';
import { createProfileCommandEnv } from './profiles';

type MachineStoreShape = { machines: RemoteMachine[] };

type MachineTab = Pick<RepoTab, 'path' | 'commonDir' | 'assignedProfileId'>;

export type RefMutationRunner = <T>(commonDir: string, operation: () => Promise<T>) => Promise<T>;

const SSH_HOST_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._@-]{0,252}$/;
const SNAPSHOT_TIMEOUT_MS = 15_000;
const FETCH_TIMEOUT_MS = 60_000;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_DIFF_BYTES = 4 * 1024 * 1024;
const SSH_OPTIONS = [
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=5',
  // BatchMode can't prompt, so trust a host key on first contact; a changed key still fails.
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'ServerAliveInterval=5',
  '-o', 'ServerAliveCountMax=2',
  // Win32 OpenSSH does not support multiplexing. Keep POSIX sockets user-owned
  // and short: macOS limits Unix socket paths to 104 bytes.
  ...(process.platform === 'win32' ? [] : [
    '-o', 'ControlMaster=auto',
    '-o', 'ControlPath=~/.ssh/gg-%C',
    '-o', 'ControlPersist=120'
  ])
] as const;

const store = new Store<MachineStoreShape>({
  name: 'git-gud-machines',
  clearInvalidConfig: true,
  ...(process.env.NODE_ENV === 'test' ? { cwd: join(tmpdir(), 'git-gud-vitest-store', 'machines') } : {}),
  defaults: { machines: [] }
});

const snapshots = new Map<string, RemoteMachineRepository>();
const inflight = new Map<string, Promise<CommitGraphMachines>>();

export function listMachines(): RemoteMachine[] {
  return normalizeMachines(store.get('machines', [])).sort((left, right) => left.name.localeCompare(right.name));
}

export function listEnabledGraphMachines(): GraphMachine[] {
  return listMachines().filter((machine) => machine.enabled).map(({ id, name }) => ({ id, name }));
}

export function saveMachine(input: RemoteMachineInput): RemoteMachine[] {
  const machines = listMachines();
  const existing = input.id ? machines.find((machine) => machine.id === input.id) : undefined;
  const name = input.name.trim();
  const sshHost = normalizeSshHost(input.sshHost);
  if (name.length === 0 || name.length > 80) throw new Error('Enter a machine name up to 80 characters.');

  const now = new Date().toISOString();
  const machine: RemoteMachine = {
    id: existing?.id ?? randomUUID(),
    name,
    sshHost,
    enabled: input.enabled ?? existing?.enabled ?? true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  store.set('machines', existing
    ? machines.map((candidate) => candidate.id === existing.id ? machine : candidate)
    : [...machines, machine]);
  if (existing && existing.sshHost !== sshHost) clearSnapshots(existing.id);
  return listMachines();
}

/** Removes the machine and its mirrored refs from every open repository. */
export async function deleteMachine(
  machineId: string,
  tabs: readonly MachineTab[],
  runDuringRefMutation: RefMutationRunner
): Promise<RemoteMachine[]> {
  // Stop in-flight polls from recreating refs, but retain a failed removal so
  // the user can retry after resolving a lock or filesystem permission error.
  store.set('machines', listMachines().map((machine) => machine.id === machineId ? { ...machine, enabled: false } : machine));
  clearSnapshots(machineId);

  const repositories = [...new Map(tabs.map((tab) => [tab.commonDir, tab])).values()];
  const failures = await Promise.all(repositories.map(async (tab) => {
    try {
      await deleteMachineRefs(tab, machineId, runDuringRefMutation);
      return undefined;
    } catch (error) {
      return `${tab.path}: ${error instanceof Error ? error.message : 'unknown error'}`;
    }
  }));
  const failureMessage = failures.filter((message) => message !== undefined).join('; ');
  if (failureMessage) throw new Error(`Could not remove mirrored refs. The machine is disabled; retry Remove after fixing: ${failureMessage}`);
  store.set('machines', listMachines().filter((machine) => machine.id !== machineId));
  return listMachines();
}

async function deleteMachineRefs(
  tab: MachineTab, machineId: string, runDuringRefMutation: RefMutationRunner, expectedMachine?: RemoteMachine
): Promise<boolean> {
  return gitExecutor.transaction(tab.commonDir, () => runDuringRefMutation(tab.commonDir, async () => {
    if (expectedMachine && !isCurrentMachine(expectedMachine)) return false;
    const refs = await gitExecutor.run(['for-each-ref', '--format=%(refname)', `refs/machines/${machineId}/`], { cwd: tab.path });
    const input = refs.stdout.split('\n').filter(Boolean).map((ref) => `delete ${ref}\n`).join('');
    if (!input) return false;
    await gitExecutor.run(['update-ref', '--stdin'], { cwd: tab.path, kind: 'mutation', input });
    return true;
  }));
}

export async function testMachine(input: Pick<RemoteMachineInput, 'sshHost'>): Promise<RemoteMachineTestResult> {
  try {
    const result = await runSsh(normalizeSshHost(input.sshHost), machineTestCommand(), { timeoutMs: SNAPSHOT_TIMEOUT_MS });
    const [version, hostname] = result.trim().split('\n');
    return { ok: true, message: `Connected to ${hostname ?? 'machine'} (${version ?? 'git'}).` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Could not connect.' };
  }
}

/**
 * Reads every enabled machine's checkout of this repository. Branch tips are
 * fetched into `refs/machines/<id>/*` locally only when they changed; the
 * remote side only ever runs read-only commands and `git-upload-pack`.
 */
export function loadCommitGraphMachines(tab: MachineTab, runDuringRefMutation: RefMutationRunner): Promise<CommitGraphMachines> {
  const running = inflight.get(tab.path);
  if (running) return running;

  const task = (async (): Promise<CommitGraphMachines> => {
    const results = await Promise.all(listMachines().filter((machine) => machine.enabled)
      .map((machine) => loadMachineRepository(tab, machine, runDuringRefMutation)));
    return {
      repoPath: tab.path,
      machines: results.map((result) => result.snapshot).filter((snapshot) =>
        listMachines().some((machine) => machine.enabled && machine.id === snapshot.machine.id && machine.sshHost === snapshot.machine.sshHost)),
      refsChanged: results.some((result) => result.refsChanged)
    };
  })().finally(() => inflight.delete(tab.path));
  inflight.set(tab.path, task);
  return task;
}

export async function loadMachineFileDiff(tab: MachineTab, request: RemoteMachineFileDiffRequest): Promise<string> {
  const machine = listMachines().find((candidate) => candidate.id === request.machineId);
  if (!machine) throw new Error('The machine no longer exists.');
  // --no-index reads arbitrary files, so only allow files Git actually listed.
  // This also prevents a renderer from walking through a directory symlink.
  if (request.untracked && !snapshots.get(snapshotKey(tab.path, machine.id))?.status?.files.some((file) =>
    file.path === request.path && file.status === 'untracked')) {
    throw new Error('The file is not untracked in the latest machine snapshot.');
  }
  return runSsh(machine.sshHost, machineFileDiffCommand(remoteRepositoryPath(tab), request), {
    timeoutMs: SNAPSHOT_TIMEOUT_MS,
    maxBytes: MAX_DIFF_BYTES,
    allowDiffExitCode: request.untracked
  });
}

/** The same checkout path on the other machine, relative to its home directory when possible. */
export function remoteRepositoryPath(tab: Pick<MachineTab, 'path' | 'commonDir'>): string {
  // Linked worktrees rarely exist on the other machine; their main checkout usually does.
  const mainPath = basename(tab.commonDir) === '.git' ? dirname(tab.commonDir) : tab.path;
  const home = homedir();
  const homeRelativePath = relative(home, mainPath);
  if (homeRelativePath === '') return '~';
  return homeRelativePath !== '..' && !homeRelativePath.startsWith(`..${sep}`) && !isAbsolute(homeRelativePath)
    ? `~/${homeRelativePath.split(sep).join('/')}` : mainPath;
}

async function loadMachineRepository(
  tab: MachineTab,
  machine: RemoteMachine,
  runDuringRefMutation: RefMutationRunner
): Promise<{ snapshot: RemoteMachineRepository; refsChanged: boolean }> {
  const key = snapshotKey(tab.path, machine.id);
  const remotePath = remoteRepositoryPath(tab);
  const identity = { id: machine.id, name: machine.name, sshHost: machine.sshHost };
  const checkedAt = new Date().toISOString();

  let output: ReturnType<typeof parseMachineSnapshot>;
  try {
    output = parseMachineSnapshot(await runSsh(machine.sshHost, machineSnapshotCommand(remotePath), {
      timeoutMs: SNAPSHOT_TIMEOUT_MS,
      maxBytes: MAX_SNAPSHOT_BYTES
    }));
  } catch (error) {
    const previous = snapshots.get(key);
    const message = error instanceof Error ? error.message : 'Could not reach the machine.';
    const snapshot: RemoteMachineRepository = previous
      ? { ...previous, machine: identity, state: 'offline', message, current: false }
      : { machine: identity, remotePath, state: 'offline', message, checkedAt, current: false, branches: [] };
    return { snapshot, refsChanged: false };
  }

  if (output.kind === 'missing') {
    snapshots.delete(key);
    let refsChanged = false;
    let message = `No Git checkout at ${remotePath}.`;
    try {
      refsChanged = await deleteMachineRefs(tab, machine.id, runDuringRefMutation, machine);
    } catch (error) {
      message += ` Local mirrored refs could not be removed: ${error instanceof Error ? error.message : 'unknown error'}`;
    }
    return {
      snapshot: { machine: identity, remotePath, state: 'missing', message, checkedAt, current: true, branches: [] },
      refsChanged
    };
  }

  const { refsChanged, message } = await syncMachineRefs(
    tab, machine, remotePath, output.branches, output.status.branch.oid, runDuringRefMutation
  );

  const snapshot: RemoteMachineRepository = {
    machine: identity,
    remotePath,
    state: 'online',
    ...(message ? { message } : {}),
    checkedAt,
    current: true,
    status: output.status,
    branches: output.branches
  };
  if (isCurrentMachine(machine)) snapshots.set(key, snapshot);
  return { snapshot, refsChanged };
}

async function syncMachineRefs(
  tab: MachineTab,
  machine: RemoteMachine,
  remotePath: string,
  branches: readonly { name: string; sha: string }[],
  headSha: string | undefined,
  runDuringRefMutation: RefMutationRunner
): Promise<{ refsChanged: boolean; message?: string }> {
  let refsChanged = false;
  try {
    const prefix = `refs/machines/${machine.id}/`;
    const expected = new Map(branches.map((branch) => [`${prefix}heads/${branch.name}`, branch.sha]));
    if (headSha && /^[0-9a-f]{40,64}$/.test(headSha)) expected.set(`${prefix}HEAD`, headSha);

    const env = createProfileCommandEnv(tab.assignedProfileId);
    // Git blocks dash-leading scp paths; ./ keeps home-relative paths literal.
    const fetchUrl = `${machine.sshHost}:${remotePath.startsWith('~/') ? `./${remotePath.slice(2)}` : remotePath === '~' ? '.' : remotePath}`;
    await gitExecutor.transaction(tab.commonDir, () => runDuringRefMutation(tab.commonDir, async () => {
      if (!isCurrentMachine(machine)) return;
      const readRefs = () => gitExecutor.run(['for-each-ref', '--format=%(refname)%00%(objectname)', prefix], { cwd: tab.path, env });
      const local = await readRefs();
      const actual = new Map(local.stdout.split('\n').filter(Boolean).map((line) => line.split('\0') as [string, string]));
      if (actual.size === expected.size && [...expected].every(([ref, sha]) => actual.get(ref) === sha)) return;

      try {
        await gitExecutor.run([
          'fetch', '--no-tags', '--prune', '--no-write-fetch-head', '--no-auto-gc', '--no-write-commit-graph', '--no-recurse-submodules',
          `--upload-pack=${machineUploadPackCommand()}`,
          fetchUrl,
          `+refs/heads/*:${prefix}heads/*`,
          ...(expected.has(`${prefix}HEAD`) ? [`+HEAD:${prefix}HEAD`] : [])
        ], {
          cwd: tab.path,
          kind: 'fetch',
          env: { ...env, GIT_SSH_COMMAND: ['ssh', ...SSH_OPTIONS].join(' '), GIT_TERMINAL_PROMPT: '0' },
          timeoutMs: FETCH_TIMEOUT_MS
        });
        // The heads wildcard cannot prune this separately fetched ref when the
        // checkout switches to an orphan branch with no first commit yet.
        const headRef = `${prefix}HEAD`;
        if (!expected.has(headRef) && actual.has(headRef)) {
          await gitExecutor.run(['update-ref', '-d', headRef], { cwd: tab.path, kind: 'mutation', env });
        }
        refsChanged = true;
      } catch (error) {
        // Fetch can fail after updating some refs. Refresh only if they changed;
        // otherwise a rejected fetch would reload history on every machine poll.
        // If refs cannot be inspected, refresh conservatively to avoid stale data.
        refsChanged = await readRefs().then((after) => after.stdout !== local.stdout, () => true);
        throw error;
      }
    }));
    return { refsChanged };
  } catch (error) {
    return {
      refsChanged,
      message: `Branch tips could not be fetched: ${error instanceof Error ? error.message : 'unknown error'}`
    };
  }
}

function isCurrentMachine(machine: RemoteMachine): boolean {
  return listMachines().some((candidate) => candidate.enabled && candidate.id === machine.id && candidate.sshHost === machine.sshHost);
}

function runSsh(host: string, command: string, options: { timeoutMs: number; maxBytes?: number; allowDiffExitCode?: boolean }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', [...SSH_OPTIONS, '-T', host, command], { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = '';
    let settled = false;
    const finish = (error: Error | undefined, value = ''): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`${host} did not respond within ${Math.round(options.timeoutMs / 1000)} seconds.`));
    }, options.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (options.maxBytes && stdoutBytes > options.maxBytes) {
        child.kill('SIGKILL');
        finish(new Error(`${host} returned more output than git-gud reads.`));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 4_096) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      const output = Buffer.concat(stdout).toString('utf8');
      // The remote command converts no-index read errors to exit 2, so an SSH
      // notice on stderr cannot hide a valid patch (exit 1).
      if (code === 0 || (options.allowDiffExitCode && code === 1 && output.length > 0)) finish(undefined, output);
      else finish(new Error(sshErrorMessage(host, stderr, code)));
    });
  });
}

function sshErrorMessage(host: string, stderr: string, code: number | null): string {
  const line = stderr.split('\n').map((candidate) => candidate.trim()).filter(Boolean).at(-1);
  return line ? `${host}: ${line}` : `${host}: ssh exited with code ${code ?? 'unknown'}.`;
}

function normalizeSshHost(value: string): string {
  const host = value.trim();
  if (!SSH_HOST_PATTERN.test(host)) throw new Error('Enter an SSH host such as omarchy or user@omarchy.tailnet.ts.net.');
  return host;
}

function normalizeMachines(value: unknown): RemoteMachine[] {
  if (!Array.isArray(value)) return [];
  return value.filter((candidate): candidate is RemoteMachine =>
    typeof candidate === 'object' && candidate !== null &&
    typeof (candidate as RemoteMachine).id === 'string' &&
    typeof (candidate as RemoteMachine).name === 'string' &&
    typeof (candidate as RemoteMachine).sshHost === 'string' &&
    SSH_HOST_PATTERN.test((candidate as RemoteMachine).sshHost)
  ).map((machine) => ({ ...machine, enabled: machine.enabled !== false }));
}

function snapshotKey(repoPath: string, machineId: string): string {
  return `${repoPath}\0${machineId}`;
}

function clearSnapshots(machineId: string): void {
  for (const key of snapshots.keys()) {
    if (key.endsWith(`\0${machineId}`)) snapshots.delete(key);
  }
}
