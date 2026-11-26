import type { GitHubPullRequestSummary } from '@shared/types';
import { hasPullRequestMergeConflicts } from './pullRequestInboxStatus';

export type MergeBlockerTone = 'danger' | 'warning' | 'pending' | 'muted';
export type MergeBlocker = {
  id: 'conflicts' | 'draft' | 'checks-failing' | 'checks-running' | 'changes-requested' | 'behind' | 'review-required' | 'blocked';
  tone: MergeBlockerTone;
  label: string;
  detail: string;
};

// Everything that stops an open pull request from merging, most urgent first.
export function pullRequestMergeBlockers(detail: GitHubPullRequestSummary): MergeBlocker[] {
  if (detail.state === 'merged' || detail.state === 'closed') return [];
  const blockers: MergeBlocker[] = [];
  const { checks } = detail;
  if (hasPullRequestMergeConflicts(detail)) {
    blockers.push({ id: 'conflicts', tone: 'danger', label: `Merge conflicts with ${detail.baseRefName}`, detail: 'GitHub cannot combine the branches automatically.' });
  }
  if (checks.failed > 0) {
    blockers.push({ id: 'checks-failing', tone: 'danger', label: `${checks.failed} ${checks.failed === 1 ? 'check' : 'checks'} failing`, detail: `${checks.passed} passed` });
  } else if (checks.pending > 0) {
    blockers.push({ id: 'checks-running', tone: 'pending', label: `${checks.pending} ${checks.pending === 1 ? 'check' : 'checks'} still running`, detail: `${checks.passed} passed so far` });
  }
  const requestedBy = (detail.reviewers ?? []).filter((reviewer) => reviewer.state === 'changes-requested').map((reviewer) => reviewer.author);
  if (requestedBy.length > 0 || detail.reviewDecision === 'changes-requested') {
    blockers.push({
      id: 'changes-requested',
      tone: 'danger',
      label: requestedBy.length > 0 ? `Changes requested by ${requestedBy.join(', ')}` : 'Changes requested',
      detail: 'Address the review, then ask for another one.'
    });
  }
  if (detail.isDraft) {
    blockers.push({ id: 'draft', tone: 'muted', label: 'Draft', detail: 'Reviewers are not notified until it is ready for review.' });
  }
  if (detail.mergeState === 'behind') {
    blockers.push({ id: 'behind', tone: 'warning', label: `Behind ${detail.baseRefName}`, detail: 'Update the branch before merging.' });
  }
  // The inbox never calls a pull request ready while GitHub still asks for an approving review. Waiting
  // for someone else's approval is in progress (pending), not a warning, as the inbox shows it.
  if (detail.reviewDecision === 'review-required' && !detail.isDraft) {
    blockers.push({ id: 'review-required', tone: 'pending', label: 'Approval required', detail: 'An approving review is needed before merging.' });
  } else if (detail.mergeState === 'blocked' && !detail.isDraft && blockers.length === 0) {
    blockers.push({ id: 'blocked', tone: 'warning', label: 'Blocked by branch rules', detail: 'Required reviews or protections are not satisfied yet.' });
  }
  return blockers;
}
