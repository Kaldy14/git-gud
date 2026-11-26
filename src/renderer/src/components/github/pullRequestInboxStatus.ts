import type { GitHubPullRequestSummary } from '@shared/types';

/**
 * One glyph per state, so a status is recognisable before its label is read. `PullRequestStatusIcon`
 * draws them; `warning`, `dot` and `running` are the generic ones the merge verdict falls back to.
 */
export type PullRequestStatusIconName =
  | 'check' | 'approved' | 'merge' | 'closed' | 'draft' | 'conflict' | 'failing' | 'changes'
  | 'review' | 'waiting' | 'blocked' | 'running' | 'warning' | 'dot';

// pending = in progress (blue), warning = blocked on something, muted = no signal.
export type PullRequestInboxStatus = {
  label: string;
  tone: 'success' | 'danger' | 'pending' | 'warning' | 'muted' | 'merged';
  icon: PullRequestStatusIconName;
};

// Shared with the merge verdict (Overview and the detail header), so one state always reads the same.
export const PULL_REQUEST_STATUS_LABELS = {
  merged: 'Merged',
  closed: 'Closed',
  conflicts: 'Merge conflicts',
  draft: 'Draft',
  changesRequested: 'Changes requested',
  checksFailing: 'Checks failing',
  readyToMerge: 'Ready to merge',
  approved: 'Approved',
  awaitingReview: 'Awaiting review',
  awaitingApproval: 'Awaiting approval',
  blockedByRules: 'Blocked by branch rules',
  reviewUnknown: 'Review status unknown'
} as const;

export function hasPullRequestMergeConflicts(
  pullRequest: GitHubPullRequestSummary
): boolean {
  return pullRequest.mergeable === 'conflicting' || pullRequest.mergeState === 'dirty';
}

export function pullRequestStatus(
  pullRequest: GitHubPullRequestSummary
): PullRequestInboxStatus {
  if (pullRequest.state === 'merged') {
    // Merged is a fact, not a passing check, so it does not share the success tone.
    return { label: PULL_REQUEST_STATUS_LABELS.merged, tone: 'merged', icon: 'merge' };
  }
  if (pullRequest.state === 'closed') {
    return { label: PULL_REQUEST_STATUS_LABELS.closed, tone: 'muted', icon: 'closed' };
  }
  // Conflicts outrank Draft: drafts are already grouped and chipped separately,
  // while a hidden conflict is work the author does not know about.
  if (hasPullRequestMergeConflicts(pullRequest)) {
    return { label: PULL_REQUEST_STATUS_LABELS.conflicts, tone: 'danger', icon: 'conflict' };
  }
  if (pullRequest.isDraft) {
    return { label: PULL_REQUEST_STATUS_LABELS.draft, tone: 'muted', icon: 'draft' };
  }
  const reviewStatus = pullRequestReviewStatus(pullRequest);
  if (reviewStatus.tone === 'danger') {
    return reviewStatus;
  }
  if (pullRequest.checks.state === 'failure' || pullRequest.checks.state === 'error') {
    return { label: PULL_REQUEST_STATUS_LABELS.checksFailing, tone: 'danger', icon: 'failing' };
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
    return { label: PULL_REQUEST_STATUS_LABELS.changesRequested, tone: 'danger', icon: 'changes' };
  }

  const checksSatisfied =
    pullRequest.checks.total === 0 || pullRequest.checks.state === 'success';
  const isReadyToMerge =
    pullRequest.reviewDecision !== 'review-required' &&
    pullRequest.mergeable === 'mergeable' &&
    pullRequest.mergeState === 'clean' &&
    checksSatisfied;

  if (isReadyToMerge) {
    return { label: PULL_REQUEST_STATUS_LABELS.readyToMerge, tone: 'success', icon: 'check' };
  }

  if (pullRequest.reviewDecision === 'approved') {
    return { label: PULL_REQUEST_STATUS_LABELS.approved, tone: 'success', icon: 'approved' };
  }

  if (pullRequest.reviewers.some((reviewer) => reviewer.state === 'pending')) {
    return { label: PULL_REQUEST_STATUS_LABELS.awaitingReview, tone: 'pending', icon: 'review' };
  }

  if (pullRequest.reviewDecision === 'review-required') {
    return { label: PULL_REQUEST_STATUS_LABELS.awaitingApproval, tone: 'pending', icon: 'waiting' };
  }

  if (pullRequest.mergeState === 'blocked') {
    return { label: PULL_REQUEST_STATUS_LABELS.blockedByRules, tone: 'warning', icon: 'blocked' };
  }

  return { label: PULL_REQUEST_STATUS_LABELS.reviewUnknown, tone: 'muted', icon: 'dot' };
}

// Unknown, expected, or absent checks are not "in progress"; keep them muted.
export function pullRequestChecksTone(
  checks: GitHubPullRequestSummary['checks']
): 'success' | 'danger' | 'pending' | 'muted' {
  if (checks.total === 0) return 'muted';
  if (checks.state === 'success') return 'success';
  if (checks.state === 'failure' || checks.state === 'error') return 'danger';
  return checks.state === 'pending' ? 'pending' : 'muted';
}
