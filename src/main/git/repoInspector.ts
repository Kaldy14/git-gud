import { basename, isAbsolute, resolve } from 'node:path';

import type { RepositorySummary } from '@shared/types';

import { GitCommandError, gitExecutor } from './exec';

export class RepositoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepositoryValidationError';
  }
}

export async function validateRepository(repoPath: string): Promise<RepositorySummary> {
  try {
    const selectedPath = resolve(repoPath);
    const topLevel = trimGitOutput((await gitExecutor.run(['rev-parse', '--show-toplevel'], { cwd: selectedPath })).stdout);
    const insideWorkTree = trimGitOutput((await gitExecutor.run(['rev-parse', '--is-inside-work-tree'], { cwd: topLevel })).stdout);
    const isBare = trimGitOutput((await gitExecutor.run(['rev-parse', '--is-bare-repository'], { cwd: topLevel })).stdout);

    if (insideWorkTree !== 'true' || isBare === 'true') {
      throw new RepositoryValidationError('Bare repositories are not supported in this first build.');
    }

    const gitDir = trimGitOutput((await gitExecutor.run(['rev-parse', '--git-dir'], { cwd: topLevel })).stdout);
    const commonDir = trimGitOutput((await gitExecutor.run(['rev-parse', '--git-common-dir'], { cwd: topLevel })).stdout);

    return {
      path: topLevel,
      name: basename(topLevel),
      gitDir: resolveGitPath(topLevel, gitDir),
      commonDir: resolveGitPath(topLevel, commonDir)
    };
  } catch (error) {
    if (error instanceof RepositoryValidationError) {
      throw error;
    }

    if (error instanceof GitCommandError) {
      throw new RepositoryValidationError(error.message);
    }

    throw error;
  }
}

function trimGitOutput(value: string): string {
  return value.replaceAll('\0', '').trim();
}

function resolveGitPath(repoRoot: string, gitPath: string): string {
  if (isAbsolute(gitPath)) {
    return gitPath;
  }

  return resolve(repoRoot, gitPath);
}
