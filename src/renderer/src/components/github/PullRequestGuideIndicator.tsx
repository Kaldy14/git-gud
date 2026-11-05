import type { ReactElement } from 'react';
import { useState } from 'react';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { Tooltip } from 'radix-ui';

import type { GitHubPullRequestSummary } from '@shared/types';
import { pullRequestLocator, pullRequestTourQueryKey, startPullRequestTour } from './guide/pullRequestTourQuery';
import { BackgroundJobConfirm } from './BackgroundJobConfirm';
import { announce } from '../../lib/announce';

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
  const [isConfirming, setIsConfirming] = useState(false);
  const state = query.data;
  // A failed rewrite must not hide an existing guide: report failure only when there is none.
  const status = isStarting || state?.running ? 'running'
    : query.isError ? 'failed'
      : !state ? 'loading'
        : !state.tour ? (generation.isError || state.errorMessage ? 'failed' : 'idle')
          : pullRequest.headSha && state.tour.headSha !== pullRequest.headSha ? 'stale' : 'ready';
  const error = generation.error?.message ?? query.error?.message ?? state?.errorMessage;
  const label = status === 'ready' ? 'Review guide ready. Open guide'
    : status === 'running' ? 'Writing a review guide in the background'
      : status === 'loading' ? 'Checking review guide status'
        : status === 'stale' ? 'Review guide was written before the latest push. Write an update'
          : status === 'failed' ? `${error || 'The review guide could not be written'}. Retry`
            : 'No review guide yet. Write one in the background';
  // Visible state beside the icon; idle stays icon-only so quiet rows stay quiet.
  const shortLabel = status === 'ready' ? 'Guide' : status === 'running' ? 'Writing' : status === 'stale' ? 'Outdated' : status === 'failed' ? 'Failed' : '';
  const start = () => {
    generation.mutate();
    announce(`Writing a review guide for #${pullRequest.number}`);
  };

  return (
    <BackgroundJobConfirm
      open={isConfirming}
      onOpenChange={setIsConfirming}
      title={status === 'stale' ? 'Update the review guide?' : status === 'failed' ? 'Retry the review guide?' : 'Write a review guide?'}
      detail="Reads the change with AI and writes a tour of it. Takes a few minutes and runs in the background."
      actionLabel={status === 'idle' ? 'Write guide' : 'Rewrite guide'}
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
            <BookOpen size={14} aria-hidden="true" />
            {shortLabel ? <span className="pr-row-job-label" aria-hidden="true">{shortLabel}</span> : null}
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
