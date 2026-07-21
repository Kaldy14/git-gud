import { access, lstat, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import pathModule, { resolve } from 'node:path';

import type {
  GitConflictFile,
  GitConflictFileKind,
  GitConflictFileResolutionInput,
  GitConflictFileVersion,
  GitConflictOperation,
  GitConflictState,
  GitFileChange,
  GitFileChangeDetail,
  GitOperationResult,
  GitQueryInvalidation,
  GitStatusSummary,
  RepoTab
} from '@shared/types';

import { createProfileCommandEnv } from '../profiles';
import { gitExecutor } from './exec';
import { parseStatusPorcelainV2 } from './parsers/status';

const CONFLICT_GIT_PATHS = ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'] as const;
const MAX_CONFLICT_FILE_BYTES = 8 * 1024 * 1024;
const CONFLICT_FILE_INVALIDATIONS: readonly GitQueryInvalidation[] = [
  'overview',
  'graph',
  'wip-detail',
  'file-diff',
  'conflict-file',
  'review-plan'
];

type ConflictTab = Pick<RepoTab, 'path' | 'assignedProfileId'>;

type UnmergedEntry = {
  stage: 1 | 2 | 3;
  oid: string;
  mode: string;
};

export async function loadConflictState(
  repoPath: string,
  env?: NodeJS.ProcessEnv,
  status?: GitStatusSummary
): Promise<GitConflictState> {
  const resolvedStatus = status ?? (await loadConflictStatus(repoPath, env));
  const [rebaseMerge, rebaseApply, mergeHead, cherryPickHead, revertHead] = await loadGitPathPresence(
    repoPath,
    env
  );
  const operation = selectConflictOperation({
    rebaseMerge,
    rebaseApply,
    mergeHead,
    cherryPickHead,
    revertHead
  });
  const files = resolvedStatus.files.filter((file) => file.conflicted).map(conflictedFileToDetail);
  const isActive = Boolean(operation) || files.length > 0;

  return {
    isActive,
    ...(operation ? { operation } : {}),
    files,
    canContinue: Boolean(operation),
    canSkip: operation === 'rebase' || operation === 'cherry-pick' || operation === 'revert',
    canAbort: Boolean(operation),
    ...(isActive ? { message: createConflictMessage(operation, files.length) } : {})
  };
}

export async function loadConflictFile(tab: ConflictTab, path: string): Promise<GitConflictFile> {
  assertSafeRelativePath(path);
  const env = withLiteralPathspecs(createProfileCommandEnv(tab.assignedProfileId));
  const conflictState = await loadConflictState(tab.path, env);

  if (!conflictState.files.some((file) => file.path === path)) {
    throw new Error(`${path} is not currently conflicted.`);
  }

  const entries = await loadUnmergedEntries(tab.path, path, env);
  const [baseResult, oursResult, theirsResult, result, labels] = await Promise.all([
    loadConflictVersion(tab.path, entries.get(1), env),
    loadConflictVersion(tab.path, entries.get(2), env),
    loadConflictVersion(tab.path, entries.get(3), env),
    loadWorktreeResult(tab.path, path),
    loadConflictLabels(tab.path, conflictState.operation, env)
  ]);
  const versions = [baseResult.version, oursResult.version, theirsResult.version].filter(
    (version): version is GitConflictFileVersion => Boolean(version)
  );
  const omittedReason = selectOmittedReason(
    baseResult.omittedReason,
    oursResult.omittedReason,
    theirsResult.omittedReason,
    result.omittedReason
  );
  const isBinary = omittedReason === 'binary' || versions.some((version) => version.content?.includes('\0'));

  return {
    repoPath: tab.path,
    path,
    operation: conflictState.operation,
    kind: classifyConflict(entries),
    oursLabel: labels.ours,
    theirsLabel: labels.theirs,
    base: baseResult.version,
    ours: oursResult.version,
    theirs: theirsResult.version,
    result: result.content,
    isBinary,
    ...(omittedReason || isBinary ? { omittedReason: omittedReason ?? 'binary' } : {}),
    loadedAt: new Date().toISOString()
  };
}

export async function resolveConflictFile(
  tab: ConflictTab,
  input: GitConflictFileResolutionInput
): Promise<GitOperationResult> {
  assertSafeRelativePath(input.path);
  const env = withLiteralPathspecs(createProfileCommandEnv(tab.assignedProfileId));
  const conflictState = await loadConflictState(tab.path, env);

  if (!conflictState.files.some((file) => file.path === input.path)) {
    throw new Error(`${input.path} is not currently conflicted.`);
  }

  if (input.resolution === 'content') {
    if (input.content === undefined) {
      throw new Error('Resolved file content is required.');
    }

    if (Buffer.byteLength(input.content) > MAX_CONFLICT_FILE_BYTES) {
      throw new Error('Resolved file content exceeds the 8 MiB limit.');
    }

    await writeConflictResult(tab.path, input.path, input.content);
    await gitExecutor.run(['add', '--', input.path], { cwd: tab.path, kind: 'mutation', env });
  } else if (input.resolution === 'delete') {
    await gitExecutor.run(['rm', '-f', '--ignore-unmatch', '--', input.path], {
      cwd: tab.path,
      kind: 'mutation',
      env
    });
  } else {
    const entries = await loadUnmergedEntries(tab.path, input.path, env);
    const stage = input.resolution === 'ours' ? 2 : 3;

    if (!entries.has(stage)) {
      await gitExecutor.run(['rm', '-f', '--ignore-unmatch', '--', input.path], {
        cwd: tab.path,
        kind: 'mutation',
        env
      });
    } else {
      await gitExecutor.run(['checkout', `--${input.resolution}`, '--', input.path], {
        cwd: tab.path,
        kind: 'mutation',
        env
      });
      await gitExecutor.run(['add', '--', input.path], { cwd: tab.path, kind: 'mutation', env });
    }
  }

  return {
    repoPath: tab.path,
    happenedAt: new Date().toISOString(),
    conflictState: await loadConflictState(tab.path, env),
    invalidates: [...CONFLICT_FILE_INVALIDATIONS]
  };
}

async function loadUnmergedEntries(
  repoPath: string,
  path: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<Map<1 | 2 | 3, UnmergedEntry>> {
  const result = await gitExecutor.run(['ls-files', '-u', '-z', '--', path], { cwd: repoPath, env });
  const entries = new Map<1 | 2 | 3, UnmergedEntry>();

  for (const record of result.stdout.split('\0')) {
    const match = /^(\d+) ([0-9a-f]+) ([123])\t/.exec(record);

    if (!match?.[1] || !match[2] || !match[3]) {
      continue;
    }

    const stage = Number(match[3]) as 1 | 2 | 3;
    entries.set(stage, { mode: match[1], oid: match[2], stage });
  }

  return entries;
}

async function loadConflictVersion(
  repoPath: string,
  entry: UnmergedEntry | undefined,
  env: NodeJS.ProcessEnv | undefined
): Promise<{ version?: GitConflictFileVersion; omittedReason?: GitConflictFile['omittedReason'] }> {
  if (!entry) {
    return {};
  }

  const version: GitConflictFileVersion = {
    oid: entry.oid,
    shortOid: entry.oid.slice(0, 8),
    mode: entry.mode
  };

  if (!isRegularFileMode(entry.mode)) {
    return { version, omittedReason: 'unsupported-type' };
  }

  const sizeResult = await gitExecutor.run(['cat-file', '-s', entry.oid], { cwd: repoPath, env });
  const size = Number(sizeResult.stdout.trim());

  if (!Number.isFinite(size) || size > MAX_CONFLICT_FILE_BYTES) {
    return { version, omittedReason: 'too-large' };
  }

  const content = (await gitExecutor.run(['cat-file', '-p', entry.oid], {
    cwd: repoPath,
    env,
    maxStdoutBytes: MAX_CONFLICT_FILE_BYTES
  })).stdout;

  return {
    version: { ...version, content },
    ...(content.includes('\0') ? { omittedReason: 'binary' as const } : {})
  };
}

async function loadWorktreeResult(
  repoPath: string,
  relativePath: string
): Promise<{ content?: string; omittedReason?: GitConflictFile['omittedReason'] }> {
  const filePath = pathModule.join(repoPath, relativePath);

  try {
    const fileStats = await stat(filePath);

    if (!fileStats.isFile()) {
      return { omittedReason: 'unsupported-type' };
    }

    if (fileStats.size > MAX_CONFLICT_FILE_BYTES) {
      return { omittedReason: 'too-large' };
    }

    const content = await readFile(filePath, 'utf8');
    return {
      content,
      ...(content.includes('\0') ? { omittedReason: 'binary' as const } : {})
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }

    throw error;
  }
}

async function loadConflictLabels(
  repoPath: string,
  operation: GitConflictOperation | undefined,
  env: NodeJS.ProcessEnv | undefined
): Promise<{ ours: string; theirs: string }> {
  const currentBranchResult = await gitExecutor.run(['symbolic-ref', '--quiet', '--short', 'HEAD'], {
    cwd: repoPath,
    env,
    allowedExitCodes: [0, 1]
  });
  const ours = currentBranchResult.stdout.trim() || (operation === 'rebase' ? 'Rebase target' : 'Current branch');
  const incomingRef = operationRef(operation);

  if (!incomingRef) {
    return { ours, theirs: 'Incoming change' };
  }

  const nameResult = await gitExecutor.run(
    ['name-rev', '--name-only', '--exclude=tags/*', '--refs=refs/heads/*', incomingRef],
    { cwd: repoPath, env, allowedExitCodes: [0, 1, 128] }
  );
  const name = nameResult.stdout.trim();

  if (name && name !== 'undefined') {
    return { ours, theirs: name };
  }

  const shortResult = await gitExecutor.run(['rev-parse', '--short', incomingRef], {
    cwd: repoPath,
    env,
    allowedExitCodes: [0, 1, 128]
  });
  return { ours, theirs: shortResult.stdout.trim() || incomingLabel(operation) };
}

function operationRef(operation: GitConflictOperation | undefined): string | undefined {
  if (operation === 'merge') return 'MERGE_HEAD';
  if (operation === 'cherry-pick') return 'CHERRY_PICK_HEAD';
  if (operation === 'revert') return 'REVERT_HEAD';
  if (operation === 'rebase') return 'REBASE_HEAD';
  return undefined;
}

function incomingLabel(operation: GitConflictOperation | undefined): string {
  if (operation === 'rebase') return 'Replayed commit';
  if (operation === 'cherry-pick') return 'Cherry-picked commit';
  if (operation === 'revert') return 'Reverted commit';
  return 'Incoming change';
}

function classifyConflict(entries: Map<1 | 2 | 3, UnmergedEntry>): GitConflictFileKind {
  const hasBase = entries.has(1);
  const hasOurs = entries.has(2);
  const hasTheirs = entries.has(3);

  if (hasBase && hasOurs && hasTheirs) return 'both-modified';
  if (!hasBase && hasOurs && hasTheirs) return 'both-added';
  if (hasBase && !hasOurs && hasTheirs) return 'deleted-by-us';
  if (hasBase && hasOurs && !hasTheirs) return 'deleted-by-them';
  return 'other';
}

function selectOmittedReason(
  ...reasons: Array<GitConflictFile['omittedReason'] | undefined>
): GitConflictFile['omittedReason'] | undefined {
  if (reasons.includes('unsupported-type')) return 'unsupported-type';
  if (reasons.includes('too-large')) return 'too-large';
  if (reasons.includes('binary')) return 'binary';
  return undefined;
}

function isRegularFileMode(mode: string): boolean {
  return mode === '100644' || mode === '100755';
}

async function writeConflictResult(repoPath: string, relativePath: string, content: string): Promise<void> {
  const filePath = pathModule.join(repoPath, relativePath);
  const parentPath = pathModule.dirname(filePath);
  await assertNotSymlink(filePath);
  await mkdir(parentPath, { recursive: true });
  await writeFile(filePath, content, 'utf8');
}

async function assertNotSymlink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new Error('Conflict output cannot overwrite a symbolic link. Choose ours or theirs instead.');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

function assertSafeRelativePath(path: string): void {
  const normalizedPath = pathModule.normalize(path);

  if (!path || pathModule.isAbsolute(path) || normalizedPath === '..' || normalizedPath.startsWith(`..${pathModule.sep}`)) {
    throw new Error('A repository-relative file path is required.');
  }
}

function withLiteralPathspecs(env: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  return { ...env, GIT_LITERAL_PATHSPECS: '1' };
}

async function loadConflictStatus(repoPath: string, env: NodeJS.ProcessEnv | undefined): Promise<GitStatusSummary> {
  const result = await gitExecutor.run(['status', '--porcelain=v2', '--branch', '--untracked-files=no', '-z'], {
    cwd: repoPath,
    env
  });
  return parseStatusPorcelainV2(result.stdout);
}

function selectConflictOperation(paths: {
  rebaseMerge: boolean;
  rebaseApply: boolean;
  mergeHead: boolean;
  cherryPickHead: boolean;
  revertHead: boolean;
}): GitConflictOperation | undefined {
  if (paths.rebaseMerge || paths.rebaseApply) {
    return 'rebase';
  }

  if (paths.mergeHead) {
    return 'merge';
  }

  if (paths.cherryPickHead) {
    return 'cherry-pick';
  }

  if (paths.revertHead) {
    return 'revert';
  }

  return undefined;
}

async function loadGitPathPresence(repoPath: string, env: NodeJS.ProcessEnv | undefined): Promise<boolean[]> {
  const result = await gitExecutor.run(
    ['rev-parse', ...CONFLICT_GIT_PATHS.flatMap((pathName) => ['--git-path', pathName])],
    { cwd: repoPath, env }
  );
  const gitPaths = result.stdout.trimEnd().split('\n');

  return Promise.all(
    CONFLICT_GIT_PATHS.map(async (_pathName, index) => {
      const gitPath = gitPaths[index];

      if (!gitPath) {
        return false;
      }

      try {
        await access(resolve(repoPath, gitPath));
        return true;
      } catch {
        return false;
      }
    })
  );
}

function conflictedFileToDetail(file: GitFileChange): GitFileChangeDetail {
  return {
    path: file.path,
    originalPath: file.originalPath,
    status: file.status,
    staged: file.staged,
    unstaged: file.unstaged,
    conflicted: file.conflicted
  };
}

function createConflictMessage(operation: GitConflictOperation | undefined, conflictedFileCount: number): string {
  const operationLabel = operation ? operation.replace('-', ' ') : 'Git operation';

  if (conflictedFileCount === 0) {
    return `${operationLabel} is waiting for you to continue, skip, or abort.`;
  }

  return `${operationLabel} has ${conflictedFileCount} conflicted file${conflictedFileCount === 1 ? '' : 's'}.`;
}
