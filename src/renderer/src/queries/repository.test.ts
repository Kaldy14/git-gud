import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { repositoryUnavailableErrorMessage } from '@shared/repositoryAvailability';
import type { CommitGraphPage, RepoChangedEvent } from '@shared/types';

import {
  cachedCommitGraphAvatarUrls,
  clearRepositoryQueries,
  fetchCommitGraphPage,
  invalidateRepositoryQueries,
  placeholderGraphForRepository,
  prepareLinkedWorktreeGraphTransition,
  prepareRepositoryForProfileTransition,
  repositoryOverviewQueryKey,
  resolveCommitGraphLimit,
  scopesForRepositoryChange,
  shouldRetryRepositoryQuery,
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
  it('uses the precise main-process fetch scopes, including an unchanged fetch', () => {
    expect(scopesForRepositoryChange(repoChange({ invalidates: [] }))).toEqual([]);
    expect(scopesForRepositoryChange(repoChange({ invalidates: ['overview', 'graph'] }))).toEqual(['overview', 'graph']);
  });
  it('refreshes current WIP data without rebuilding graph history', () => {
    expect(scopesForRepositoryChange(repoChange({}))).toEqual([
      'overview',
      'wip-detail',
      'file-diff',
      'conflict-file',
      'review-plan'
    ]);
  });

  it('refreshes only the graph for a linked-worktree source change', () => {
    expect(
      scopesForRepositoryChange(
        repoChange({
          paths: ['/repo-linked/src/file.ts']
        })
      )
    ).toEqual(['graph']);
  });

  it('refreshes current and linked WIP data when a batch spans both worktrees', () => {
    expect(
      scopesForRepositoryChange(
        repoChange({
          paths: ['/repo/src/current.ts', '/repo-linked/src/linked.ts']
        })
      )
    ).toEqual(['overview', 'graph', 'wip-detail', 'file-diff', 'conflict-file', 'review-plan']);
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

  it('reuses a retargeted graph without reloading shared history', async () => {
    const queryClient = new QueryClient();
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
    let resolveRefresh: (value: typeof previous) => void = () => {};
    const refreshPromise = new Promise<typeof previous>((resolve) => {
      resolveRefresh = resolve;
    });
    const queryFn = vi.fn(() => refreshPromise);
    queryClient.setQueryData(['commit-graph', '/repo/main', 1500], previous);
    queryClient.setQueryData(['commit-graph', '/repo/second', 1500], {
      ...previous,
      repoPath: '/repo/second',
      loadedAt: 'stale',
      rows: []
    });

    await prepareLinkedWorktreeGraphTransition(queryClient, previous, '/repo/second', 1500);

    const observer = new QueryObserver(queryClient, {
      queryKey: ['commit-graph', '/repo/second', 1500],
      queryFn,
      staleTime: 1500
    });
    const unsubscribe = observer.subscribe(() => {});
    const loadingResult = observer.getCurrentResult();

    expect(loadingResult.isLoading).toBe(false);
    expect(loadingResult.isFetching).toBe(false);
    expect(loadingResult.data?.repoPath).toBe('/repo/second');
    expect(loadingResult.data?.rows.map((row) => [row.sha, row.worktree?.current])).toEqual([
      ['wip:/repo/main', false],
      ['wip', true]
    ]);
    expect(queryFn).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(['commit-graph', '/repo/main', 1500])).toBe(previous);

    resolveRefresh({ ...previous, repoPath: '/repo/second', loadedAt: 'fresh' });
    await Promise.resolve();

    unsubscribe();
    queryClient.clear();
  });
});

describe('graph cache selection', () => {
  it('reopens a repository from its largest cached page after the limit resets', () => {
    const queryClient = new QueryClient();
    const cached = graphPage('/repo', 1500);
    const queryFn = vi.fn();
    queryClient.setQueryData(['commit-graph', '/repo', 1500], cached);
    queryClient.setQueryData(['commit-graph', '/other', 3000], graphPage('/other', 3000));
    // A larger page that was requested but never resolved must not be selected.
    queryClient.getQueryCache().build(queryClient, { queryKey: ['commit-graph', '/repo', 4500] });

    const limit = resolveCommitGraphLimit(queryClient, '/repo', 50);
    const observer = new QueryObserver(queryClient, {
      queryKey: ['commit-graph', '/repo', limit],
      queryFn,
      staleTime: 1500
    });
    const unsubscribe = observer.subscribe(() => {});

    expect(limit).toBe(1500);
    expect(observer.getCurrentResult().isLoading).toBe(false);
    expect(observer.getCurrentResult().data).toBe(cached);
    expect(queryFn).not.toHaveBeenCalled();
    expect(resolveCommitGraphLimit(queryClient, '/repo', 6000)).toBe(6000);
    expect(resolveCommitGraphLimit(queryClient, '/new', 50)).toBe(50);
    unsubscribe();
    queryClient.clear();
  });

  it('never shows an unrelated repository while a cold repository loads', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['commit-graph', '/other', 1500], graphPage('/other', 1500));
    let finishLoad: (page: CommitGraphPage) => void = () => {};
    const placeholderData = (previous: CommitGraphPage | undefined) =>
      placeholderGraphForRepository(previous, '/repo', ['/repo']);
    const observer = new QueryObserver<CommitGraphPage, Error, CommitGraphPage, CommitGraphPage, readonly unknown[]>(queryClient, {
      queryKey: ['commit-graph', '/other', 1500],
      queryFn: () => graphPage('/other', 1500),
      staleTime: 1500,
      placeholderData
    });
    const unsubscribe = observer.subscribe(() => {});
    observer.setOptions({
      queryKey: ['commit-graph', '/repo', resolveCommitGraphLimit(queryClient, '/repo', 50)],
      queryFn: () => new Promise<CommitGraphPage>((resolve) => { finishLoad = resolve; }),
      staleTime: 1500,
      placeholderData
    });

    expect(observer.getCurrentResult().data).toBeUndefined();
    expect(observer.getCurrentResult().isLoading).toBe(true);
    finishLoad(graphPage('/repo', 50));
    await vi.waitFor(() => expect(observer.getCurrentResult().data?.repoPath).toBe('/repo'));
    unsubscribe();
    queryClient.clear();
  });

  it('caches a successful next page without replacing the visible page', async () => {
    const queryClient = new QueryClient();
    const visible = graphPage('/repo', 50);
    const next = graphPage('/repo', 1500);
    const getCommitGraph = vi.fn(async () => next);
    vi.stubGlobal('window', { api: { getCommitGraph } });
    queryClient.setQueryData(['commit-graph', '/repo', 50], visible);

    await expect(fetchCommitGraphPage(queryClient, '/repo', 1500)).resolves.toBe(next);

    expect(getCommitGraph).toHaveBeenCalledWith('/repo', 1500);
    expect(queryClient.getQueryData(['commit-graph', '/repo', 50])).toBe(visible);
    expect(resolveCommitGraphLimit(queryClient, '/repo', 50)).toBe(1500);
    queryClient.clear();
    vi.unstubAllGlobals();
  });

  it('reports a failed next page once and keeps the current limit selected', async () => {
    const queryClient = new QueryClient();
    const getCommitGraph = vi.fn(async () => {
      throw new Error('git log failed');
    });
    vi.stubGlobal('window', { api: { getCommitGraph } });
    queryClient.setQueryData(['commit-graph', '/repo', 50], graphPage('/repo', 50));

    await expect(fetchCommitGraphPage(queryClient, '/repo', 1500)).rejects.toThrow('git log failed');

    expect(getCommitGraph).toHaveBeenCalledTimes(1);
    expect(resolveCommitGraphLimit(queryClient, '/repo', 50)).toBe(50);
    queryClient.clear();
    vi.unstubAllGlobals();
  });

  it('shares the newest avatar map per repository and clears it with the repository', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['commit-graph-avatars', '/repo', 'a@example.com'], { 'a@example.com': 'old' });
    vi.useFakeTimers();
    vi.advanceTimersByTime(10);
    const latest = { 'a@example.com': 'new', 'b@example.com': 'b' };
    queryClient.setQueryData(['commit-graph-avatars', '/repo', 'a@example.com\nb@example.com'], latest);
    vi.useRealTimers();
    queryClient.setQueryData(['commit-graph-avatars', '/other', 'c@example.com'], { 'c@example.com': 'c' });

    expect(cachedCommitGraphAvatarUrls(queryClient, '/repo')).toBe(latest);
    clearRepositoryQueries(queryClient, '/repo');
    expect(cachedCommitGraphAvatarUrls(queryClient, '/repo')).toBeUndefined();
    expect(cachedCommitGraphAvatarUrls(queryClient, '/other')).toEqual({ 'c@example.com': 'c' });
    queryClient.clear();
  });
});

describe('repository query invalidation', () => {
  it.each([false, true])('loads fresh refs when a background fetch overlaps history (cached: %s)', async (cached) => {
    const queryClient = new QueryClient();
    const key = ['commit-graph', '/repo', 1500];
    const oldGraph = { refs: ['origin/main:old'] };
    const newGraph = { refs: ['origin/main:new'] };
    if (cached) queryClient.setQueryData(key, oldGraph);
    let finishOldRead: (value: typeof oldGraph) => void = () => {};
    const pendingRead = new Promise<typeof oldGraph>((resolve) => { finishOldRead = resolve; });
    const queryFn = vi.fn().mockReturnValueOnce(pendingRead).mockResolvedValue(newGraph);
    const observer = new QueryObserver(queryClient, { queryKey: key, queryFn, staleTime: 0 });
    const unsubscribe = observer.subscribe(() => {});
    const refresh = invalidateRepositoryQueries(queryClient, '/repo', ['graph'], { refetchAfterInFlight: true });
    finishOldRead(oldGraph);
    await refresh;
    expect(queryClient.getQueryData(key)).toEqual(newGraph);
    unsubscribe();
    queryClient.clear();
  });

  it('does not invalidate any caches for an unchanged fetch', async () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await invalidateRepositoryQueries(queryClient, '/repo', []);
    expect(invalidate).not.toHaveBeenCalled();
    queryClient.clear();
  });
  it('does not retry a repository whose working directory disappeared', () => {
    expect(
      shouldRetryRepositoryQuery(
        0,
        new Error(
          `Error invoking remote method 'repo:overview': Error: ${repositoryUnavailableErrorMessage('/repo-linked')}`
        )
      )
    ).toBe(false);
    expect(shouldRetryRepositoryQuery(0, new Error('temporary failure'))).toBe(true);
    expect(shouldRetryRepositoryQuery(3, new Error('temporary failure'))).toBe(false);
  });

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

  it('invalidates branch and WIP review plans without expiring immutable commit reviews', async () => {
    const queryClient = new QueryClient();
    const wipKey = ['review-plan', '/repo', 'wip', 'all'] as const;
    const branchKey = ['review-plan', '/repo', 'branch', 'feature/review-all\u0000abc123'] as const;
    const commitKey = ['review-plan', '/repo', 'commit', 'abc123'] as const;
    queryClient.setQueryData(wipKey, { targetKey: 'wip:all' });
    queryClient.setQueryData(branchKey, { targetKey: 'branch:feature/review-all' });
    queryClient.setQueryData(commitKey, { targetKey: 'commit:abc123' });

    await invalidateRepositoryQueries(queryClient, '/repo', ['review-plan']);

    expect(queryClient.getQueryState(wipKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(branchKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(commitKey)?.isInvalidated).toBe(false);
    queryClient.clear();
  });

  it('reuses a larger warm graph when a profile transition requests the first page', async () => {
    const queryClient = new QueryClient();
    const getCommitGraph = vi.fn();
    vi.stubGlobal('window', {
      api: { getRepositoryOverview: vi.fn(async () => ({ repoPath: '/repo' })), getCommitGraph }
    });
    queryClient.setQueryData(['commit-graph', '/repo', 3000], graphPage('/repo', 3000));

    await prepareRepositoryForProfileTransition(queryClient, '/repo', 50);

    expect(getCommitGraph).not.toHaveBeenCalled();
    queryClient.clear();
    vi.unstubAllGlobals();
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

function graphPage(repoPath: string, limit: number): CommitGraphPage {
  return {
    repoPath,
    loadedAt: '2026-10-04T10:00:00.000Z',
    limit,
    loadedCommitCount: limit,
    hasMore: true,
    nextLimit: limit + 1500,
    rows: []
  };
}
