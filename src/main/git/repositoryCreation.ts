import { lstat, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';

import type { RepositoryCloneInput, RepositoryInitializeInput } from '@shared/ipc';
import type { RepositorySummary } from '@shared/types';

import { gitExecutor } from './exec';
import { validateRepository } from './repoInspector';

export async function initializeRepository(input: RepositoryInitializeInput): Promise<RepositorySummary> {
  const parentDirectory = await validateParentDirectory(input.parentDirectory);
  const name = validateDestinationName(input.name, 'name');
  await validateBranchName(parentDirectory, input.defaultBranch);

  const destination = join(parentDirectory, name);
  await assertDestinationDoesNotExist(destination);
  await gitExecutor.run(['init', `--initial-branch=${input.defaultBranch}`, '--', destination], {
    cwd: parentDirectory,
    kind: 'mutation'
  });

  return validateRepository(destination);
}

export async function cloneRepository(input: RepositoryCloneInput): Promise<RepositorySummary> {
  const parentDirectory = await validateParentDirectory(input.parentDirectory);
  const sourceUrl = validateSourceUrl(input.sourceUrl);
  const directoryName = validateDestinationName(
    input.directoryName ?? inferCloneDirectoryName(sourceUrl),
    'directoryName'
  );
  const destination = join(parentDirectory, directoryName);

  await assertDestinationDoesNotExist(destination);
  await gitExecutor.run(['clone', '--', sourceUrl, destination], {
    cwd: parentDirectory,
    kind: 'mutation'
  });

  return validateRepository(destination);
}

async function validateParentDirectory(parentDirectory: string): Promise<string> {
  if (!isAbsolute(parentDirectory)) {
    throw new Error('parentDirectory must be an absolute path.');
  }

  const normalizedParent = resolve(parentDirectory);
  let parentStat;

  try {
    parentStat = await stat(normalizedParent);
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new Error('parentDirectory must be an existing directory.', { cause: error });
    }

    throw error;
  }

  if (!parentStat.isDirectory()) {
    throw new Error('parentDirectory must be an existing directory.');
  }

  return normalizedParent;
}

function validateDestinationName(value: string, label: string): string {
  if (
    value.length === 0 ||
    value !== value.trim() ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('\0') ||
    isAbsolute(value)
  ) {
    throw new Error(`${label} must be a single safe directory name.`);
  }

  return value;
}

function validateSourceUrl(sourceUrl: string): string {
  if (sourceUrl.length === 0 || sourceUrl !== sourceUrl.trim() || sourceUrl.includes('\0')) {
    throw new Error('sourceUrl must not be empty or contain unsafe characters.');
  }

  return sourceUrl;
}

function inferCloneDirectoryName(sourceUrl: string): string {
  const withoutTrailingSeparators = sourceUrl.replace(/[\\/]+$/u, '');
  let inferredName: string;

  try {
    const parsedUrl = new URL(withoutTrailingSeparators);
    inferredName = basename(parsedUrl.pathname);
  } catch {
    inferredName = basename(withoutTrailingSeparators);
  }

  return inferredName.endsWith('.git') ? inferredName.slice(0, -4) : inferredName;
}

async function validateBranchName(cwd: string, branchName: string): Promise<void> {
  if (branchName.length === 0 || branchName !== branchName.trim() || branchName.includes('\0')) {
    throw new Error('defaultBranch must be a valid Git branch name.');
  }

  const result = await gitExecutor.run(['check-ref-format', '--branch', branchName], {
    cwd,
    allowedExitCodes: [0, 1, 128]
  });

  if (result.exitCode !== 0) {
    throw new Error('defaultBranch must be a valid Git branch name.');
  }
}

async function assertDestinationDoesNotExist(destination: string): Promise<void> {
  try {
    await lstat(destination);
  } catch (error) {
    if (isMissingPathError(error)) {
      return;
    }

    throw error;
  }

  throw new Error(`The destination directory already exists: ${destination}`);
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
