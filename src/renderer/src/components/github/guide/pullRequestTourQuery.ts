import { settledReviewSummary } from '@shared/pullRequestTour';
import type { GitHubPullRequestDetail, GitHubPullRequestLocator } from '@shared/types';

// One cache entry per pull request, shared by the inbox guide button and the Guide tab.
export function pullRequestTourQueryKey(locator: GitHubPullRequestLocator) {
  return ['github-pull-request-tour', locator.profileId, locator.owner, locator.repository, locator.number] as const;
}

export function pullRequestLocator(pullRequest: GitHubPullRequestLocator): GitHubPullRequestLocator {
  return { profileId: pullRequest.profileId, owner: pullRequest.owner, repository: pullRequest.repository, number: pullRequest.number };
}

// Starts writing a guide for the loaded head; the plan fingerprint ties it to the diff it describes.
export function startPullRequestTour(detail: GitHubPullRequestDetail, sourceFingerprint = detail.reviewPlan.sourceFingerprint) {
  return window.api.startGitHubPullRequestTour(pullRequestLocator(detail), sourceFingerprint, detail.headSha, {
    body: detail.body,
    baseRefName: detail.baseRefName,
    settledReview: settledReviewSummary(detail.reviewComments)
  });
}
