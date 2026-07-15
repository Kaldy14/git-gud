import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import Store from 'electron-store';

import type { GitReviewProgressUpdate } from '@shared/types';

type PersistedReviewTarget = {
  updatedAt: string;
  reviewedChunkIds: string[];
};

type ReviewProgressStoreShape = {
  targetsByRepo: Record<string, Record<string, PersistedReviewTarget>>;
};

const MAX_TARGETS_PER_REPOSITORY = 50;
const MAX_CHUNKS_PER_TARGET = 10_000;
const chunkIdPattern = /^[a-f0-9]{64}$/;

const reviewProgressStore = new Store<ReviewProgressStoreShape>({
  name: 'git-gud-review-progress',
  clearInvalidConfig: true,
  ...testStoreDirectory('review-progress'),
  defaults: {
    targetsByRepo: {}
  }
});

export function loadReviewedChunks(
  repoPath: string,
  targetKey: string,
  validChunkIds?: ReadonlySet<string>
): string[] {
  const targetsByRepo = readTargetsByRepo();
  const target = targetsByRepo[repoPath]?.[targetKey];

  if (!target) {
    return [];
  }

  const reviewedChunkIds = validChunkIds
    ? target.reviewedChunkIds.filter((chunkId) => validChunkIds.has(chunkId))
    : target.reviewedChunkIds;

  if (reviewedChunkIds.length !== target.reviewedChunkIds.length) {
    persistTarget(repoPath, targetKey, reviewedChunkIds, targetsByRepo);
  }

  return reviewedChunkIds;
}

export function updateReviewProgress(
  repoPath: string,
  update: GitReviewProgressUpdate
): string[] {
  const targetsByRepo = readTargetsByRepo();
  const current = new Set(targetsByRepo[repoPath]?.[update.targetKey]?.reviewedChunkIds ?? []);

  for (const chunkId of update.chunkIds) {
    if (update.viewed) {
      current.add(chunkId);
    } else {
      current.delete(chunkId);
    }
  }

  const reviewedChunkIds = [...current].slice(0, MAX_CHUNKS_PER_TARGET);
  persistTarget(repoPath, update.targetKey, reviewedChunkIds, targetsByRepo);
  return reviewedChunkIds;
}

function persistTarget(
  repoPath: string,
  targetKey: string,
  reviewedChunkIds: string[],
  targetsByRepo: ReviewProgressStoreShape['targetsByRepo']
): void {
  const repositoryTargets = {
    ...(targetsByRepo[repoPath] ?? {}),
    [targetKey]: {
      updatedAt: new Date().toISOString(),
      reviewedChunkIds
    }
  };
  const boundedTargets = Object.fromEntries(
    Object.entries(repositoryTargets)
      .sort(([, left], [, right]) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, MAX_TARGETS_PER_REPOSITORY)
  );

  reviewProgressStore.set('targetsByRepo', {
    ...targetsByRepo,
    [repoPath]: boundedTargets
  });
}

function readTargetsByRepo(): ReviewProgressStoreShape['targetsByRepo'] {
  const raw: unknown = reviewProgressStore.get('targetsByRepo', {});
  const normalized: ReviewProgressStoreShape['targetsByRepo'] = {};

  if (isRecord(raw)) {
    for (const [repoPath, targets] of Object.entries(raw)) {
      if (!isAbsolute(repoPath) || !isRecord(targets)) {
        continue;
      }

      const normalizedTargets: Record<string, PersistedReviewTarget> = {};

      for (const [targetKey, target] of Object.entries(targets)) {
        const normalizedTarget = normalizeTarget(targetKey, target);

        if (normalizedTarget) {
          normalizedTargets[targetKey] = normalizedTarget;
        }
      }

      normalized[repoPath] = normalizedTargets;
    }
  }

  reviewProgressStore.set('targetsByRepo', normalized);
  return normalized;
}

function normalizeTarget(targetKey: string, value: unknown): PersistedReviewTarget | undefined {
  if (!targetKey || targetKey.length > 256 || !isRecord(value)) {
    return undefined;
  }

  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : undefined;
  const chunkIds = Array.isArray(value.reviewedChunkIds)
    ? value.reviewedChunkIds.filter((chunkId): chunkId is string => typeof chunkId === 'string' && chunkIdPattern.test(chunkId))
    : undefined;

  if (!updatedAt || Number.isNaN(Date.parse(updatedAt)) || !chunkIds) {
    return undefined;
  }

  return {
    updatedAt,
    reviewedChunkIds: [...new Set(chunkIds)].slice(0, MAX_CHUNKS_PER_TARGET)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function testStoreDirectory(name: string): { cwd: string } | Record<string, never> {
  if (process.env.NODE_ENV !== 'test') {
    return {};
  }

  return {
    cwd: join(tmpdir(), 'git-gud-vitest-store', name)
  };
}
