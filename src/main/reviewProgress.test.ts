import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Store from 'electron-store';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('review progress persistence', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('persists viewed chunks and can mark them pending again', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-review-progress-'));

    try {
      vi.stubEnv('TMPDIR', rootPath);
      vi.resetModules();
      const { loadReviewedChunks, updateReviewProgress } = await import('./reviewProgress');
      const repoPath = join(rootPath, 'repo');
      const firstId = 'a'.repeat(64);
      const secondId = 'b'.repeat(64);

      expect(
        updateReviewProgress(repoPath, {
          targetKey: 'commit:abc123',
          chunkIds: [firstId, secondId],
          viewed: true
        })
      ).toEqual([firstId, secondId]);
      expect(loadReviewedChunks(repoPath, 'commit:abc123')).toEqual([firstId, secondId]);
      expect(
        updateReviewProgress(repoPath, {
          targetKey: 'commit:abc123',
          chunkIds: [firstId],
          viewed: false
        })
      ).toEqual([secondId]);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('repairs malformed buckets and prunes stale WIP chunk IDs', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-review-progress-'));
    const repoPath = join(rootPath, 'repo');
    const validId = 'a'.repeat(64);
    const staleId = 'b'.repeat(64);
    const store = new Store<{ targetsByRepo: unknown }>({
      name: 'git-gud-review-progress',
      cwd: join(rootPath, 'git-gud-vitest-store', 'review-progress'),
      defaults: { targetsByRepo: {} }
    });
    store.set('targetsByRepo', {
      relative: { invalid: true },
      [repoPath]: {
        'wip:all': {
          updatedAt: '2026-07-15T00:00:00.000Z',
          reviewedChunkIds: [validId, staleId, 'not-a-hash']
        },
        broken: { reviewedChunkIds: 'not-an-array' }
      }
    });

    try {
      vi.stubEnv('TMPDIR', rootPath);
      vi.resetModules();
      const { loadReviewedChunks } = await import('./reviewProgress');

      expect(loadReviewedChunks(repoPath, 'wip:all', new Set([validId]))).toEqual([validId]);
      const stored = JSON.parse(await readFile(store.path, 'utf8')) as { targetsByRepo?: unknown };
      expect(stored.targetsByRepo).toEqual({
        [repoPath]: {
          'wip:all': {
            updatedAt: expect.any(String),
            reviewedChunkIds: [validId]
          }
        }
      });
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});
