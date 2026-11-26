import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { settledReviewSummary } from '@shared/pullRequestTour';
import type { GitHubPullRequestDetail, GitHubPullRequestLocator } from '@shared/types';

// One cache entry per pull request, shared by the inbox tour button, Overview and the Tour tab.
export function pullRequestTourQueryKey(locator: GitHubPullRequestLocator) {
  return ['github-pull-request-tour', locator.profileId, locator.owner, locator.repository, locator.number] as const;
}

// The inbox button and the Tour tab start the same job; sharing the key lets both show it running.
export function startPullRequestTourMutationKey(locator: GitHubPullRequestLocator) {
  return ['start-pull-request-tour', ...pullRequestTourQueryKey(locator)] as const;
}

export function pullRequestLocator(pullRequest: GitHubPullRequestLocator): GitHubPullRequestLocator {
  return { profileId: pullRequest.profileId, owner: pullRequest.owner, repository: pullRequest.repository, number: pullRequest.number };
}

// Starts writing a tour for the loaded head; the plan fingerprint ties it to the diff it describes.
export function startPullRequestTour(detail: GitHubPullRequestDetail, sourceFingerprint = detail.reviewPlan.sourceFingerprint) {
  return window.api.startGitHubPullRequestTour(pullRequestLocator(detail), sourceFingerprint, detail.headSha, {
    body: detail.body,
    baseRefName: detail.baseRefName,
    baseSha: detail.baseSha,
    settledReview: settledReviewSummary(detail.reviewComments)
  });
}

/**
 * The open pull request's tour: the stored one (possibly written for an older head), whether a run is
 * writing one, and the last failure. `write` starts a run; callers confirm first (AI never starts from
 * one click).
 */
export function usePullRequestTour(detail: GitHubPullRequestDetail) {
  const queryClient = useQueryClient();
  const queryKey = pullRequestTourQueryKey(detail);
  const query = useQuery({
    queryKey,
    queryFn: () => window.api.getGitHubPullRequestTourState(pullRequestLocator(detail)),
    // Writing takes minutes; poll only while a run is in progress.
    refetchInterval: (current) => (current.state.data?.running ? 3_000 : false)
  });
  const write = useMutation({
    mutationKey: startPullRequestTourMutationKey(detail),
    mutationFn: () => startPullRequestTour(detail),
    onSuccess: (state) => queryClient.setQueryData(queryKey, state)
  });
  const tour = query.data?.tour ?? null;
  return {
    isLoading: query.isPending,
    tour,
    // False when the tour was written before the latest push, or for another base (a retarget keeps the
    // head but changes the diff): its line numbers may have moved.
    isCurrent: tour !== null && tour.headSha === detail.headSha && (tour.baseSha === undefined || tour.baseSha === detail.baseSha),
    running: Boolean(query.data?.running) || write.isPending,
    failure: query.data?.errorMessage ?? (write.error instanceof Error ? write.error.message : undefined),
    // A tour is stored in a format this version no longer shows.
    outdatedFormat: query.data?.outdatedFormat === true,
    write: () => write.mutate()
  };
}

export type PullRequestTourQueryState = ReturnType<typeof usePullRequestTour>;
