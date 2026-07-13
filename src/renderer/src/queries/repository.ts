import { useEffect } from 'react';

import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import type {
  CommitGraphPage,
  GitCommitDetail,
  GitFileDiff,
  GitFileDiffRequest,
  GitRepositoryOverview,
  GitQueryInvalidation,
  GitWipDetail,
  RepoChangedEvent
} from '@shared/types';

const immutableGitObjectStaleTime = Number.POSITIVE_INFINITY;

export const repositoryOverviewQueryKey = (repoPath: string): readonly ['repository-overview', string] => [
  'repository-overview',
  repoPath
];

const commitGraphQueryKey = (repoPath: string, limit: number): readonly ['commit-graph', string, number] => [
  'commit-graph',
  repoPath,
  limit
];

const commitDetailQueryKey = (repoPath: string, sha: string): readonly ['commit-detail', string, string] => [
  'commit-detail',
  repoPath,
  sha
];

const wipDetailQueryKey = (repoPath: string): readonly ['wip-detail', string] => ['wip-detail', repoPath];

const fileDiffQueryKey = (
  repoPath: string,
  request: GitFileDiffRequest
): readonly ['file-diff', string, string, string, string | undefined, boolean | undefined] => [
  'file-diff',
  repoPath,
  request.kind,
  request.path,
  request.kind === 'commit' ? request.sha : undefined,
  request.kind === 'wip' ? request.staged : undefined
];

export function useRepositoryOverview(repoPath: string | undefined) {
  return useQuery({
    queryKey: repoPath ? repositoryOverviewQueryKey(repoPath) : ['repository-overview', 'none'],
    queryFn: async (): Promise<GitRepositoryOverview> => {
      if (!repoPath) {
        throw new Error('Repository path is required.');
      }

      return window.api.getRepositoryOverview(repoPath);
    },
    enabled: Boolean(repoPath),
    staleTime: 1500
  });
}

export function useCommitGraph(repoPath: string | undefined, limit: number) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: repoPath ? commitGraphQueryKey(repoPath, limit) : ['commit-graph', 'none', limit],
    queryFn: async (): Promise<CommitGraphPage> => {
      if (!repoPath) {
        throw new Error('Repository path is required.');
      }

      return window.api.getCommitGraph(repoPath, limit);
    },
    enabled: Boolean(repoPath),
    staleTime: 1500,
    // Keep current rows on screen while load-more fetches a larger page, but never
    // carry one repository's graph over into another tab.
    placeholderData: (previousData) => (previousData?.repoPath === repoPath ? previousData : undefined)
  });

  useEffect(() => {
    const loadedLimit = query.data?.limit;

    if (!repoPath || !shouldPruneLowerGraphQueries(limit, loadedLimit, query.isPlaceholderData)) {
      return;
    }

    queryClient.removeQueries({
      predicate: (candidate) => isLowerLimitCommitGraphQuery(candidate.queryKey, repoPath, loadedLimit)
    });
  }, [limit, query.data?.limit, query.isPlaceholderData, queryClient, repoPath]);

  return query;
}

export function useCommitDetail(repoPath: string | undefined, sha: string | undefined) {
  return useQuery({
    queryKey: repoPath && sha ? commitDetailQueryKey(repoPath, sha) : ['commit-detail', 'none', 'none'],
    queryFn: async (): Promise<GitCommitDetail> => {
      if (!repoPath || !sha) {
        throw new Error('Repository path and commit sha are required.');
      }

      return window.api.getCommitDetail(repoPath, sha);
    },
    enabled: Boolean(repoPath && sha),
    staleTime: immutableGitObjectStaleTime
  });
}

export function useWipDetail(repoPath: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: repoPath ? wipDetailQueryKey(repoPath) : ['wip-detail', 'none'],
    queryFn: async (): Promise<GitWipDetail> => {
      if (!repoPath) {
        throw new Error('Repository path is required.');
      }

      return window.api.getWipDetail(repoPath);
    },
    enabled: Boolean(repoPath) && enabled,
    staleTime: 1000
  });
}

export function useFileDiff(repoPath: string | undefined, request: GitFileDiffRequest | undefined) {
  return useQuery({
    queryKey: repoPath && request ? fileDiffQueryKey(repoPath, request) : ['file-diff', 'none', 'none', 'none', undefined, undefined],
    queryFn: async (): Promise<GitFileDiff> => {
      if (!repoPath || !request) {
        throw new Error('Repository path and file diff request are required.');
      }

      return window.api.getFileDiff(repoPath, request);
    },
    enabled: Boolean(repoPath && request),
    staleTime: request?.kind === 'commit' ? immutableGitObjectStaleTime : 1000
  });
}

export function useRepositoryChangeInvalidation(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    return window.api.onRepositoryChanged((event: RepoChangedEvent) => {
      void invalidateRepositoryQueries(queryClient, event.repoPath, scopesForRepositoryChange(event));
    });
  }, [queryClient]);
}

export async function invalidateRepositoryQueries(
  queryClient: QueryClient,
  repoPath: string,
  scopes: readonly GitQueryInvalidation[] = allRepositoryInvalidations
): Promise<void> {
  const requested = new Set(scopes);
  const invalidations: Array<Promise<unknown>> = [];

  if (requested.has('overview')) {
    invalidations.push(
      queryClient.invalidateQueries({ queryKey: repositoryOverviewQueryKey(repoPath) }, { cancelRefetch: false })
    );
  }

  if (requested.has('graph')) {
    invalidations.push(
      queryClient.invalidateQueries({ queryKey: ['commit-graph', repoPath] }, { cancelRefetch: false })
    );
  }

  if (requested.has('wip-detail')) {
    invalidations.push(
      queryClient.invalidateQueries({ queryKey: wipDetailQueryKey(repoPath) }, { cancelRefetch: false })
    );
  }

  if (requested.has('file-diff')) {
    invalidations.push(
      queryClient.invalidateQueries({ queryKey: ['file-diff', repoPath, 'wip'] }, { cancelRefetch: false })
    );
  }

  await Promise.all(invalidations);
}

const allRepositoryInvalidations: readonly GitQueryInvalidation[] = [
  'overview',
  'graph',
  'wip-detail',
  'file-diff'
];

export function scopesForRepositoryChange(event: RepoChangedEvent): readonly GitQueryInvalidation[] {
  const normalizedPaths = event.paths.map((path) => path.replaceAll('\\', '/').toLowerCase());
  const hasWorktreeChange = event.reasons.includes('worktree');
  const hasRefChange = normalizedPaths.some(
    (path) =>
      path.includes('/refs/') ||
      path.includes('/logs/refs/') ||
      path.endsWith('/head') ||
      path.endsWith('/packed-refs') ||
      path.endsWith('/fetch_head')
  );
  const hasIndexOrOperationChange = normalizedPaths.some(
    (path) =>
      path.endsWith('/index') ||
      path.endsWith('/merge_head') ||
      path.endsWith('/cherry_pick_head') ||
      path.endsWith('/revert_head') ||
      path.includes('/rebase-merge/') ||
      path.includes('/rebase-apply/')
  );

  if (hasRefChange) {
    return allRepositoryInvalidations;
  }

  if (hasWorktreeChange || hasIndexOrOperationChange) {
    return ['overview', 'graph', 'wip-detail', 'file-diff'];
  }

  return ['overview', 'graph'];
}

function isLowerLimitCommitGraphQuery(queryKey: readonly unknown[], repoPath: string, loadedLimit: number): boolean {
  return (
    queryKey[0] === 'commit-graph' &&
    queryKey[1] === repoPath &&
    typeof queryKey[2] === 'number' &&
    queryKey[2] < loadedLimit
  );
}

export function shouldPruneLowerGraphQueries(
  requestedLimit: number,
  loadedLimit: number | undefined,
  isPlaceholderData: boolean
): loadedLimit is number {
  return !isPlaceholderData && typeof loadedLimit === 'number' && loadedLimit === requestedLimit;
}
