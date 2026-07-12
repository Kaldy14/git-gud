import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import Store from 'electron-store';

import type { GitUndoEntry } from '@shared/types';

import { GitCommandError, gitExecutor } from './exec';

type UndoStoreShape = {
  entriesByRepo: Record<string, GitUndoEntry[]>;
};

const MAX_UNDO_ENTRIES_PER_REPO = 20;
const gitUndoOperations = new Set<GitUndoEntry['operation']>([
  'commit',
  'amend',
  'branch-create',
  'branch-delete',
  'branch-rename',
  'checkout',
  'merge',
  'reset',
  'tag-create',
  'tag-delete'
]);

const undoStore = new Store<UndoStoreShape>({
  name: 'git-gud-undo',
  ...testStoreDirectory('undo'),
  clearInvalidConfig: true,
  defaults: {
    entriesByRepo: {}
  }
});

export function recordUndoEntry(entry: GitUndoEntry): GitUndoEntry {
  const entriesByRepo = readUndoEntriesByRepo();
  const entries = entriesByRepo[entry.repoPath] ?? [];
  const nextEntries = [entry, ...entries.filter((candidate) => candidate.id !== entry.id)].slice(0, MAX_UNDO_ENTRIES_PER_REPO);

  undoStore.set('entriesByRepo', {
    ...entriesByRepo,
    [entry.repoPath]: nextEntries
  });

  return entry;
}

export async function loadLatestUndoEntry(repoPath: string, env?: NodeJS.ProcessEnv): Promise<GitUndoEntry | undefined> {
  const entry = listUndoEntries(repoPath)[0];

  if (!entry) {
    return undefined;
  }

  return validateAndPersistUndoEntry(repoPath, entry, env);
}

export async function loadUndoEntry(repoPath: string, undoId: string, env?: NodeJS.ProcessEnv): Promise<GitUndoEntry | undefined> {
  const entry = listUndoEntries(repoPath).find((candidate) => candidate.id === undoId);

  if (!entry) {
    return undefined;
  }

  return validateAndPersistUndoEntry(repoPath, entry, env);
}

export function consumeUndoEntry(repoPath: string, undoId: string): void {
  const entriesByRepo = readUndoEntriesByRepo();
  const entries = entriesByRepo[repoPath] ?? [];

  undoStore.set('entriesByRepo', {
    ...entriesByRepo,
    [repoPath]: entries.filter((entry) => entry.id !== undoId)
  });
}

function listUndoEntries(repoPath: string): GitUndoEntry[] {
  const entriesByRepo = readUndoEntriesByRepo();
  return entriesByRepo[repoPath] ?? [];
}

async function validateAndPersistUndoEntry(
  repoPath: string,
  entry: GitUndoEntry,
  env: NodeJS.ProcessEnv | undefined
): Promise<GitUndoEntry> {
  const staleReason = await getUndoStaleReason(repoPath, entry, env);
  const nextEntry = { ...entry, ...(staleReason ? { staleReason } : { staleReason: undefined }) };

  if (entry.staleReason !== nextEntry.staleReason) {
    replaceUndoEntry(repoPath, nextEntry);
  }

  return nextEntry;
}

function replaceUndoEntry(repoPath: string, entry: GitUndoEntry): void {
  const entriesByRepo = readUndoEntriesByRepo();
  const entries = entriesByRepo[repoPath] ?? [];

  undoStore.set('entriesByRepo', {
    ...entriesByRepo,
    [repoPath]: entries.map((candidate) => (candidate.id === entry.id ? entry : candidate))
  });
}

async function getUndoStaleReason(
  repoPath: string,
  entry: GitUndoEntry,
  env: NodeJS.ProcessEnv | undefined
): Promise<string | undefined> {
  switch (entry.operation) {
    case 'commit':
    case 'amend':
    case 'merge':
      return (await validateCurrentHead(repoPath, entry, env)) ?? validateUnpublishedHead(repoPath, entry, env);
    case 'checkout':
      return validateCurrentHead(repoPath, entry, env);
    case 'reset': {
      const headReason = await validateCurrentHead(repoPath, entry, env);

      if (headReason || entry.resetMode !== 'hard') {
        return headReason;
      }

      return validateCleanWorktreeAndIndex(repoPath, env);
    }
    case 'branch-create':
      return validateExistingBranch(repoPath, entry, env);
    case 'branch-delete':
      return validateMissingRef(repoPath, `refs/heads/${entry.refName}`, env, 'Branch already exists again.');
    case 'branch-rename':
      return validateBranchRename(repoPath, entry, env);
    case 'tag-create':
      return validateExistingRefTarget(repoPath, entry, `refs/tags/${entry.refName}`, env, 'Tag moved or was deleted.');
    case 'tag-delete':
      return validateMissingRef(repoPath, `refs/tags/${entry.refName}`, env, 'Tag already exists again.');
  }
}

async function validateCurrentHead(
  repoPath: string,
  entry: GitUndoEntry,
  env: NodeJS.ProcessEnv | undefined
): Promise<string | undefined> {
  if (!entry.headAfter) {
    return 'Undo metadata is missing the expected HEAD.';
  }

  const currentHead = await revParse(repoPath, 'HEAD', env);

  if (currentHead !== entry.headAfter) {
    return 'Repository moved externally after this operation.';
  }

  return undefined;
}

async function validateUnpublishedHead(
  repoPath: string,
  entry: GitUndoEntry,
  env: NodeJS.ProcessEnv | undefined
): Promise<string | undefined> {
  if (!entry.headAfter) {
    return 'Undo metadata is missing the expected HEAD.';
  }

  const result = await gitExecutor.run(
    ['for-each-ref', `--contains=${entry.headAfter}`, '--format=%(refname)', 'refs/remotes'],
    {
      cwd: repoPath,
      env
    }
  );

  return result.stdout.trim()
    ? 'This operation is published to a remote-tracking branch and cannot be safely undone.'
    : undefined;
}

async function validateCleanWorktreeAndIndex(
  repoPath: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<string | undefined> {
  const result = await gitExecutor.run(['status', '--porcelain=v1', '-z', '--untracked-files=normal'], {
    cwd: repoPath,
    env
  });

  return result.stdout.length > 0
    ? 'The index or working tree changed after this hard reset. Stash or commit those changes before undoing.'
    : undefined;
}

async function validateExistingBranch(
  repoPath: string,
  entry: GitUndoEntry,
  env: NodeJS.ProcessEnv | undefined
): Promise<string | undefined> {
  if (!entry.refName || !entry.targetSha) {
    return 'Undo metadata is missing the created branch.';
  }

  return validateExistingRefTarget(repoPath, entry, `refs/heads/${entry.refName}`, env, 'Branch moved or was deleted.');
}

async function validateBranchRename(
  repoPath: string,
  entry: GitUndoEntry,
  env: NodeJS.ProcessEnv | undefined
): Promise<string | undefined> {
  if (!entry.refName || !entry.refNameAfter || !entry.targetSha) {
    return 'Undo metadata is missing the renamed branch.';
  }

  const oldBranch = await revParseOptional(repoPath, `refs/heads/${entry.refName}`, env);

  if (oldBranch) {
    return 'Original branch name already exists again.';
  }

  return validateExistingRefTarget(repoPath, entry, `refs/heads/${entry.refNameAfter}`, env, 'Renamed branch moved or was deleted.');
}

async function validateExistingRefTarget(
  repoPath: string,
  entry: GitUndoEntry,
  refName: string,
  env: NodeJS.ProcessEnv | undefined,
  staleMessage: string
): Promise<string | undefined> {
  if (!entry.targetSha) {
    return 'Undo metadata is missing the expected ref target.';
  }

  const currentTarget = await revParseOptional(repoPath, refName, env);

  if (currentTarget !== entry.targetSha) {
    return staleMessage;
  }

  return undefined;
}

async function validateMissingRef(
  repoPath: string,
  refName: string,
  env: NodeJS.ProcessEnv | undefined,
  staleMessage: string
): Promise<string | undefined> {
  const currentTarget = await revParseOptional(repoPath, refName, env);

  if (currentTarget) {
    return staleMessage;
  }

  return undefined;
}

function readUndoEntriesByRepo(): Record<string, GitUndoEntry[]> {
  const storedEntries: unknown = undoStore.get('entriesByRepo', {});
  const entriesByRepo: Record<string, GitUndoEntry[]> = Object.create(null) as Record<string, GitUndoEntry[]>;
  let repaired = false;

  if (!isRecord(storedEntries)) {
    undoStore.set('entriesByRepo', entriesByRepo);
    return entriesByRepo;
  }

  for (const [repoPath, storedBucket] of Object.entries(storedEntries)) {
    if (!isAbsolute(repoPath) || !Array.isArray(storedBucket)) {
      repaired = true;
      continue;
    }

    const validEntries = storedBucket
      .filter((entry) => isPersistedUndoEntry(entry, repoPath))
      .slice(0, MAX_UNDO_ENTRIES_PER_REPO);

    if (validEntries.length !== storedBucket.length) {
      repaired = true;
    }

    entriesByRepo[repoPath] = validEntries;
  }

  if (repaired) {
    undoStore.set('entriesByRepo', entriesByRepo);
  }

  return entriesByRepo;
}

function isPersistedUndoEntry(value: unknown, repoPath: string): value is GitUndoEntry {
  if (!isRecord(value) || !isGitUndoOperation(value.operation)) {
    return false;
  }

  if (
    !isRequiredString(value.id) ||
    value.repoPath !== repoPath ||
    !isRequiredString(value.label) ||
    !isRequiredString(value.createdAt) ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    value.requiresConfirmation !== true ||
    !isOptionalString(value.staleReason) ||
    !isOptionalSafeRefArgument(value.refName) ||
    !isOptionalSafeRefArgument(value.refNameAfter) ||
    !isOptionalSafeRefArgument(value.upstream) ||
    !isOptionalObjectId(value.targetSha) ||
    !isOptionalObjectId(value.headBefore) ||
    !isOptionalObjectId(value.headAfter) ||
    !isOptionalSafeRefArgument(value.branchBefore) ||
    !isOptionalSafeRefArgument(value.branchAfter) ||
    !isOptionalResetMode(value.resetMode) ||
    !isOptionalStringArray(value.affectedRefs) ||
    !isOptionalStringArray(value.affectedPaths) ||
    !isOptionalString(value.warning)
  ) {
    return false;
  }

  switch (value.operation) {
    case 'commit':
    case 'amend':
    case 'checkout':
    case 'merge':
      return isObjectId(value.headBefore) && isObjectId(value.headAfter);
    case 'reset':
      return (
        isObjectId(value.headBefore) &&
        isObjectId(value.headAfter) &&
        (value.resetMode === 'soft' || value.resetMode === 'mixed' || value.resetMode === 'hard')
      );
    case 'branch-create':
    case 'branch-delete':
    case 'tag-create':
    case 'tag-delete':
      return isSafeRefArgument(value.refName) && isObjectId(value.targetSha);
    case 'branch-rename':
      return (
        isSafeRefArgument(value.refName) &&
        isSafeRefArgument(value.refNameAfter) &&
        isObjectId(value.targetSha)
      );
  }
}

function isGitUndoOperation(value: unknown): value is GitUndoEntry['operation'] {
  return typeof value === 'string' && gitUndoOperations.has(value as GitUndoEntry['operation']);
}

function isRequiredString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0');
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every((entry) => typeof entry === 'string'));
}

function isObjectId(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value);
}

function isOptionalObjectId(value: unknown): value is string | undefined {
  return value === undefined || isObjectId(value);
}

function isSafeRefArgument(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('-') && !/[\0\r\n]/.test(value);
}

function isOptionalSafeRefArgument(value: unknown): value is string | undefined {
  return value === undefined || isSafeRefArgument(value);
}

function isOptionalResetMode(value: unknown): value is GitUndoEntry['resetMode'] {
  return value === undefined || value === 'soft' || value === 'mixed' || value === 'hard';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function revParse(repoPath: string, rev: string, env: NodeJS.ProcessEnv | undefined): Promise<string | undefined> {
  const result = await gitExecutor.run(['rev-parse', '--verify', rev], { cwd: repoPath, env });
  return result.stdout.trim() || undefined;
}

async function revParseOptional(repoPath: string, rev: string, env: NodeJS.ProcessEnv | undefined): Promise<string | undefined> {
  try {
    return await revParse(repoPath, rev, env);
  } catch (error) {
    if (error instanceof GitCommandError) {
      return undefined;
    }

    throw error;
  }
}

function testStoreDirectory(name: string): { cwd: string } | Record<string, never> {
  if (process.env.NODE_ENV !== 'test') {
    return {};
  }

  return {
    cwd: join(tmpdir(), 'git-gud-vitest-store', name)
  };
}
