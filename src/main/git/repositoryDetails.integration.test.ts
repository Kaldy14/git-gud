import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { gitExecutor } from './exec';
import {
  discardAllChanges,
  discardFile,
  loadCommitDetail,
  loadCommitSelectionDetail,
  loadFileDiff,
  stageFile,
  unstageFile
} from './repositoryDetails';

describe('repository details integration', () => {
  it('preserves staged rename detection while using path-scoped status reads', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-details-'));

    try {
      const repoPath = await createRepository(rootPath);
      await git(repoPath, ['mv', 'ordinary.txt', 'renamed.txt']);

      await unstageFile({ path: repoPath }, 'renamed.txt');

      expect((await git(repoPath, ['diff', '--cached', '--name-only'])).stdout).toBe('');
      expect(await readFile(join(repoPath, 'renamed.txt'), 'utf8')).toBe('ordinary base\n');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

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

  it('discards all tracked, staged, and untracked changes while preserving ignored files', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-details-'));

    try {
      const repoPath = await createRepository(rootPath);
      await writeRepoFile(repoPath, '.git/info/exclude', 'ignored-output/\n');
      await writeRepoFile(repoPath, 'ordinary.txt', 'ordinary changed\n');
      await writeRepoFile(repoPath, 'staged.txt', 'staged addition\n');
      await git(repoPath, ['add', 'staged.txt']);
      await writeRepoFile(repoPath, 'scratch/note.txt', 'untracked\n');
      await writeRepoFile(repoPath, 'ignored-output/cache.txt', 'keep me\n');

      await discardAllChanges({ path: repoPath });

      expect(await readFile(join(repoPath, 'ordinary.txt'), 'utf8')).toBe('ordinary base\n');
      await expect(access(join(repoPath, 'staged.txt'))).rejects.toThrow();
      await expect(access(join(repoPath, 'scratch'))).rejects.toThrow();
      expect(await readFile(join(repoPath, 'ignored-output/cache.txt'), 'utf8')).toBe('keep me\n');
      expect((await git(repoPath, ['status', '--porcelain'])).stdout).toBe('');
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

  it('combines contiguous commit selections and preserves exact sparse commit patches', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-details-'));

    try {
      const repoPath = await createRepository(rootPath);
      await commitFile(repoPath, 'review.txt', 'one\n', 'add review file');
      const oldestSha = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await commitFile(repoPath, 'review.txt', 'two\n', 'refine review file');
      const middleSha = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await commitFile(repoPath, 'review.txt', 'three\n', 'finish review file');
      const newestSha = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      const contiguousShas = [newestSha, middleSha, oldestSha];

      const contiguousDetail = await loadCommitSelectionDetail({ path: repoPath }, contiguousShas);
      const contiguousDiff = await loadFileDiff(
        { path: repoPath },
        { kind: 'selection', shas: contiguousShas, path: 'review.txt' }
      );

      expect(contiguousDetail).toMatchObject({
        kind: 'selection',
        isContiguous: true,
        shas: contiguousShas,
        stats: { filesChanged: 1, additions: 1, deletions: 0 }
      });
      expect(contiguousDetail.files.map((file) => file.path)).toEqual(['review.txt']);
      expect(contiguousDiff).toMatchObject({ mode: 'selection', isBinary: false });
      expect(contiguousDiff.segments).toBeUndefined();
      expect(contiguousDiff.patch).toContain('+three');
      expect(contiguousDiff.patch).not.toContain('+one');

      const sparseShas = [newestSha, oldestSha];
      const sparseDetail = await loadCommitSelectionDetail({ path: repoPath }, sparseShas);
      const sparseDiff = await loadFileDiff(
        { path: repoPath },
        { kind: 'selection', shas: sparseShas, path: 'review.txt' }
      );

      expect(sparseDetail.isContiguous).toBe(false);
      expect(sparseDiff.segments?.map((segment) => segment.subject)).toEqual([
        'add review file',
        'finish review file'
      ]);
      expect(sparseDiff.segments?.[0]?.patch).toContain('+one');
      expect(sparseDiff.segments?.[1]?.patch).toContain('+three');
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
