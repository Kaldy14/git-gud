import { useCallback, useEffect, useMemo } from 'react';

import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { isRepositoryUnavailableError } from '@shared/repositoryAvailability';
import type {
  CommitGraphAvatarCandidate,
  CommitGraphPage,
  GitAgentNote,
  GitCommitDetail,
  GitCommitSelectionDetail,
  GitConflictFile,
  GitFileDiff,
  GitFileDiffRequest,
  GitRepositoryOverview,
  GitQueryInvalidation,
  GitReviewPlan,
  GitReviewTarget,
  GitWipDetail,
  RepoChangedEvent
} from '@shared/types';

import {
  commitGraphAvatarCandidates,
  commitGraphAvatarSignature,
  mergeCommitGraphAvatarUrls
} from './commitGraphPaging';

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

const commitGraphAvatarsQueryKey = (
  repoPath: string,
  signature: string
): readonly ['commit-graph-avatars', string, string] => ['commit-graph-avatars', repoPath, signature];

const commitDetailQueryKey = (repoPath: string, sha: string): readonly ['commit-detail', string, string] => [
  'commit-detail',
  repoPath,
  sha
];

const commitSelectionDetailQueryKey = (
  repoPath: string,
  shas: readonly string[]
): readonly ['commit-selection-detail', string, string] => [
  'commit-selection-detail',
  repoPath,
  shas.join('\0')
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
  request.kind === 'commit' ? request.sha : request.kind === 'selection' ? request.shas.join('\0') : undefined,
  request.kind === 'wip' ? request.staged : undefined
];

export const conflictFileQueryKey = (repoPath: string, path: string): readonly ['conflict-file', string, string] => [
  'conflict-file',
  repoPath,
  path
];

export const reviewPlanQueryKey = (
  repoPath: string,
  target: GitReviewTarget
): readonly ['review-plan', string, GitReviewTarget['kind'], string] => [
  'review-plan',
  repoPath,
  target.kind,
  target.kind === 'commit' ? target.sha : target.kind === 'branch' ? `${target.name}\0${target.sha}` : target.scope
];

export const agentNotesQueryKey = (repoPath: string): readonly ['agent-notes', string] => [
  'agent-notes',
  repoPath
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
    retry: shouldRetryRepositoryQuery,
    staleTime: 1500
  });
}

export function useCommitGraph(
  repoPath: string | undefined,
  requestedLimit: number,
  relatedRepoPaths: readonly string[] = [],
  { remoteAvatars = false }: { remoteAvatars?: boolean } = {}
) {
  const queryClient = useQueryClient();
  // Reuse the largest page already cached for this repository, so switching back
  // after a limit reset does not fall back to a cold first page.
  const limit = repoPath ? resolveCommitGraphLimit(queryClient, repoPath, requestedLimit) : requestedLimit;
  const avatarUrls = repoPath && remoteAvatars ? cachedCommitGraphAvatarUrls(queryClient, repoPath) : undefined;
  const selectGraph = useCallback(
    (page: CommitGraphPage) => mergeCommitGraphAvatarUrls(page, avatarUrls),
    [avatarUrls]
  );
  const query = useQuery({
    queryKey: repoPath ? commitGraphQueryKey(repoPath, limit) : ['commit-graph', 'none', limit],
    queryFn: async (): Promise<CommitGraphPage> => {
      if (!repoPath) {
        throw new Error('Repository path is required.');
      }

      return window.api.getCommitGraph(repoPath, limit);
    },
    enabled: Boolean(repoPath),
    retry: shouldRetryRepositoryQuery,
    staleTime: 1500,
    select: selectGraph,
    placeholderData: (previousData) =>
      repoPath ? placeholderGraphForRepository(previousData, repoPath, relatedRepoPaths) : undefined
  });
  const avatarCandidates = useMemo(
    () => (query.data && query.data.repoPath === repoPath ? commitGraphAvatarCandidates(query.data.rows) : []),
    [query.data, repoPath]
  );

  useCommitGraphAvatarUrls(
    repoPath && remoteAvatars && !repoPath.startsWith('github://') ? repoPath : undefined,
    avatarCandidates
  );

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

function useCommitGraphAvatarUrls(
  repoPath: string | undefined,
  candidates: readonly CommitGraphAvatarCandidate[]
): void {
  const queryClient = useQueryClient();
  const signature = commitGraphAvatarSignature(candidates);

  useQuery({
    queryKey: repoPath ? commitGraphAvatarsQueryKey(repoPath, signature) : ['commit-graph-avatars', 'none', ''],
    queryFn: async (): Promise<Record<string, string>> => {
      if (!repoPath) {
        throw new Error('Repository path is required.');
      }

      const avatarUrls = await window.api.getCommitGraphAvatarUrls(repoPath, [...candidates]);
      // Keep authors resolved by earlier pages when a later request returns a subset.
      return { ...cachedCommitGraphAvatarUrls(queryClient, repoPath), ...avatarUrls };
    },
    enabled: Boolean(repoPath) && candidates.length > 0,
    retry: false,
    staleTime: 60_000
  });
}

/** Latest avatar map for a repository, independent of which author set requested it. */
export function cachedCommitGraphAvatarUrls(
  queryClient: QueryClient,
  repoPath: string
): Record<string, string> | undefined {
  let latest: { data: Record<string, string>; updatedAt: number } | undefined;

  for (const query of queryClient.getQueryCache().findAll({ queryKey: ['commit-graph-avatars', repoPath] })) {
    const data = query.state.data as Record<string, string> | undefined;

    if (data && (!latest || query.state.dataUpdatedAt > latest.updatedAt)) {
      latest = { data, updatedAt: query.state.dataUpdatedAt };
    }
  }

  return latest?.data;
}

/** The requested limit, raised to the largest page already cached for the repository. */
export function resolveCommitGraphLimit(queryClient: QueryClient, repoPath: string, requestedLimit: number): number {
  let limit = requestedLimit;

  for (const query of queryClient.getQueryCache().findAll({ queryKey: ['commit-graph', repoPath] })) {
    const cachedLimit = query.queryKey[2];

    if (typeof cachedLimit === 'number' && cachedLimit > limit && query.state.data !== undefined) {
      limit = cachedLimit;
    }
  }

  return limit;
}

/**
 * Loads the next page into the cache without switching the visible query, so the
 * current rows, selection, and scroll position stay intact until it succeeds.
 */
export function fetchCommitGraphPage(
  queryClient: QueryClient,
  repoPath: string,
  limit: number
): Promise<CommitGraphPage> {
  return queryClient.fetchQuery({
    queryKey: commitGraphQueryKey(repoPath, limit),
    queryFn: () => window.api.getCommitGraph(repoPath, limit),
    retry: false,
    staleTime: 1500
  });
}

export function shouldRetryRepositoryQuery(failureCount: number, error: unknown): boolean {
  return failureCount < 3 && !isRepositoryUnavailableError(error);
}

export function placeholderGraphForRepository(
  previousData: CommitGraphPage | undefined,
  repoPath: string,
  relatedRepoPaths: readonly string[]
): CommitGraphPage | undefined {
  if (!previousData || previousData.repoPath === repoPath) {
    return previousData;
  }

  if (!relatedRepoPaths.includes(previousData.repoPath)) {
    return undefined;
  }

  return {
    ...previousData,
    repoPath,
    rows: previousData.rows.map((row) => {
      if (row.node.kind !== 'wip' || !row.worktree) {
        return row;
      }

      const current = row.worktree.path === repoPath;

      return {
        ...row,
        sha: current ? 'wip' : `wip:${row.worktree.path}`,
        worktree: {
          ...row.worktree,
          current
        }
      };
    })
  };
}

export async function prepareLinkedWorktreeGraphTransition(
  queryClient: QueryClient,
  currentGraph: CommitGraphPage | undefined,
  worktreePath: string,
  graphLimit: number
): Promise<void> {
  const targetKey = commitGraphQueryKey(worktreePath, graphLimit);
  const placeholder = placeholderGraphForRepository(
    currentGraph,
    worktreePath,
    currentGraph ? [currentGraph.repoPath, worktreePath] : []
  );

  if (placeholder) {
    queryClient.setQueryData(targetKey, placeholder);
  }

  await invalidateRepositoryQueries(queryClient, worktreePath, currentWorktreeInvalidations);
}

export async function prepareRepositoryForProfileTransition(
  queryClient: QueryClient,
  repoPath: string,
  requestedGraphLimit: number
): Promise<void> {
  const graphLimit = resolveCommitGraphLimit(queryClient, repoPath, requestedGraphLimit);

  await Promise.all([
    queryClient.fetchQuery({
      queryKey: repositoryOverviewQueryKey(repoPath),
      queryFn: () => window.api.getRepositoryOverview(repoPath),
      staleTime: 0
    }),
    queryClient.ensureQueryData({
      queryKey: commitGraphQueryKey(repoPath, graphLimit),
      queryFn: () => window.api.getCommitGraph(repoPath, graphLimit),
      staleTime: 1500
    })
  ]);
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

export function useCommitSelectionDetail(
  repoPath: string | undefined,
  shas: readonly string[]
) {
  return useQuery({
    queryKey:
      repoPath && shas.length > 1
        ? commitSelectionDetailQueryKey(repoPath, shas)
        : ['commit-selection-detail', 'none', 'none'],
    queryFn: async (): Promise<GitCommitSelectionDetail> => {
      if (!repoPath || shas.length < 2) {
        throw new Error('Repository path and at least two commit shas are required.');
      }

      return window.api.getCommitSelectionDetail(repoPath, [...shas]);
    },
    enabled: Boolean(repoPath) && shas.length > 1,
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
    staleTime: request && request.kind !== 'wip' ? immutableGitObjectStaleTime : 1000
  });
}

export function useConflictFile(repoPath: string | undefined, path: string | undefined, enabled = true) {
  return useQuery({
    queryKey: repoPath && path ? conflictFileQueryKey(repoPath, path) : ['conflict-file', 'none', 'none'],
    queryFn: async (): Promise<GitConflictFile> => {
      if (!repoPath || !path) {
        throw new Error('Repository path and conflicted file path are required.');
      }

      return window.api.getConflictFile(repoPath, path);
    },
    enabled: Boolean(repoPath && path) && enabled,
    staleTime: 1000
  });
}

export function useReviewPlan(repoPath: string | undefined, target: GitReviewTarget | undefined) {
  return useQuery({
    queryKey:
      repoPath && target
        ? reviewPlanQueryKey(repoPath, target)
        : ['review-plan', 'none', 'commit', 'none'],
    queryFn: async (): Promise<GitReviewPlan> => {
      if (!repoPath || !target) {
        throw new Error('Repository path and review target are required.');
      }

      return window.api.getReviewPlan(repoPath, target);
    },
    enabled: Boolean(repoPath && target),
    staleTime: target?.kind === 'commit' ? immutableGitObjectStaleTime : 1000
  });
}

export function useAgentNotes(repoPath: string | undefined) {
  const isLocalRepository = Boolean(repoPath && !repoPath.startsWith('github://'));

  return useQuery({
    queryKey: repoPath ? agentNotesQueryKey(repoPath) : ['agent-notes', 'none'],
    queryFn: async (): Promise<GitAgentNote[]> => {
      if (!repoPath) {
        throw new Error('Repository path is required.');
      }

      return window.api.getAgentNotes(repoPath);
    },
    enabled: isLocalRepository,
    staleTime: Number.POSITIVE_INFINITY
  });
}

export function useRepositoryChangeInvalidation(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    return window.api.onRepositoryChanged((event: RepoChangedEvent) => {
      if (event.lastFetchedAt) {
        queryClient.setQueryData<GitRepositoryOverview>(repositoryOverviewQueryKey(event.repoPath),
          (overview) => overview ? { ...overview, lastFetchedAt: event.lastFetchedAt } : undefined);
      }
      void invalidateRepositoryQueries(queryClient, event.repoPath, scopesForRepositoryChange(event), {
        refetchAfterInFlight: Boolean(event.lastFetchedAt) || event.reasons.some((reason) => reason !== 'worktree')
      });
    });
  }, [queryClient]);
}

export async function invalidateRepositoryQueries(
  queryClient: QueryClient,
  repoPath: string,
  scopes: readonly GitQueryInvalidation[] = allRepositoryInvalidations,
  options: { refetchAfterInFlight?: boolean } = {}
): Promise<void> {
  if (scopes.length === 0) return;
  const requested = new Set(scopes);
  const pendingRefReads = options.refetchAfterInFlight
    ? queryClient.getQueryCache().findAll({
        type: 'active',
        fetchStatus: 'fetching',
        predicate: (query) => query.queryKey[1] === repoPath && (
          (requested.has('overview') && query.queryKey[0] === 'repository-overview') ||
          (requested.has('graph') && query.queryKey[0] === 'commit-graph')
        )
      })
    : [];
  const invalidations: Array<Promise<unknown>> = [
    queryClient.invalidateQueries(
      { queryKey: agentNotesQueryKey(repoPath) },
      { cancelRefetch: false }
    )
  ];

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

  if (requested.has('conflict-file')) {
    invalidations.push(
      queryClient.invalidateQueries({ queryKey: ['conflict-file', repoPath] }, { cancelRefetch: false })
    );
  }

  if (requested.has('review-plan')) {
    invalidations.push(
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === 'review-plan' &&
          query.queryKey[1] === repoPath &&
          (query.queryKey[2] === 'branch' || query.queryKey[2] === 'wip')
      }, { cancelRefetch: false })
    );
  }

  await Promise.all(invalidations);

  // An overlapping read can have captured refs before the fetch finished.
  // Let it finish, then load the new refs instead of retaining that old result.
  await Promise.all(pendingRefReads.map((query) => queryClient.invalidateQueries(
    { queryKey: query.queryKey, exact: true }, { cancelRefetch: false }
  )));
}

export function clearRepositoryQueries(queryClient: QueryClient, repoPath: string): void {
  const matchesRepository = (query: { queryKey: readonly unknown[] }): boolean =>
    query.queryKey[1] === repoPath;

  void queryClient.cancelQueries({ predicate: matchesRepository });
  queryClient.removeQueries({ predicate: matchesRepository });
}

const allRepositoryInvalidations: readonly GitQueryInvalidation[] = [
  'overview',
  'graph',
  'wip-detail',
  'file-diff',
  'conflict-file',
  'review-plan'
];

const currentWorktreeInvalidations: readonly GitQueryInvalidation[] = [
  'overview',
  'wip-detail',
  'file-diff',
  'conflict-file',
  'review-plan'
];

export function scopesForRepositoryChange(event: RepoChangedEvent): readonly GitQueryInvalidation[] {
  if (event.invalidates) return event.invalidates;
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

  if (
    hasWorktreeChange &&
    normalizedPaths.length > 0 &&
    event.reasons.every((reason) => reason === 'worktree')
  ) {
    const normalizedRepoPath = event.repoPath
      .replaceAll('\\', '/')
      .toLowerCase()
      .replace(/\/+$/, '');
    const currentPathChanges = normalizedPaths.filter((path) =>
      isPathInsideRepository(path, normalizedRepoPath)
    );

    if (currentPathChanges.length === 0) {
      return ['graph'];
    }

    if (currentPathChanges.length === normalizedPaths.length) {
      return currentWorktreeInvalidations;
    }
  }

  if (hasWorktreeChange || hasIndexOrOperationChange) {
    return allRepositoryInvalidations;
  }

  return ['overview', 'graph'];
}

function isPathInsideRepository(path: string, normalizedRepoPath: string): boolean {
  if (!normalizedRepoPath) {
    return path.startsWith('/');
  }

  return path === normalizedRepoPath || path.startsWith(`${normalizedRepoPath}/`);
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
