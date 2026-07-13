import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import type { RepoChangedEvent } from '@shared/types';

import {
  invalidateRepositoryQueries,
  repositoryOverviewQueryKey,
  scopesForRepositoryChange,
  shouldPruneLowerGraphQueries
} from './repository';

function repoChange(overrides: Partial<RepoChangedEvent>): RepoChangedEvent {
  return {
    repoPath: '/repo',
    reason: 'worktree',
    reasons: ['worktree'],
    paths: ['/repo/src/file.ts'],
    happenedAt: '2026-07-10T10:00:00.000Z',
    ...overrides
  };
}

describe('repository watcher invalidation', () => {
  it('refreshes the graph WIP row without invalidating immutable commit details', () => {
    expect(scopesForRepositoryChange(repoChange({}))).toEqual([
      'overview',
      'graph',
      'wip-detail',
      'file-diff'
    ]);
  });

  it('invalidates history when a ref changes', () => {
    expect(
      scopesForRepositoryChange(
        repoChange({
          reason: 'git-dir',
          reasons: ['git-dir'],
          paths: ['/repo/.git/refs/heads/main']
        })
      )
    ).toEqual(['overview', 'graph', 'wip-detail', 'file-diff']);
  });

  it('keeps generic Git metadata changes scoped away from WIP and diff caches', () => {
    expect(
      scopesForRepositoryChange(
        repoChange({
          reason: 'git-dir',
          reasons: ['git-dir'],
          paths: ['/repo/.git/config']
        })
      )
    ).toEqual(['overview', 'graph']);
  });
});

describe('graph cache pruning', () => {
  it('does not remove the active lower-limit query while larger placeholder data is shown', () => {
    expect(shouldPruneLowerGraphQueries(1500, 3000, true)).toBe(false);
    expect(shouldPruneLowerGraphQueries(1500, 3000, false)).toBe(false);
    expect(shouldPruneLowerGraphQueries(1500, 1500, false)).toBe(true);
  });
});

describe('repository query invalidation', () => {
  it('reuses an in-flight refresh instead of cancelling and restarting it', async () => {
    const queryClient = new QueryClient();
    const queryKey = repositoryOverviewQueryKey('/repo');
    let resolveRefresh: (value: { loadedAt: string }) => void = () => {};
    const refreshPromise = new Promise<{ loadedAt: string }>((resolve) => {
      resolveRefresh = resolve;
    });
    const queryFn = vi.fn(() => refreshPromise);
    queryClient.setQueryData(queryKey, { loadedAt: 'cached' });
    const observer = new QueryObserver(queryClient, {
      queryKey,
      queryFn,
      staleTime: Number.POSITIVE_INFINITY
    });
    const unsubscribe = observer.subscribe(() => {});

    const firstInvalidation = invalidateRepositoryQueries(queryClient, '/repo', ['overview']);
    await Promise.resolve();
    const secondInvalidation = invalidateRepositoryQueries(queryClient, '/repo', ['overview']);

    expect(queryFn).toHaveBeenCalledTimes(1);
    resolveRefresh({ loadedAt: 'fresh' });
    await Promise.all([firstInvalidation, secondInvalidation]);

    unsubscribe();
    queryClient.clear();
  });
});
