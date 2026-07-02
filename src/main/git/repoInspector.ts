import { spawn } from 'node:child_process';
import { basename, isAbsolute, resolve } from 'node:path';

import type { RepositorySummary } from '@shared/types';

type GitOutput = {
  stdout: string;
  stderr: string;
};

export class RepositoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepositoryValidationError';
  }
}

export async function validateRepository(repoPath: string): Promise<RepositorySummary> {
  const selectedPath = resolve(repoPath);
  const topLevel = trimGitOutput((await runGit(['rev-parse', '--show-toplevel'], selectedPath)).stdout);
  const insideWorkTree = trimGitOutput((await runGit(['rev-parse', '--is-inside-work-tree'], topLevel)).stdout);
  const isBare = trimGitOutput((await runGit(['rev-parse', '--is-bare-repository'], topLevel)).stdout);

  if (insideWorkTree !== 'true' || isBare === 'true') {
    throw new RepositoryValidationError('Bare repositories are not supported in this first build.');
  }

  const gitDir = trimGitOutput((await runGit(['rev-parse', '--git-dir'], topLevel)).stdout);
  const commonDir = trimGitOutput((await runGit(['rev-parse', '--git-common-dir'], topLevel)).stdout);

  return {
    path: topLevel,
    name: basename(topLevel),
    gitDir: resolveGitPath(topLevel, gitDir),
    commonDir: resolveGitPath(topLevel, commonDir)
  };
}

function runGit(args: string[], cwd: string): Promise<GitOutput> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn('git', args, {
      cwd,
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: '0'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolveOutput({ stdout, stderr });
        return;
      }

      reject(new RepositoryValidationError(stderr.trim() || `git ${args.join(' ')} failed with exit code ${exitCode}`));
    });
  });
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
