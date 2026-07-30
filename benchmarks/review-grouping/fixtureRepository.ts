import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { GitCommitDetail, GitFileDiff } from '@shared/types';

import { gitExecutor } from '../../src/main/git/exec';
import {
  loadCommitDetail,
  loadFileDiff
} from '../../src/main/git/repositoryDetails';
import type { ReviewGroupingDataset } from './types';

export type ReviewBenchmarkFixture = {
  repoPath: string;
  commit: GitCommitDetail;
  diffsByPath: ReadonlyMap<string, GitFileDiff>;
  dispose: () => Promise<void>;
};

export async function createReviewBenchmarkFixture(
  dataset: ReviewGroupingDataset
): Promise<ReviewBenchmarkFixture> {
  const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-review-benchmark-'));
  const repoPath = join(rootPath, 'repo');

  try {
    await mkdir(repoPath);
    await git(repoPath, ['init']);
    await git(repoPath, ['config', 'user.name', 'Review Benchmark']);
    await git(repoPath, ['config', 'user.email', 'review-benchmark@example.test']);

    for (const file of dataset.files) {
      if (file.before !== null) {
        await writeRepoFile(repoPath, file.previousPath ?? file.path, file.before);
      }
    }

    await git(repoPath, ['add', '--all']);
    await git(repoPath, ['commit', '--allow-empty', '-m', 'benchmark base']);

    for (const file of dataset.files) {
      const oldPath = file.previousPath ?? file.path;

      if (file.before !== null && (file.after === null || oldPath !== file.path)) {
        await rm(join(repoPath, oldPath), { force: true });
      }
    }

    for (const file of dataset.files) {
      if (file.after !== null) {
        await writeRepoFile(repoPath, file.path, file.after);
      }
    }

    await git(repoPath, ['add', '--all']);
    await git(repoPath, ['commit', '--allow-empty', '-m', dataset.id]);

    const commitSha = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
    const commit = await loadCommitDetail({ path: repoPath }, commitSha);
    const diffs = await Promise.all(commit.files.map(async (file) => [
      file.path,
      await loadFileDiff(
        { path: repoPath },
        {
          kind: 'commit',
          sha: commitSha,
          path: file.path,
          originalPath: file.originalPath
        }
      )
    ] as const));

    return {
      repoPath,
      commit,
      diffsByPath: new Map(diffs),
      dispose: () => rm(rootPath, { recursive: true, force: true })
    };
  } catch (error) {
    await rm(rootPath, { recursive: true, force: true });
    throw error;
  }
}

async function writeRepoFile(
  repoPath: string,
  relativePath: string,
  contents: string
): Promise<void> {
  const filePath = join(repoPath, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

function git(cwd: string, args: string[]) {
  return gitExecutor.run(args, { cwd, kind: 'mutation' });
}
