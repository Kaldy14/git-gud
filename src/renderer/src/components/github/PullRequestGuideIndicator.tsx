import type { ReactElement } from 'react';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { Tooltip } from 'radix-ui';

import type { GitHubPullRequestSummary } from '@shared/types';
import { pullRequestLocator, pullRequestTourQueryKey, startPullRequestTour } from './guide/pullRequestTourQuery';

export function PullRequestGuideIndicator({ pullRequest, onOpen }: {
  pullRequest: GitHubPullRequestSummary;
  onOpen: () => void;
}): ReactElement {
  const locator = pullRequestLocator(pullRequest);
  const queryClient = useQueryClient();
  const queryKey = pullRequestTourQueryKey(locator);
  const mutationKey = ['start-pull-request-tour', ...queryKey];
  const isStarting = useIsMutating({ mutationKey }) > 0;
  // The same Guide the pull request's Guide tab shows; polled quickly only while it is being written.
  const query = useQuery({
    queryKey,
    queryFn: () => window.api.getGitHubPullRequestTourState(locator),
    staleTime: 0,
    retry: false,
    refetchIntervalInBackground: true,
    refetchInterval: (current) => current.state.data?.running || isStarting ? 3_000 : 15_000
  });
  const generation = useMutation({
    mutationKey,
    mutationFn: async () => {
      // Load only the selected PR, and register its current plan before starting the job.
      const detail = await window.api.getGitHubPullRequestDetail(locator);
      const plan = await window.api.getGitHubPullRequestReviewPlan(locator, detail.headSha);
      return startPullRequestTour(detail, plan.sourceFingerprint);
    },
    onSuccess: (state) => queryClient.setQueryData(queryKey, state)
  });
  const state = query.data;
  const status = isStarting || state?.running ? 'running'
    : generation.isError || query.isError || state?.errorMessage ? 'failed'
      : !state ? 'loading'
        : !state.tour ? 'idle'
          : pullRequest.headSha && state.tour.headSha !== pullRequest.headSha ? 'stale' : 'ready';
  const error = generation.error?.message ?? query.error?.message ?? state?.errorMessage;
  const label = status === 'ready' ? 'Review guide ready. Open guide'
    : status === 'running' ? 'Writing a review guide in the background'
      : status === 'loading' ? 'Checking review guide status'
        : status === 'stale' ? 'Review guide was written before the latest push. Write an update'
          : status === 'failed' ? `${error || 'The review guide could not be written'}. Click to retry`
            : 'No review guide yet. Write one in the background';

  return (
    <Tooltip.Provider delayDuration={350}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            className="pr-row-guide"
            type="button"
            data-status={status}
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
            <span
              className="pr-row-guide-dot"
              aria-hidden="true"
              onAnimationStart={(event) => {
                // Share the document timeline, including late rows and motion preference changes.
                for (const animation of event.currentTarget.getAnimations({ subtree: true })) {
                  animation.startTime = 0;
                }
              }}
            />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="pr-row-guide-tooltip" side="top" sideOffset={8} collisionPadding={12}>
            {label}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
