import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import type { RepoChangedEvent } from '@shared/types';

import {
  clearRepositoryQueries,
  invalidateRepositoryQueries,
  placeholderGraphForRepository,
  prepareRepositoryForNavigation,
  prepareRepositoryForProfileTransition,
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
      'file-diff',
      'conflict-file',
      'review-plan'
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
    ).toEqual(['overview', 'graph', 'wip-detail', 'file-diff', 'conflict-file', 'review-plan']);
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

  it('retargets same-repository WIP rows while the next worktree graph loads', () => {
    const previous = {
      repoPath: '/repo/main',
      loadedAt: '2026-07-20T20:00:00.000Z',
      limit: 1500,
      loadedCommitCount: 1,
      hasMore: false,
      nextLimit: 1500,
      rows: [
        graphRow('wip', '/repo/main', true),
        graphRow('wip:/repo/second', '/repo/second', false)
      ]
    };

    const placeholder = placeholderGraphForRepository(previous, '/repo/second', [
      '/repo/main',
      '/repo/second'
    ]);

    expect(placeholder?.repoPath).toBe('/repo/second');
    expect(placeholder?.rows.map((row) => [row.sha, row.worktree?.path, row.worktree?.current])).toEqual([
      ['wip:/repo/main', '/repo/main', false],
      ['wip', '/repo/second', true]
    ]);
    expect(placeholderGraphForRepository(previous, '/other', ['/other'])).toBeUndefined();
  });
});

describe('repository query invalidation', () => {
  it('drops cached data for a closed repository without touching other repositories', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['commit-graph', '/repo', 1500], { rows: [] });
    queryClient.setQueryData(['commit-detail', '/repo', 'abc'], { sha: 'abc' });
    queryClient.setQueryData(['commit-graph', '/other', 1500], { rows: [] });

    clearRepositoryQueries(queryClient, '/repo');

    expect(queryClient.getQueryData(['commit-graph', '/repo', 1500])).toBeUndefined();
    expect(queryClient.getQueryData(['commit-detail', '/repo', 'abc'])).toBeUndefined();
    expect(queryClient.getQueryData(['commit-graph', '/other', 1500])).toEqual({ rows: [] });
    queryClient.clear();
  });

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

  it('invalidates WIP review plans without expiring immutable commit reviews', async () => {
    const queryClient = new QueryClient();
    const wipKey = ['review-plan', '/repo', 'wip', 'all'] as const;
    const commitKey = ['review-plan', '/repo', 'commit', 'abc123'] as const;
    queryClient.setQueryData(wipKey, { targetKey: 'wip:all' });
    queryClient.setQueryData(commitKey, { targetKey: 'commit:abc123' });

    await invalidateRepositoryQueries(queryClient, '/repo', ['review-plan']);

    expect(queryClient.getQueryState(wipKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(commitKey)?.isInvalidated).toBe(false);
    queryClient.clear();
  });

  it('refreshes profile-sensitive overview data while reusing a warm graph', async () => {
    const queryClient = new QueryClient();
    const getRepositoryOverview = vi.fn(async () => ({ repoPath: '/repo' }));
    const getCommitGraph = vi.fn(async () => ({ repoPath: '/repo', limit: 1500, rows: [] }));
    vi.stubGlobal('window', {
      api: {
        getRepositoryOverview,
        getCommitGraph
      }
    });
    queryClient.setQueryData(['commit-graph', '/repo', 1500], {
      repoPath: '/repo',
      limit: 1500,
      rows: []
    });

    await prepareRepositoryForProfileTransition(queryClient, '/repo', 1500);

    expect(getRepositoryOverview).toHaveBeenCalledTimes(1);
    expect(getCommitGraph).not.toHaveBeenCalled();
    queryClient.clear();
    vi.unstubAllGlobals();
  });

  it('warms repository data before navigating to a linked worktree', async () => {
    const queryClient = new QueryClient();
    const overview = { repoPath: '/repo-linked' };
    const graph = { repoPath: '/repo-linked', limit: 1500, rows: [] };
    const getRepositoryOverview = vi.fn(async () => overview);
    const getCommitGraph = vi.fn(async () => graph);
    vi.stubGlobal('window', {
      api: {
        getRepositoryOverview,
        getCommitGraph
      }
    });

    await prepareRepositoryForNavigation(queryClient, '/repo-linked', 1500);

    expect(getRepositoryOverview).toHaveBeenCalledWith('/repo-linked');
    expect(getCommitGraph).toHaveBeenCalledWith('/repo-linked', 1500);
    expect(queryClient.getQueryData(repositoryOverviewQueryKey('/repo-linked'))).toEqual(overview);
    expect(queryClient.getQueryData(['commit-graph', '/repo-linked', 1500])).toEqual(graph);
    queryClient.clear();
    vi.unstubAllGlobals();
  });
});

function graphRow(sha: string, path: string, current: boolean) {
  return {
    sha,
    parentShas: [],
    subject: '// WIP',
    author: {
      name: 'Worktree',
      initials: 'W',
      color: '#000000'
    },
    dateLabel: 'now',
    node: {
      lane: 0,
      kind: 'wip' as const
    },
    rails: [],
    worktree: {
      path,
      current
    },
    files: []
  };
}
