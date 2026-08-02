import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { RepoTab, RepositorySummary } from '@shared/types';

import { gitExecutor } from './exec';
import { parseWorktreeList } from './parsers/worktree';
import { validateRepository } from './repoInspector';

type RecoverableRepositoryTab = Pick<RepoTab, 'path' | 'gitDir' | 'commonDir'>;

export async function findBaseRepositoryForMissingWorktree(
  tab: RecoverableRepositoryTab
): Promise<RepositorySummary | undefined> {
  if (
    (await isDirectory(tab.path)) ||
    resolve(tab.gitDir) === resolve(tab.commonDir) ||
    !(await isDirectory(tab.commonDir))
  ) {
    return undefined;
  }

  try {
    const result = await gitExecutor.run(
      ['--git-dir', tab.commonDir, 'worktree', 'list', '--porcelain', '-z'],
      { cwd: tab.commonDir }
    );
    const worktrees = parseWorktreeList(result.stdout, tab.path);

    for (const worktree of worktrees) {
      if (worktree.bare || worktree.path === tab.path) {
        continue;
      }

      try {
        const repository = await validateRepository(worktree.path);

        if (
          resolve(repository.commonDir) === resolve(tab.commonDir) &&
          resolve(repository.gitDir) === resolve(repository.commonDir)
        ) {
          return repository;
        }
      } catch {
        // A listed linked worktree may also have disappeared. Keep looking for the primary checkout.
      }
    }
  } catch {
    // The shared Git directory may be on disconnected storage. Preserve the unavailable state in that case.
  }

  return undefined;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
