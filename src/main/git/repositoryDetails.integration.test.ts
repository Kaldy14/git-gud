import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { gitExecutor } from './exec';
import { discardFile, loadCommitDetail, loadFileDiff, stageFile } from './repositoryDetails';

describe('repository details integration', () => {
  it('treats pathspec-magic filenames literally across stage, diff, and discard', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-details-'));

    try {
      const repoPath = await createRepository(rootPath);
      const magicPath = ':(top)**';
      await writeRepoFile(repoPath, 'ordinary.txt', 'ordinary changed\n');
      await writeRepoFile(repoPath, magicPath, 'magic file\n');

      await stageFile({ path: repoPath }, magicPath);

      expect(await changedPaths(repoPath, ['diff', '--cached', '--name-only'])).toEqual([magicPath]);
      expect(await changedPaths(repoPath, ['diff', '--name-only'])).toEqual(['ordinary.txt']);

      const diff = await loadFileDiff({ path: repoPath }, { kind: 'wip', path: magicPath, staged: true });

      expect(diff.patch).toContain('magic file');
      expect(diff.patch).not.toContain('ordinary changed');

      await discardFile({ path: repoPath }, magicPath);

      await expect(access(join(repoPath, magicPath))).rejects.toThrow();
      expect((await git(repoPath, ['status', '--porcelain'])).stdout).toBe(' M ordinary.txt\n');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('renders merge files, stats, and patches relative to the first parent', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-details-'));

    try {
      const repoPath = await createRepository(rootPath);
      await git(repoPath, ['checkout', '-b', 'feature']);
      await commitFile(repoPath, 'feature.txt', 'feature\n', 'feature change');
      await git(repoPath, ['checkout', 'main']);
      await commitFile(repoPath, 'main.txt', 'main\n', 'main change');
      await git(repoPath, ['merge', '--no-ff', 'feature', '-m', 'merge feature']);
      const mergeSha = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();

      const detail = await loadCommitDetail({ path: repoPath }, mergeSha);
      const diff = await loadFileDiff(
        { path: repoPath },
        { kind: 'commit', sha: mergeSha, path: 'feature.txt' }
      );

      expect(detail.parentShas).toHaveLength(2);
      expect(detail.files.map((file) => file.path)).toEqual(['feature.txt']);
      expect(detail.stats).toMatchObject({ filesChanged: 1, additions: 1, deletions: 0 });
      expect(diff.patch).toContain('diff --git a/feature.txt b/feature.txt');
      expect(diff.patch).not.toContain('main.txt');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('omits binary and oversized patch payloads before they reach the renderer', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-details-'));

    try {
      const repoPath = await createRepository(rootPath);
      await writeRepoFile(repoPath, 'binary.dat', Buffer.from([0, 1, 2, 3, 0, 255]));
      await git(repoPath, ['add', 'binary.dat']);
      await git(repoPath, ['commit', '-m', 'binary']);
      const binarySha = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();

      const binaryDiff = await loadFileDiff(
        { path: repoPath },
        { kind: 'commit', sha: binarySha, path: 'binary.dat' }
      );

      expect(binaryDiff).toMatchObject({ patch: '', isBinary: true, omittedReason: 'binary' });

      await writeRepoFile(repoPath, 'large.txt', 'base\n');
      await git(repoPath, ['add', 'large.txt']);
      await git(repoPath, ['commit', '-m', 'large base']);
      await writeRepoFile(repoPath, 'large.txt', 'changed line\n'.repeat(750_000));

      const largeDiff = await loadFileDiff({ path: repoPath }, { kind: 'wip', path: 'large.txt', staged: false });

      expect(largeDiff).toMatchObject({ patch: '', isBinary: false, omittedReason: 'too-large' });
      expect(largeDiff.stageablePatch).toBeUndefined();
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});

async function createRepository(rootPath: string): Promise<string> {
  const repoPath = join(rootPath, 'repo');
  await mkdir(repoPath);
  await git(repoPath, ['init']);
  await git(repoPath, ['config', 'user.name', 'Details Test']);
  await git(repoPath, ['config', 'user.email', 'details@example.test']);
  await writeRepoFile(repoPath, 'ordinary.txt', 'ordinary base\n');
  await git(repoPath, ['add', '.']);
  await git(repoPath, ['commit', '-m', 'base']);
  await git(repoPath, ['branch', '-M', 'main']);
  return repoPath;
}

async function writeRepoFile(repoPath: string, relativePath: string, contents: string | Uint8Array): Promise<void> {
  const filePath = join(repoPath, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function commitFile(repoPath: string, relativePath: string, contents: string, message: string): Promise<void> {
  await writeRepoFile(repoPath, relativePath, contents);
  await git(repoPath, ['add', relativePath]);
  await git(repoPath, ['commit', '-m', message]);
}

async function changedPaths(repoPath: string, args: string[]): Promise<string[]> {
  return (await git(repoPath, args)).stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

async function git(cwd: string, args: string[]) {
  return gitExecutor.run(args, { cwd, kind: 'mutation' });
}
