import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

import type { GitOperationResult, RepoTab } from '@shared/types';

type FileTab = Pick<RepoTab, 'path'>;

export async function openRepositoryFileInEditor(tab: FileTab, relativePath: string): Promise<GitOperationResult> {
  const targetPath = resolveRepositoryChildPath(tab.path, relativePath);
  await access(targetPath);
  await openMacTarget(['-t', targetPath]);

  return createSystemOperationResult(tab.path);
}

export async function revealRepositoryFileInFinder(tab: FileTab, relativePath: string): Promise<GitOperationResult> {
  const targetPath = resolveRepositoryChildPath(tab.path, relativePath);
  const revealPath = await findNearestExistingPath(targetPath, tab.path);
  await openMacTarget(['-R', revealPath]);

  return createSystemOperationResult(tab.path);
}

function openMacTarget(args: string[], errorMessage = 'Unable to open file.'): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('open', args, {
      stdio: 'ignore'
    });

    child.on('error', reject);
    child.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolve();
        return;
      }

      reject(new Error(errorMessage));
    });
  });
}

function resolveRepositoryChildPath(repoPath: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error('A repository-relative file path is required.');
  }

  const repoRoot = path.resolve(repoPath);
  const targetPath = path.resolve(repoRoot, relativePath);
  const repoRootPrefix = `${repoRoot}${path.sep}`;

  if (targetPath !== repoRoot && !targetPath.startsWith(repoRootPrefix)) {
    throw new Error('File path must stay inside the repository.');
  }

  return targetPath;
}

async function findNearestExistingPath(targetPath: string, repoPath: string): Promise<string> {
  const repoRoot = path.resolve(repoPath);
  let candidate = targetPath;

  while (candidate.startsWith(repoRoot)) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      const parent = path.dirname(candidate);

      if (parent === candidate) {
        break;
      }

      candidate = parent;
    }
  }

  return repoRoot;
}

function createSystemOperationResult(repoPath: string): GitOperationResult {
  return {
    repoPath,
    happenedAt: new Date().toISOString()
  };
}
