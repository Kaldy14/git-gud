import { useEffect } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { CommitGraphPage, GitRepositoryOverview, RepoChangedEvent } from '@shared/types';

export const repositoryOverviewQueryKey = (repoPath: string): readonly ['repository-overview', string] => [
  'repository-overview',
  repoPath
];

export const commitGraphQueryKey = (repoPath: string, limit: number): readonly ['commit-graph', string, number] => [
  'commit-graph',
  repoPath,
  limit
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
  return useQuery({
    queryKey: repoPath ? commitGraphQueryKey(repoPath, limit) : ['commit-graph', 'none', limit],
    queryFn: async (): Promise<CommitGraphPage> => {
      if (!repoPath) {
        throw new Error('Repository path is required.');
      }

      return window.api.getCommitGraph(repoPath, limit);
    },
    enabled: Boolean(repoPath),
    staleTime: 1500,
    placeholderData: (previousData) => previousData
  });
}

export function useRepositoryChangeInvalidation(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    return window.api.onRepositoryChanged((event: RepoChangedEvent) => {
      void queryClient.invalidateQueries({
        queryKey: repositoryOverviewQueryKey(event.repoPath)
      });
      void queryClient.invalidateQueries({
        queryKey: ['commit-graph', event.repoPath]
      });
    });
  }, [queryClient]);
}
