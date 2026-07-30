import type {
  GitHubPullRequestFile,
  GitHubPullRequestSummary,
  GitReviewPlan,
  GitStatusCode
} from '@shared/types';

import { attachReviewSyntax } from '../../src/main/git/reviewSyntaxAttachment';
import {
  buildReviewPlan,
  type ReviewPatchInput
} from '../../src/main/git/reviewPlan';
import { loadReviewPlan } from '../../src/main/git/repositoryDetails';
import { buildGitHubPullRequestReviewPlan } from '../../src/main/github';
import type { ReviewBenchmarkFixture } from './fixtureRepository';
import type {
  ReviewBenchmarkFile,
  ReviewBenchmarkPipeline,
  ReviewGroupingDataset
} from './types';

export async function runReviewBenchmarkPipeline(
  pipeline: ReviewBenchmarkPipeline,
  dataset: ReviewGroupingDataset,
  fixture: ReviewBenchmarkFixture
): Promise<GitReviewPlan> {
  if (pipeline === 'core-full-context') {
    return runCoreFullContext(dataset, fixture);
  }

  if (pipeline === 'local-commit') {
    return loadReviewPlan(
      { path: fixture.repoPath },
      { kind: 'commit', sha: fixture.commit.sha }
    );
  }

  return runGitHubBuilder(dataset, fixture);
}

async function runCoreFullContext(
  dataset: ReviewGroupingDataset,
  fixture: ReviewBenchmarkFixture
): Promise<GitReviewPlan> {
  const datasetFileByPath = datasetFilesByCommitPath(dataset);
  const patches = await Promise.all(fixture.commit.files.map(async (file): Promise<ReviewPatchInput> => {
    const datasetFile = datasetFileByPath.get(file.path);
    const diff = fixture.diffsByPath.get(file.path);

    if (!datasetFile || !diff) {
      throw new Error(`Core benchmark could not resolve ${file.path} in dataset ${dataset.id}.`);
    }

    return attachReviewSyntax(fixture.repoPath, {
      path: file.path,
      originalPath: file.originalPath,
      status: file.status,
      source: 'commit',
      diff,
      fileContext: fileContext(datasetFile, file.path)
    });
  }));

  return buildReviewPlan(
    fixture.repoPath,
    { kind: 'commit', sha: fixture.commit.sha },
    patches
  );
}

async function runGitHubBuilder(
  dataset: ReviewGroupingDataset,
  fixture: ReviewBenchmarkFixture
): Promise<GitReviewPlan> {
  const datasetFileByPath = datasetFilesByCommitPath(dataset);
  const files = fixture.commit.files.map((file): GitHubPullRequestFile => {
    const diff = fixture.diffsByPath.get(file.path);

    if (!diff) {
      throw new Error(`GitHub benchmark could not resolve ${file.path} in dataset ${dataset.id}.`);
    }

    const counts = changedLineCounts(diff.patch);

    return {
      sha: fixture.commit.sha,
      path: file.path,
      previousPath: file.originalPath,
      status: gitHubStatus(file.status),
      additions: counts.additions,
      deletions: counts.deletions,
      changes: counts.additions + counts.deletions,
      patch: diff.patch,
      omittedReason: diff.omittedReason
    };
  });
  const contexts = fixture.commit.files.map((file) => {
    const datasetFile = datasetFileByPath.get(file.path);

    if (!datasetFile) {
      throw new Error(`GitHub benchmark could not resolve context for ${file.path} in dataset ${dataset.id}.`);
    }

    return {
      path: file.path,
      originalPath: file.originalPath,
      ...fileContext(datasetFile, file.path)
    };
  });

  return buildGitHubPullRequestReviewPlan(
    'github.com',
    pullRequestSummary(dataset, fixture.commit.sha),
    fixture.commit.sha,
    files,
    contexts
  );
}

function fileContext(file: ReviewBenchmarkFile, commitPath = file.path): {
  oldContents: string;
  newContents: string;
} {
  if (file.previousPath && commitPath === file.previousPath) {
    return {
      oldContents: file.before ?? '',
      newContents: ''
    };
  }

  return {
    oldContents: file.before ?? '',
    newContents: file.after ?? ''
  };
}

function datasetFilesByCommitPath(
  dataset: ReviewGroupingDataset
): Map<string, ReviewBenchmarkFile> {
  return new Map(dataset.files.flatMap((file) => [
    [file.path, file] as const,
    ...(file.previousPath ? [[file.previousPath, file] as const] : [])
  ]));
}

function gitHubStatus(status: GitStatusCode): GitHubPullRequestFile['status'] {
  if (status === 'deleted') {
    return 'removed';
  }

  if (
    status === 'added' ||
    status === 'renamed' ||
    status === 'copied'
  ) {
    return status;
  }

  if (status === 'unmodified') {
    return 'unchanged';
  }

  return 'modified';
}

function changedLineCounts(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;

  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      additions += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions += 1;
    }
  }

  return { additions, deletions };
}

function pullRequestSummary(
  dataset: ReviewGroupingDataset,
  headSha: string
): GitHubPullRequestSummary {
  return {
    profileId: 'review-benchmark',
    owner: 'benchmark',
    repository: dataset.id,
    number: 1,
    id: `benchmark-${dataset.id}`,
    title: dataset.title,
    url: `https://github.com/benchmark/${dataset.id}/pull/1`,
    author: 'benchmark',
    updatedAt: '2026-01-01T00:00:00.000Z',
    category: 'needs-your-review',
    isDraft: false,
    reviewDecision: 'review-required',
    mergeState: 'clean',
    mergeable: 'mergeable',
    canMerge: true,
    reviewers: [],
    comments: 0,
    changedFiles: dataset.files.length,
    additions: 0,
    deletions: 0,
    headRefName: 'benchmark',
    headRepositoryOwner: 'benchmark',
    headRepository: dataset.id,
    headSha,
    baseRefName: 'main',
    checks: {
      state: 'success',
      total: 0,
      passed: 0,
      failed: 0,
      pending: 0
    }
  };
}
