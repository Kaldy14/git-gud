import type { GitHubPullRequestSummary } from '@shared/types';

export type PullRequestInboxStatus = {
  label: string;
  tone: 'success' | 'danger' | 'pending';
  icon: 'check' | 'dot' | 'warning';
};

export function pullRequestStatus(
  pullRequest: GitHubPullRequestSummary
): PullRequestInboxStatus {
  if (pullRequest.isDraft) {
    return { label: 'Draft', tone: 'pending', icon: 'dot' };
  }
  if (pullRequest.mergeable === 'conflicting' || pullRequest.mergeState === 'dirty') {
    return { label: 'Merge conflicts', tone: 'danger', icon: 'warning' };
  }
  if (pullRequest.checks.state === 'failure' || pullRequest.checks.state === 'error') {
    return { label: 'Checks failing', tone: 'danger', icon: 'warning' };
  }
  if (pullRequest.reviewDecision === 'approved') {
    return { label: 'Approved', tone: 'success', icon: 'check' };
  }
  if (pullRequest.reviewDecision === 'changes-requested') {
    return { label: 'Changes requested', tone: 'danger', icon: 'warning' };
  }
  return { label: 'Awaiting approval', tone: 'pending', icon: 'dot' };
}
