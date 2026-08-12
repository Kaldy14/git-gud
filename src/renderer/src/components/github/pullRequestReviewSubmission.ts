import type { GitHubPullRequestReviewInput } from '@shared/types';

export function isReviewSummaryRequired(
  event: GitHubPullRequestReviewInput['event'],
  draftCount: number
): boolean {
  return event !== 'approve' && draftCount === 0;
}
