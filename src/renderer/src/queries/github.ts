import { useQuery } from '@tanstack/react-query';

import type {
  GitHubPullRequestDetail,
  GitHubPullRequestInbox,
  GitHubPullRequestLocator
} from '@shared/types';

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
