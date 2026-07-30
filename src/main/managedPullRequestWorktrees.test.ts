import { access, mkdtemp, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { OpenPullRequestInApplicationInput } from '@shared/externalApplications';
import type { RepoTab } from '@shared/types';

import { gitExecutor } from './git/exec';
import {
  ManagedPullRequestWorktreeService,
  type ManagedPullRequestWorktreeEntry,
  type ManagedPullRequestWorktreeRegistry
} from './managedPullRequestWorktrees';

describe('ManagedPullRequestWorktreeService', () => {
  it('opens the exact PR head without switching the main checkout and removes it cleanly', async () => {
    const fixture = await createPullRequestFixture();

    try {
      const registry = createMemoryRegistry();
      const service = new ManagedPullRequestWorktreeService(
        fixture.managedRoot,
        registry
      );
      const entry = await service.prepare({
        tab: fixture.tab,
        pullRequest: fixture.pullRequest
      });
      const reusedEntry = await service.prepare({
        tab: fixture.tab,
        pullRequest: fixture.pullRequest
      });
      const [mainBranch, mainHead, worktreeHead, detachedHead] = await Promise.all([
        runGit(['branch', '--show-current'], fixture.repoPath),
        runGit(['rev-parse', 'HEAD'], fixture.repoPath),
        runGit(['rev-parse', 'HEAD'], entry.path),
        runGit(['symbolic-ref', '-q', 'HEAD'], entry.path, [1])
      ]);

      expect(reusedEntry.path).toBe(entry.path);
      expect(registry.list()).toHaveLength(1);
      expect(mainBranch.stdout.trim()).toBe('main');
      expect(mainHead.stdout.trim()).toBe(fixture.mainSha);
      expect(worktreeHead.stdout.trim()).toBe(fixture.pullRequest.headSha);
      expect(detachedHead.exitCode).toBe(1);

      service.recordLeaseProcess(entry, 2_147_483_647);
      await expect(service.cleanupExpired()).resolves.toEqual({
        removed: 1,
        preserved: 0
      });
      await expect(access(entry.path)).rejects.toThrow();
      expect(registry.list()).toEqual([]);

      const managedRef = await runGit(
        ['rev-parse', '--verify', '--quiet', entry.refName],
        fixture.repoPath,
        [1]
      );
      expect(managedRef.exitCode).toBe(1);
    } finally {
      await rm(fixture.rootPath, { recursive: true, force: true });
    }
  });

  it('preserves a dirty managed worktree instead of force-removing user changes', async () => {
    const fixture = await createPullRequestFixture();

    try {
      const registry = createMemoryRegistry();
      const service = new ManagedPullRequestWorktreeService(
        fixture.managedRoot,
        registry
      );
      const entry = await service.prepare({
        tab: fixture.tab,
        pullRequest: fixture.pullRequest
      });
      const draftPath = join(entry.path, 'local-review-notes.txt');
      await writeFile(draftPath, 'keep this work\n');

      await expect(service.cleanup(entry)).resolves.toBe(false);
      await expect(access(entry.path)).resolves.toBeUndefined();
      expect(registry.list()).toHaveLength(1);

      await unlink(draftPath);
      await expect(service.cleanup(entry)).resolves.toBe(true);
    } finally {
      await rm(fixture.rootPath, { recursive: true, force: true });
    }
  });
});

type PullRequestFixture = {
  rootPath: string;
  repoPath: string;
  managedRoot: string;
  mainSha: string;
  tab: RepoTab;
  pullRequest: OpenPullRequestInApplicationInput;
};

async function createPullRequestFixture(): Promise<PullRequestFixture> {
  const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-managed-pr-'));
  const repoPath = join(rootPath, 'widget');
  const remotePath = join(rootPath, 'remote.git');
  const managedRoot = join(rootPath, 'managed');

  await runGit(['init', '--initial-branch=main', repoPath], rootPath);
  await runGit(['config', 'user.name', 'Git Gud Test'], repoPath, undefined, 'mutation');
  await runGit(['config', 'user.email', 'git-gud@example.com'], repoPath, undefined, 'mutation');
  await writeFile(join(repoPath, 'README.md'), '# Widget\n');
  await runGit(['add', 'README.md'], repoPath, undefined, 'mutation');
  await runGit(['commit', '-m', 'Initial commit'], repoPath, undefined, 'mutation');
  const mainSha = (await runGit(['rev-parse', 'HEAD'], repoPath)).stdout.trim();

  await runGit(['init', '--bare', remotePath], rootPath, undefined, 'mutation');
  await runGit(
    ['remote', 'add', 'origin', 'https://github.com/acme/widget.git'],
    repoPath,
    undefined,
    'mutation'
  );
  await runGit(
    [
      'config',
      `url.${pathToFileURL(remotePath).href}.insteadOf`,
      'https://github.com/acme/widget.git'
    ],
    repoPath,
    undefined,
    'mutation'
  );
  await runGit(['push', '-u', 'origin', 'main'], repoPath, undefined, 'mutation');

  await runGit(['checkout', '-b', 'pr-source'], repoPath, undefined, 'mutation');
  await writeFile(join(repoPath, 'feature.ts'), 'export const feature = true;\n');
  await runGit(['add', 'feature.ts'], repoPath, undefined, 'mutation');
  await runGit(['commit', '-m', 'Add feature'], repoPath, undefined, 'mutation');
  const headSha = (await runGit(['rev-parse', 'HEAD'], repoPath)).stdout.trim();
  await runGit(
    ['push', 'origin', `${headSha}:refs/pull/42/head`],
    repoPath,
    undefined,
    'mutation'
  );
  await runGit(['checkout', 'main'], repoPath, undefined, 'mutation');

  const commonDirOutput = (await runGit(['rev-parse', '--git-common-dir'], repoPath))
    .stdout
    .trim();
  const commonDir = await realpath(resolve(repoPath, commonDirOutput));
  const now = new Date().toISOString();

  return {
    rootPath,
    repoPath,
    managedRoot,
    mainSha,
    tab: {
      id: 'fixture',
      path: repoPath,
      name: 'widget',
      gitDir: commonDir,
      commonDir,
      openedAt: now,
      lastOpenedAt: now,
      viewMode: 'graph'
    },
    pullRequest: {
      applicationId: 'vscode',
      url: 'https://github.com/acme/widget/pull/42',
      owner: 'acme',
      repository: 'widget',
      number: 42,
      headSha
    }
  };
}

function createMemoryRegistry(): ManagedPullRequestWorktreeRegistry {
  let entries: ManagedPullRequestWorktreeEntry[] = [];

  return {
    list: () => [...entries],
    save: (entry) => {
      entries = [
        ...entries.filter((candidate) => candidate.id !== entry.id),
        entry
      ];
    },
    remove: (entryId) => {
      entries = entries.filter((entry) => entry.id !== entryId);
    }
  };
}

function runGit(
  args: string[],
  cwd: string,
  allowedExitCodes?: readonly number[],
  kind: 'read' | 'mutation' = 'read'
) {
  return gitExecutor.run(args, { cwd, kind, allowedExitCodes });
}
