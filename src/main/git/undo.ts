import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Store from 'electron-store';

import type { GitUndoEntry } from '@shared/types';

import { GitCommandError, gitExecutor } from './exec';

type UndoStoreShape = {
  entriesByRepo: Record<string, GitUndoEntry[]>;
};

const MAX_UNDO_ENTRIES_PER_REPO = 20;

const undoStore = new Store<UndoStoreShape>({
  name: 'git-gud-undo',
  ...testStoreDirectory('undo'),
  defaults: {
    entriesByRepo: {}
  }
});

export function recordUndoEntry(entry: GitUndoEntry): GitUndoEntry {
  const entriesByRepo = undoStore.get('entriesByRepo', {});
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

  return validateAndPersistUndoEntry(entry, env);
}

export async function loadUndoEntry(repoPath: string, undoId: string, env?: NodeJS.ProcessEnv): Promise<GitUndoEntry | undefined> {
  const entry = listUndoEntries(repoPath).find((candidate) => candidate.id === undoId);

  if (!entry) {
    return undefined;
  }

  return validateAndPersistUndoEntry(entry, env);
}

export function consumeUndoEntry(repoPath: string, undoId: string): void {
  const entriesByRepo = undoStore.get('entriesByRepo', {});
  const entries = entriesByRepo[repoPath] ?? [];

  undoStore.set('entriesByRepo', {
    ...entriesByRepo,
    [repoPath]: entries.filter((entry) => entry.id !== undoId)
  });
}

function listUndoEntries(repoPath: string): GitUndoEntry[] {
  const entriesByRepo = undoStore.get('entriesByRepo', {});
  return entriesByRepo[repoPath] ?? [];
}

async function validateAndPersistUndoEntry(entry: GitUndoEntry, env: NodeJS.ProcessEnv | undefined): Promise<GitUndoEntry> {
  const staleReason = await getUndoStaleReason(entry, env);
  const nextEntry = { ...entry, ...(staleReason ? { staleReason } : { staleReason: undefined }) };

  if (entry.staleReason !== nextEntry.staleReason) {
    replaceUndoEntry(nextEntry);
  }

  return nextEntry;
}

function replaceUndoEntry(entry: GitUndoEntry): void {
  const entriesByRepo = undoStore.get('entriesByRepo', {});
  const entries = entriesByRepo[entry.repoPath] ?? [];

  undoStore.set('entriesByRepo', {
    ...entriesByRepo,
    [entry.repoPath]: entries.map((candidate) => (candidate.id === entry.id ? entry : candidate))
  });
}

async function getUndoStaleReason(entry: GitUndoEntry, env: NodeJS.ProcessEnv | undefined): Promise<string | undefined> {
  switch (entry.operation) {
    case 'commit':
    case 'amend':
    case 'checkout':
    case 'merge':
    case 'reset':
      return validateCurrentHead(entry, env);
    case 'branch-create':
      return validateExistingBranch(entry, env);
    case 'branch-delete':
      return validateMissingRef(entry, `refs/heads/${entry.refName}`, env, 'Branch already exists again.');
    case 'branch-rename':
      return validateBranchRename(entry, env);
    case 'tag-create':
      return validateExistingRefTarget(entry, `refs/tags/${entry.refName}`, env, 'Tag moved or was deleted.');
    case 'tag-delete':
      return validateMissingRef(entry, `refs/tags/${entry.refName}`, env, 'Tag already exists again.');
  }
}

async function validateCurrentHead(entry: GitUndoEntry, env: NodeJS.ProcessEnv | undefined): Promise<string | undefined> {
  if (!entry.headAfter) {
    return 'Undo metadata is missing the expected HEAD.';
  }

  const currentHead = await revParse(entry.repoPath, 'HEAD', env);

  if (currentHead !== entry.headAfter) {
    return 'Repository moved externally after this operation.';
  }

  return undefined;
}

async function validateExistingBranch(entry: GitUndoEntry, env: NodeJS.ProcessEnv | undefined): Promise<string | undefined> {
  if (!entry.refName || !entry.targetSha) {
    return 'Undo metadata is missing the created branch.';
  }

  return validateExistingRefTarget(entry, `refs/heads/${entry.refName}`, env, 'Branch moved or was deleted.');
}

async function validateBranchRename(entry: GitUndoEntry, env: NodeJS.ProcessEnv | undefined): Promise<string | undefined> {
  if (!entry.refName || !entry.refNameAfter || !entry.targetSha) {
    return 'Undo metadata is missing the renamed branch.';
  }

  const oldBranch = await revParseOptional(entry.repoPath, `refs/heads/${entry.refName}`, env);

  if (oldBranch) {
    return 'Original branch name already exists again.';
  }

  return validateExistingRefTarget(entry, `refs/heads/${entry.refNameAfter}`, env, 'Renamed branch moved or was deleted.');
}

async function validateExistingRefTarget(
  entry: GitUndoEntry,
  refName: string,
  env: NodeJS.ProcessEnv | undefined,
  staleMessage: string
): Promise<string | undefined> {
  if (!entry.targetSha) {
    return 'Undo metadata is missing the expected ref target.';
  }

  const currentTarget = await revParseOptional(entry.repoPath, refName, env);

  if (currentTarget !== entry.targetSha) {
    return staleMessage;
  }

  return undefined;
}

async function validateMissingRef(
  entry: GitUndoEntry,
  refName: string,
  env: NodeJS.ProcessEnv | undefined,
  staleMessage: string
): Promise<string | undefined> {
  const currentTarget = await revParseOptional(entry.repoPath, refName, env);

  if (currentTarget) {
    return staleMessage;
  }

  return undefined;
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
