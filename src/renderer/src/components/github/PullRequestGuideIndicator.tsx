import type { ReactElement } from 'react';
import { useState } from 'react';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Route } from 'lucide-react';
import { Tooltip } from 'radix-ui';

import type { GitHubPullRequestSummary } from '@shared/types';
import { pullRequestLocator, pullRequestTourQueryKey, startPullRequestTour, startPullRequestTourMutationKey } from './tour/pullRequestTourQuery';
import { BackgroundJobConfirm } from './BackgroundJobConfirm';
import { announce } from '../../lib/announce';

export function PullRequestGuideIndicator({ pullRequest, onOpen }: {
  pullRequest: GitHubPullRequestSummary;
  onOpen: () => void;
}): ReactElement {
  const locator = pullRequestLocator(pullRequest);
  const queryClient = useQueryClient();
  const queryKey = pullRequestTourQueryKey(locator);
  const mutationKey = startPullRequestTourMutationKey(locator);
  const isStarting = useIsMutating({ mutationKey }) > 0;
  // The same tour the pull request's Tour tab shows; polled quickly only while it is being written.
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
      const plan = await window.api.getGitHubPullRequestReviewPlan(locator, detail.headSha, detail.baseSha);
      return startPullRequestTour(detail, plan.sourceFingerprint);
    },
    onSuccess: (state) => queryClient.setQueryData(queryKey, state)
  });
  const [isConfirming, setIsConfirming] = useState(false);
  const state = query.data;
  // A failed rewrite must not hide an existing tour: report failure only when there is none.
  // A tour stored in an older format counts as outdated: it offers to write it again.
  const status = isStarting || state?.running ? 'running'
    : query.isError ? 'failed'
      : !state ? 'loading'
        : !state.tour ? (generation.isError || state.errorMessage ? 'failed' : state.outdatedFormat ? 'stale' : 'idle')
          : pullRequest.headSha && state.tour.headSha !== pullRequest.headSha ? 'stale' : 'ready';
  const error = generation.error?.message ?? query.error?.message ?? state?.errorMessage;
  const label = status === 'ready' ? 'Tour ready. Open tour'
    : status === 'running' ? 'Writing a tour in the background'
      : status === 'loading' ? 'Checking tour status'
        : status === 'stale' ? (state?.tour ? 'Tour was written before the latest push. Write an update' : 'Tour was written in an older format. Write it again')
          : status === 'failed' ? `${error || 'The tour could not be written'}. Retry`
            : 'No tour yet. Write one in the background';
  const start = () => {
    generation.mutate();
    announce(`Writing a tour for #${pullRequest.number}`);
  };

  return (
    <BackgroundJobConfirm
      open={isConfirming}
      onOpenChange={setIsConfirming}
      title={status === 'stale' ? 'Write the tour again?' : status === 'failed' ? 'Retry the tour?' : 'Write a tour?'}
      detail="Reads the change with AI and writes a tour of it. Takes a few minutes and runs in the background."
      actionLabel={status === 'idle' ? 'Write tour' : 'Rewrite tour'}
      onConfirm={start}
    >
    <span className="pr-row-job">
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
              else setIsConfirming(true);
            }}
          >
            <Route size={14} aria-hidden="true" />
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
    </span>
    </BackgroundJobConfirm>
  );
}
