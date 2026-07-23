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
  loadReviewPlan,
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
      await commitFile(repoPath, 'review.txt', 'three\n', 'finish review file');
      const thirdSha = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await commitFile(repoPath, 'review.txt', 'four\n', 'polish review file');
      await commitFile(repoPath, 'review.txt', 'five\n', 'extend review file');
      const fifthSha = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await commitFile(repoPath, 'review.txt', 'six\n', 'prepare review file');
      const sixthSha = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await commitFile(repoPath, 'review.txt', 'seven\n', 'complete review file');
      const newestSha = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      const contiguousShas = [newestSha, sixthSha, fifthSha];

      const contiguousDetail = await loadCommitSelectionDetail({ path: repoPath }, contiguousShas);
      const contiguousDiff = await loadFileDiff(
        { path: repoPath },
        { kind: 'selection', shas: contiguousShas, path: 'review.txt' }
      );

      expect(contiguousDetail).toMatchObject({
        kind: 'selection',
        isContiguous: true,
        shas: contiguousShas,
        stats: { filesChanged: 1, additions: 1, deletions: 1 }
      });
      expect(contiguousDetail.files.map((file) => file.path)).toEqual(['review.txt']);
      expect(contiguousDiff).toMatchObject({ mode: 'selection', isBinary: false });
      expect(contiguousDiff.segments).toBeUndefined();
      expect(contiguousDiff.patch).toContain('+seven');
      expect(contiguousDiff.patch).not.toContain('+five');

      const sparseShas = [newestSha, fifthSha, thirdSha, oldestSha];
      const sparseDetail = await loadCommitSelectionDetail({ path: repoPath }, sparseShas);
      const sparseDiff = await loadFileDiff(
        { path: repoPath },
        { kind: 'selection', shas: sparseShas, path: 'review.txt' }
      );

      expect(sparseDetail.isContiguous).toBe(false);
      expect(sparseDiff.segments?.map((segment) => segment.subject)).toEqual([
        'add review file',
        'finish review file',
        'extend review file',
        'complete review file'
      ]);
      expect(sparseDiff.segments?.[0]?.patch).toContain('+one');
      expect(sparseDiff.segments?.[1]?.patch).toContain('+three');
      expect(sparseDiff.segments?.[2]?.patch).toContain('+five');
      expect(sparseDiff.segments?.[3]?.patch).toContain('+seven');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('builds contextual review plans for commits and combined WIP changes', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-details-'));

    try {
      const repoPath = await createRepository(rootPath);
      await writeRepoFile(repoPath, 'src/config.ts', 'export const DEFAULT_TIMEOUT = 5000;\n');
      await writeRepoFile(repoPath, 'src/client.ts', 'export const connect = () => open(DEFAULT_TIMEOUT);\n');
      await writeRepoFile(repoPath, 'src/client.test.ts', 'expect(connect(DEFAULT_TIMEOUT)).toBeDefined();\n');
      await git(repoPath, ['add', '.']);
      await git(repoPath, ['commit', '-m', 'add timeout']);
      const commitSha = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();

      const commitPlan = await loadReviewPlan({ path: repoPath }, { kind: 'commit', sha: commitSha });
      const timeoutUnit = commitPlan.units.find((unit) => unit.symbol === 'DEFAULT_TIMEOUT');
      const configContext = commitPlan.fileContexts.find((context) => context.path === 'src/config.ts');

      expect(timeoutUnit?.chunks.map((chunk) => chunk.path)).toEqual([
        'src/config.ts',
        'src/client.ts',
        'src/client.test.ts'
      ]);
      expect(configContext).toMatchObject({
        source: 'commit',
        oldContents: '',
        newContents: 'export const DEFAULT_TIMEOUT = 5000;\n'
      });

      await writeRepoFile(repoPath, 'src/staged.ts', 'export const stagedValue = true;\n');
      await git(repoPath, ['add', 'src/staged.ts']);
      await writeRepoFile(repoPath, 'spec/wip_spec.rb', 'expect(wip_value).to be_present\n');

      const wipPlan = await loadReviewPlan({ path: repoPath }, { kind: 'wip', scope: 'all' });
      const wipChunks = wipPlan.units.flatMap((unit) => unit.chunks);
      const stagedContext = wipPlan.fileContexts.find((context) => context.path === 'src/staged.ts');
      const unstagedContext = wipPlan.fileContexts.find((context) => context.path === 'spec/wip_spec.rb');

      expect(wipChunks.find((chunk) => chunk.path === 'src/staged.ts')?.source).toBe('staged');
      expect(wipChunks.find((chunk) => chunk.path === 'spec/wip_spec.rb')).toMatchObject({
        source: 'unstaged',
        category: 'spec'
      });
      expect(stagedContext).toMatchObject({
        source: 'staged',
        oldContents: '',
        newContents: 'export const stagedValue = true;\n'
      });
      expect(unstagedContext).toMatchObject({
        source: 'unstaged',
        oldContents: '',
        newContents: 'expect(wip_value).to be_present\n'
      });
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('builds one cumulative review plan for a whole local branch', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-details-'));

    try {
      const repoPath = await createRepository(rootPath);
      await git(repoPath, ['checkout', '-b', 'feature/review-all']);
      await commitFile(
        repoPath,
        'src/branch-review.ts',
        'export const branchValue = 1;\n',
        'start branch review'
      );
      await commitFile(
        repoPath,
        'src/branch-review.ts',
        'export const branchValue = 2;\nexport const branchReady = true;\n',
        'finish branch review'
      );
      const branchSha = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();

      const plan = await loadReviewPlan(
        { path: repoPath },
        { kind: 'branch', name: 'feature/review-all', sha: branchSha }
      );
      const chunks = plan.units.flatMap((unit) => unit.chunks);

      expect(plan.target).toEqual({
        kind: 'branch',
        name: 'feature/review-all',
        sha: branchSha
      });
      expect(plan.targetKey).toBe('branch:feature/review-all');
      expect(chunks.some((chunk) => chunk.path === 'src/branch-review.ts')).toBe(true);
      expect(chunks.some((chunk) => chunk.path === 'ordinary.txt')).toBe(false);
      expect(chunks.map((chunk) => chunk.patch).join('\n')).toContain('+export const branchReady = true;');
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
