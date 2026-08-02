import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { gitExecutor } from './exec';
import { validateRepository } from './repoInspector';
import { findBaseRepositoryForMissingWorktree } from './repositoryRecovery';

describe('missing worktree recovery', () => {
  it('finds the primary checkout after a linked worktree is removed', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-repository-recovery-'));

    try {
      const basePath = join(rootPath, 'base');
      const linkedPath = join(rootPath, 'linked');
      await mkdir(basePath);
      await git(basePath, ['init']);
      await git(basePath, ['config', 'user.name', 'Recovery Test']);
      await git(basePath, ['config', 'user.email', 'recovery@example.test']);
      await writeFile(join(basePath, 'README.md'), 'base\n');
      await git(basePath, ['add', '.']);
      await git(basePath, ['commit', '-m', 'base']);
      await git(basePath, ['branch', '-M', 'main']);
      await git(basePath, ['worktree', 'add', '-b', 'feature/recovery', linkedPath, 'main']);

      const linkedRepository = await validateRepository(linkedPath);
      const baseRepository = await validateRepository(basePath);

      await git(basePath, ['worktree', 'remove', linkedPath]);

      await expect(findBaseRepositoryForMissingWorktree(linkedRepository)).resolves.toEqual(
        baseRepository
      );
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('does not replace an available linked worktree', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-repository-recovery-'));

    try {
      const basePath = join(rootPath, 'base');
      const linkedPath = join(rootPath, 'linked');
      await mkdir(basePath);
      await git(basePath, ['init']);
      await git(basePath, ['config', 'user.name', 'Recovery Test']);
      await git(basePath, ['config', 'user.email', 'recovery@example.test']);
      await writeFile(join(basePath, 'README.md'), 'base\n');
      await git(basePath, ['add', '.']);
      await git(basePath, ['commit', '-m', 'base']);
      await git(basePath, ['worktree', 'add', '-b', 'feature/available', linkedPath, 'HEAD']);

      const linkedRepository = await validateRepository(linkedPath);

      await expect(findBaseRepositoryForMissingWorktree(linkedRepository)).resolves.toBeUndefined();
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('leaves an unavailable primary checkout unchanged', async () => {
    await expect(
      findBaseRepositoryForMissingWorktree({
        path: '/missing/repository',
        gitDir: '/missing/repository/.git',
        commonDir: '/missing/repository/.git'
      })
    ).resolves.toBeUndefined();
  });
});

function git(cwd: string, args: string[]) {
  return gitExecutor.run(args, { cwd, kind: 'mutation' });
}
