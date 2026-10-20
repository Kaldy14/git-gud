import { posix, win32 } from 'node:path';

import type { GitStatusSummary, RemoteMachineBranch } from '@shared/types';

import { parseStatusPorcelainV2 } from './status';

export const MACHINE_MISSING_MARKER = '__GG_MISSING__';
export const MACHINE_REFS_MARKER = '\0__GG_REFS__\0';

export type MachineSnapshotOutput =
  | { kind: 'missing' }
  | { kind: 'repository'; status: GitStatusSummary; branches: RemoteMachineBranch[] };

/** Single-quotes a value for the remote POSIX shell. */
export function quoteRemoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** `~/'relative'` for paths under the remote home directory, quoted absolute paths otherwise. */
export function remoteShellPath(remotePath: string): string {
  if (remotePath === '~') return '~';
  if (remotePath.startsWith('~/')) return `~/${quoteRemoteShell(remotePath.slice(2))}`;
  return quoteRemoteShell(remotePath);
}

/** Git's no-index diff must never receive a path outside the remote checkout. */
export function assertMachineFilePath(path: string): void {
  if (!path || path.includes('\0') || posix.isAbsolute(path) || win32.isAbsolute(path) ||
    /^[A-Za-z]:/.test(path) || path.split(/[\\/]/).some((part) => part === '..')) {
    throw new Error('A repository-relative file path without traversal is required.');
  }
}

/**
 * One read-only round trip: porcelain status plus local branch tips. Optional
 * locks are disabled so the remote index is never refreshed or rewritten.
 */
export function machineSnapshotCommand(remotePath: string): string {
  return posixCommand([
    'export GIT_OPTIONAL_LOCKS=0',
    'command -v git >/dev/null 2>&1 || { printf "Git is not available on the remote PATH.\\n" >&2; exit 127; }',
    `[ -e ${remoteShellPath(remotePath)} ] || { printf ${MACHINE_MISSING_MARKER}; exit 0; }`,
    `cd -- ${remoteShellPath(remotePath)} || exit $?`,
    // Only an absent repository clears mirrored refs. Ownership and permission
    // errors must retain the last snapshot and reach the offline error message.
    'probe=$(LC_ALL=C git rev-parse --is-inside-work-tree 2>&1); code=$?',
    `if [ "$code" -ne 0 ]; then case "$probe" in *'fatal: not a git repository'*) printf ${MACHINE_MISSING_MARKER}; exit 0;; *) printf '%s\\n' "$probe" >&2; exit "$code";; esac; fi`,
    'git status --porcelain=v2 --branch -z --untracked-files=all || exit $?',
    "printf '\\0__GG_REFS__\\0'",
    "git for-each-ref --format='%(refname:strip=2)%00%(objectname)%00%(upstream:short)%00%(upstream:track,nobracket)' refs/heads"
  ]);
}

/** SSH invokes the login shell, which may be fish or another non-POSIX shell. */
function posixCommand(commands: string[]): string {
  return `sh -c ${quoteRemoteShell(commands.join('; '))}`;
}

export function parseMachineSnapshot(output: string): MachineSnapshotOutput {
  if (output.startsWith(MACHINE_MISSING_MARKER)) return { kind: 'missing' };

  const markerIndex = output.indexOf(MACHINE_REFS_MARKER);
  if (markerIndex < 0) throw new Error('The remote machine returned an unexpected repository snapshot.');

  const status = parseStatusPorcelainV2(output.slice(0, markerIndex));
  const branches = parseMachineBranches(output.slice(markerIndex + MACHINE_REFS_MARKER.length), status.branch.head);
  return { kind: 'repository', status, branches };
}

function parseMachineBranches(output: string, currentBranch: string | undefined): RemoteMachineBranch[] {
  const branches: RemoteMachineBranch[] = [];

  for (const line of output.split('\n')) {
    const [name, sha, upstream, track] = line.split('\0');
    if (!name || !sha || !/^[0-9a-f]{40,64}$/.test(sha)) continue;

    branches.push({
      name,
      sha,
      ...(upstream ? { upstream } : {}),
      ahead: Number(/ahead (\d+)/.exec(track ?? '')?.[1] ?? 0),
      behind: Number(/behind (\d+)/.exec(track ?? '')?.[1] ?? 0),
      current: name === currentBranch
    });
  }

  return branches.sort((left, right) => Number(right.current) - Number(left.current) || left.name.localeCompare(right.name));
}

/** Read-only diff of one remote working-tree file. */
export function machineFileDiffCommand(
  remotePath: string,
  request: { path: string; staged: boolean; untracked: boolean }
): string {
  assertMachineFilePath(request.path);
  const path = quoteRemoteShell(request.path);
  const diff = request.untracked
    ? `git diff --no-color --no-index -- /dev/null ${path}`
    // A combined merge diff has no renderable hunks in PatchDiff. Compare
    // unmerged working files with ours so conflict markers stay visible.
    : `git diff --no-color${request.staged ? ' --cached' : ' --ours'} -- ${path}`;

  return posixCommand([
    'export GIT_OPTIONAL_LOCKS=0',
    `cd -- ${remoteShellPath(remotePath)} || exit 2`,
    // --no-index exits 1 when the files differ, which is the expected case.
    `${diff}`,
    'code=$?; [ "$code" -le 1 ] && exit 0 || exit "$code"'
  ]);
}
