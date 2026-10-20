import { posix, win32 } from 'node:path';

import type { GitStatusSummary, RemoteMachineBranch, RemoteMachineFileDiffRequest } from '@shared/types';

import { parseStatusPorcelainV2 } from './status';

export const MACHINE_MISSING_MARKER = '__GG_MISSING__';
// Porcelain -z records (including rename paths) are nonempty. An extra NUL
// therefore separates sections without reserving any valid filename.
export const MACHINE_REFS_MARKER = '\0\0';

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
    // Tracking text is parsed below, so every Git process needs a stable locale.
    'export GIT_OPTIONAL_LOCKS=0 LC_ALL=C',
    'command -v git >/dev/null 2>&1 || { printf "Git is not available on the remote PATH.\\n" >&2; exit 127; }',
    // Only an absent repository clears mirrored refs. Ownership and permission
    // errors must retain the last snapshot and reach the offline error message.
    `probe=$(git -C ${remoteShellPath(remotePath)} rev-parse --is-inside-work-tree --show-prefix 2>&1); code=$?`,
    `if [ "$code" -ne 0 ]; then case "$probe" in 'fatal: cannot change to '*': No such file or directory'|'fatal: cannot change to '*': Not a directory') printf ${MACHINE_MISSING_MARKER}; exit 0;; 'fatal: not a git repository'*) if [ ! -e ${remoteShellPath(`${remotePath}/.git`)} ] && [ ! -L ${remoteShellPath(`${remotePath}/.git`)} ]; then printf ${MACHINE_MISSING_MARKER}; exit 0; fi;; esac; printf '%s\\n' "$probe" >&2; exit "$code"; fi`,
    // At a checkout root the prefix is empty; an enclosing repo adds a prefix.
    `[ "$probe" = true ] || { printf ${MACHINE_MISSING_MARKER}; exit 0; }`,
    `cd -- ${remoteShellPath(remotePath)} || exit $?`,
    readOnlyGitFunction(),
    assertUnfilteredCommand('read_only_git ls-files -z'),
    // Submodule-local helpers are not covered by the superproject's config.
    // Inspect gitlink commits only, without entering submodule worktrees.
    'read_only_git status --ignore-submodules=dirty --porcelain=v2 --branch -z --untracked-files=all || exit $?',
    "printf '\\0'",
    "git for-each-ref --format='%(refname:strip=2)%00%(objectname)%00%(upstream:short)%00%(upstream:track,nobracket)' refs/heads"
  ]);
}

/** SSH invokes the login shell, which may be fish or another non-POSIX shell. */
function posixCommand(commands: string[]): string {
  return `sh -c ${quoteRemoteShell(commands.join('; '))}`;
}

/** Inspect raw worktree bytes; clean/process conversion may execute arbitrary helpers. */
function readOnlyGitFunction(): string {
  // Keep the SSH command on one line for login shells such as csh. Disable glob
  // expansion and split only on newlines so spaces in config keys stay literal.
  return `read_only_git() { ${[
    "filter_keys=$(git config --name-only --get-regexp '^filter\\..*\\.(clean|process|required)$')",
    'code=$?',
    '[ "$code" -le 1 ] || return "$code"',
    'saved_ifs=$IFS',
    "IFS=$(printf '\\n_')",
    'IFS=${IFS%_}',
    'set -f',
    'for key in $filter_keys; do case "$key" in *.required) set -- -c "$key=false" "$@";; *) set -- -c "$key=" "$@";; esac; done',
    'IFS=$saved_ifs',
    'git -c core.fsmonitor=false "$@"'
  ].join('; ')}; }`;
}

function assertUnfilteredCommand(pathsCommand: string): string {
  // --all omits absent attributes, avoiding ambiguity with a driver literally
  // named "unspecified". Pass literal NUL-delimited paths through xargs; Git's
  // text output quotes control characters, so each attribute occupies one line.
  const check = '[ "$#" -eq 0 ] || git -c core.fsmonitor=false check-attr --all -- "$@"';
  return [
    `attributes=$(${pathsCommand} | xargs -0 sh -c ${quoteRemoteShell(check)} sh) || exit $?`,
    `if printf '%s\\n' "$attributes" | LC_ALL=C grep -Eq ': filter: [^[:space:]]*$'; then printf 'Read-only inspection is unavailable for Git content filters.\\n' >&2; exit 2; fi`
  ].join('; ');
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
  request: Omit<RemoteMachineFileDiffRequest, 'machineId'>
): string {
  assertMachineFilePath(request.path);
  if (request.originalPath !== undefined) assertMachineFilePath(request.originalPath);
  const path = quoteRemoteShell(request.path);
  const paths = !request.untracked && request.originalPath && request.originalPath !== request.path
    ? `${quoteRemoteShell(request.originalPath)} ${path}` : path;
  const diff = request.untracked
    ? `read_only_git diff --no-color --no-ext-diff --no-textconv --no-index -- /dev/null ${path}`
    // A combined merge diff has no renderable hunks in PatchDiff. Compare
    // unmerged working files with ours so conflict markers stay visible.
    // Shell quoting does not stop Git from interpreting a filename as a pattern.
    : `read_only_git --literal-pathspecs diff --no-color --no-ext-diff --no-textconv --submodule=short --ignore-submodules=dirty --find-renames --find-copies${request.originalPath ? ' --find-copies-harder' : ''}${request.staged ? ' --cached' : ' --ours'} -- ${paths}`;

  return posixCommand([
    'export GIT_OPTIONAL_LOCKS=0',
    `cd -- ${remoteShellPath(remotePath)} || exit 2`,
    readOnlyGitFunction(),
    assertUnfilteredCommand(`printf '%s\\0' ${paths}`),
    // SSH notices share stderr with Git. Mark a no-index read error as exit 2
    // remotely, while streaming the patch through fd 3 without buffering it.
    request.untracked
      ? `{ diff_error=$(${diff} 2>&1 1>&3); diff_code=$?; if [ -n "$diff_error" ]; then printf '%s\\n' "$diff_error" >&2; [ "$diff_code" -ne 1 ] || diff_code=2; fi; exit "$diff_code"; } 3>&1`
      : diff
  ]);
}
