import { useEffect } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { GitRepositoryOverview, RepoChangedEvent } from '@shared/types';

export const repositoryOverviewQueryKey = (repoPath: string): readonly ['repository-overview', string] => [
  'repository-overview',
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
    staleTime: 1500
  });
}

export function useRepositoryChangeInvalidation(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    return window.api.onRepositoryChanged((event: RepoChangedEvent) => {
      void queryClient.invalidateQueries({
        queryKey: repositoryOverviewQueryKey(event.repoPath)
      });
    });
  }, [queryClient]);
}
