import type { ReactElement } from 'react';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';

import type { GitHubPullRequestSummary } from '@shared/types';

export function PullRequestGuideIndicator({ pullRequest, onOpen }: {
  pullRequest: GitHubPullRequestSummary;
  onOpen: () => void;
}): ReactElement {
  const locator = {
    profileId: pullRequest.profileId,
    owner: pullRequest.owner,
    repository: pullRequest.repository,
    number: pullRequest.number
  };
  const queryClient = useQueryClient();
  const queryKey = ['pull-request-guide-status', locator];
  const mutationKey = ['start-pull-request-guide', locator];
  const isStarting = useIsMutating({ mutationKey }) > 0;
  const query = useQuery({
    queryKey,
    queryFn: () => window.api.getGitHubPullRequestGuideStatus(locator),
    staleTime: 0,
    retry: false,
    refetchIntervalInBackground: true,
    refetchInterval: (current) => current.state.data?.status === 'running' || isStarting ? 1_000 : 15_000
  });
  const generation = useMutation({
    mutationKey,
    mutationFn: async () => {
      // Load only the selected PR, and register its current plan before starting the job.
      const detail = await window.api.getGitHubPullRequestDetail(locator);
      const plan = await window.api.getGitHubPullRequestReviewPlan(locator, detail.headSha);
      await window.api.startGitHubPullRequestReviewGuide(locator, plan.sourceFingerprint);
      return window.api.getGitHubPullRequestGuideStatus(locator);
    },
    onSuccess: (status) => queryClient.setQueryData(queryKey, status)
  });
  const isStale = query.data?.status !== 'idle' && query.data?.headSha &&
    pullRequest.headSha && query.data.headSha !== pullRequest.headSha;
  const status = isStarting ? 'running'
    : generation.isError || query.isError ? 'failed'
      : !query.data ? 'loading'
        : isStale ? 'stale' : query.data.status;
  const error = generation.error?.message ?? query.error?.message ?? query.data?.errorMessage;
  const label = status === 'ready' ? 'AI guide ready. Open guide'
    : status === 'running' ? 'AI guide generating in the background'
      : status === 'loading' ? 'Checking AI guide status'
        : status === 'stale' ? 'AI guide is outdated. Generate an update'
          : status === 'failed' ? `${error || 'AI guide failed'}. Click to retry`
            : 'No AI guide yet. Generate in the background';

  return (
    <button
      className="pr-row-guide"
      type="button"
      data-status={status}
      title={label}
      aria-label={label}
      aria-disabled={status === 'running' || status === 'loading'}
      aria-busy={status === 'running'}
      onClick={(event) => {
        event.stopPropagation();
        if (status === 'running' || status === 'loading') return;
        if (status === 'ready') onOpen();
        else if (query.isError) void query.refetch();
        else generation.mutate();
      }}
    >
      <BookOpen size={14} aria-hidden="true" />
      <span className="pr-row-guide-dot" aria-hidden="true" />
    </button>
  );
}
