import type { GitHubPullRequestSummary } from '@shared/types';

export type PullRequestInboxStatus = {
  label: string;
  tone: 'success' | 'danger' | 'pending';
  icon: 'check' | 'dot' | 'warning';
};

export function hasPullRequestMergeConflicts(
  pullRequest: GitHubPullRequestSummary
): boolean {
  return pullRequest.mergeable === 'conflicting' || pullRequest.mergeState === 'dirty';
}

export function pullRequestStatus(
  pullRequest: GitHubPullRequestSummary
): PullRequestInboxStatus {
  if (pullRequest.isDraft) {
    return { label: 'Draft', tone: 'pending', icon: 'dot' };
  }
  if (hasPullRequestMergeConflicts(pullRequest)) {
    return { label: 'Merge conflicts', tone: 'danger', icon: 'warning' };
  }
  const reviewStatus = pullRequestReviewStatus(pullRequest);
  if (reviewStatus.tone === 'danger') {
    return reviewStatus;
  }
  if (pullRequest.checks.state === 'failure' || pullRequest.checks.state === 'error') {
    return { label: 'Checks failing', tone: 'danger', icon: 'warning' };
  }
  return reviewStatus;
}

export function pullRequestReviewStatus(
  pullRequest: GitHubPullRequestSummary
): PullRequestInboxStatus {
  const hasChangesRequested =
    pullRequest.reviewDecision === 'changes-requested' ||
    pullRequest.reviewers.some((reviewer) => reviewer.state === 'changes-requested');

  if (hasChangesRequested) {
    return { label: 'Changes requested', tone: 'danger', icon: 'warning' };
  }

  const checksSatisfied =
    pullRequest.checks.total === 0 || pullRequest.checks.state === 'success';
  const isReadyToMerge =
    pullRequest.reviewDecision !== 'review-required' &&
    pullRequest.mergeable === 'mergeable' &&
    pullRequest.mergeState === 'clean' &&
    checksSatisfied;

  if (isReadyToMerge) {
    return { label: 'Ready to merge', tone: 'success', icon: 'check' };
  }

  if (pullRequest.reviewDecision === 'approved') {
    return { label: 'Approved', tone: 'success', icon: 'check' };
  }

  if (pullRequest.reviewers.some((reviewer) => reviewer.state === 'pending')) {
    return { label: 'Awaiting review', tone: 'pending', icon: 'dot' };
  }

  if (pullRequest.reviewDecision === 'review-required') {
    return { label: 'Awaiting approval', tone: 'pending', icon: 'dot' };
  }

  if (pullRequest.mergeState === 'blocked') {
    return { label: 'Blocked by branch rules', tone: 'pending', icon: 'dot' };
  }

  return { label: 'Review status unknown', tone: 'pending', icon: 'dot' };
}
