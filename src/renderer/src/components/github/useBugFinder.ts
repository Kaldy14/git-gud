import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BugFinderRequest } from '@shared/bugFinder';
import type { GitHubPullRequestLocator } from '@shared/types';

export function useBugFinder(locator: GitHubPullRequestLocator, active = false) {
  const client = useQueryClient();
  const target = {
    profileId: locator.profileId,
    owner: locator.owner,
    repository: locator.repository,
    number: locator.number
  };
  const key = [
    'bug-finder',
    locator.profileId,
    locator.owner,
    locator.repository,
    locator.number
  ];
  const query = useQuery({
    queryKey: key,
    queryFn: () => window.api.bugFinder({ locator: target, action: 'get' }),
    refetchInterval: (query) => query.state.data?.state.status === 'running' ? 1000 : active ? 2000 : 15000,
    refetchIntervalInBackground: true,
    retry: false
  });
  const mutation = useMutation({
    mutationKey: [...key, 'write'],
    mutationFn: (input: Omit<BugFinderRequest, 'locator'>) =>
      window.api.bugFinder({ ...input, locator: target }),
    onSuccess: (result) => client.setQueryData(key, result)
  });
  return { query, mutation, state: query.data?.state };
}
