import { useQuery, type QueryClient } from '@tanstack/react-query';

import type {
  DashboardState,
  GitHubActionsRuns,
  GitHubActionsRunsInput,
  GitHubPullRequestDetail,
  GitHubPullRequestInbox,
  GitHubPullRequestLocator,
  GitHubRepositorySummary
} from '@shared/types';

export const dashboardsQueryKey = (
  profileId: string
): readonly ['dashboards', string] => ['dashboards', profileId];

export const gitHubRepositoriesQueryKey = (
  profileId: string
): readonly ['github-repositories', string] => ['github-repositories', profileId];

export const gitHubActionsRunsQueryKey = (
  input: GitHubActionsRunsInput
): readonly ['github-actions-runs', string, string, string, number] => [
  'github-actions-runs',
  input.profileId,
  input.owner,
  input.repository,
  input.limit
];

export const gitHubPullRequestInboxQueryKey = (
  profileId: string
): readonly ['github-pull-request-inbox', string] => ['github-pull-request-inbox', profileId];

export const gitHubPullRequestDetailQueryKey = (
  locator: GitHubPullRequestLocator
): readonly ['github-pull-request-detail', string, string, string, number] => [
  'github-pull-request-detail',
  locator.profileId,
  locator.owner,
  locator.repository,
  locator.number
];

export async function refreshGitHubPullRequestInboxAfterMerge(
  queryClient: QueryClient,
  locator: GitHubPullRequestLocator
): Promise<void> {
  const queryKey = gitHubPullRequestInboxQueryKey(locator.profileId);

  await queryClient.refetchQueries({ queryKey, type: 'all' });
  queryClient.setQueryData<GitHubPullRequestInbox>(queryKey, (current) =>
    current
      ? {
          ...current,
          pullRequests: current.pullRequests.filter(
            (pullRequest) =>
              pullRequest.owner !== locator.owner ||
              pullRequest.repository !== locator.repository ||
              pullRequest.number !== locator.number
          )
        }
      : current
  );
}

export function useDashboards(profileId: string | undefined) {
  return useQuery({
    queryKey: profileId ? dashboardsQueryKey(profileId) : ['dashboards', 'none'],
    queryFn: async (): Promise<DashboardState> => {
      if (!profileId) {
        throw new Error('A connected GitHub profile is required.');
      }
      return window.api.getDashboards(profileId);
    },
    enabled: Boolean(profileId),
    staleTime: Number.POSITIVE_INFINITY
  });
}

export function useGitHubRepositories(profileId: string | undefined) {
  return useQuery({
    queryKey: profileId
      ? gitHubRepositoriesQueryKey(profileId)
      : ['github-repositories', 'none'],
    queryFn: async (): Promise<GitHubRepositorySummary[]> => {
      if (!profileId) {
        throw new Error('A connected GitHub profile is required.');
      }
      return window.api.getGitHubRepositories(profileId);
    },
    enabled: Boolean(profileId),
    staleTime: 5 * 60_000
  });
}

export function useGitHubActionsRuns(input: GitHubActionsRunsInput | undefined) {
  return useQuery({
    queryKey: input
      ? gitHubActionsRunsQueryKey(input)
      : ['github-actions-runs', 'none', 'none', 'none', 0],
    queryFn: async (): Promise<GitHubActionsRuns> => {
      if (!input) {
        throw new Error('A GitHub Actions tile configuration is required.');
      }
      return window.api.getGitHubActionsRuns(input);
    },
    enabled: Boolean(input),
    staleTime: 5_000,
    refetchInterval: 15_000
  });
}

export function useGitHubPullRequestInbox(profileId: string | undefined) {
  return useQuery({
    queryKey: profileId
      ? gitHubPullRequestInboxQueryKey(profileId)
      : ['github-pull-request-inbox', 'none'],
    queryFn: async (): Promise<GitHubPullRequestInbox> => {
      if (!profileId) {
        throw new Error('A connected GitHub profile is required.');
      }
      return window.api.getGitHubPullRequestInbox(profileId);
    },
    enabled: Boolean(profileId),
    staleTime: 30_000,
    refetchInterval: 60_000
  });
}

export function useGitHubPullRequestDetail(locator: GitHubPullRequestLocator | undefined) {
  return useQuery({
    queryKey: locator
      ? gitHubPullRequestDetailQueryKey(locator)
      : ['github-pull-request-detail', 'none', 'none', 'none', 0],
    queryFn: async (): Promise<GitHubPullRequestDetail> => {
      if (!locator) {
        throw new Error('A pull request is required.');
      }
      return window.api.getGitHubPullRequestDetail(locator);
    },
    enabled: Boolean(locator),
    staleTime: 15_000
  });
}
