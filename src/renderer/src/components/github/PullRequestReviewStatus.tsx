import type { ReactElement } from 'react';
import { ChevronRight } from 'lucide-react';

import type { GitHubPullRequestReviewComment, GitHubPullRequestSummary } from '@shared/types';
import { pullRequestMergeVerdict } from './overview/pullRequestMergeVerdict';
import { hasPullRequestMergeConflicts, pullRequestChecksTone } from './pullRequestInboxStatus';
import { PullRequestStatusIcon } from './PullRequestStatusIcon';

// Skipped and neutral runs never finish, so they stay out of the passed/ran ratio.
function checksHeaderLabel(checks: GitHubPullRequestSummary['checks']): string {
  const ran = checks.passed + checks.failed + checks.pending;
  const skipped = checks.total - ran;
  if (ran === 0) return `${skipped} ${skipped === 1 ? 'check' : 'checks'} skipped`;
  return `${checks.passed}/${ran} checks passed${skipped > 0 ? ` · ${skipped} skipped` : ''}`;
}

export function PullRequestReviewStatus({
  detail,
  areConflictsOpen,
  onToggleConflicts,
  reserveConflictToggle
}: {
  detail: GitHubPullRequestSummary & { reviewComments?: readonly GitHubPullRequestReviewComment[] };
  areConflictsOpen?: boolean;
  onToggleConflicts?: () => void;
  /** While loading there is nothing to toggle yet, but the chevron's place is held so the line does not shift. */
  reserveConflictToggle?: boolean;
}): ReactElement {
  const verdict = pullRequestMergeVerdict(detail);
  const hasMergeConflicts = hasPullRequestMergeConflicts(detail);
  const checksTone = pullRequestChecksTone(detail.checks);
  return (
    <>
      {hasMergeConflicts && onToggleConflicts ? (
        <button
          className="pr-review-status-button"
          type="button"
          data-tone={verdict.tone}
          aria-controls="pr-review-conflict-panel"
          aria-expanded={areConflictsOpen}
          title={areConflictsOpen ? 'Hide merge conflict details' : 'Show merge conflict details'}
          onClick={onToggleConflicts}
        >
          <PullRequestStatusIcon icon={verdict.icon} size={14} />
          {verdict.label}
          <ChevronRight size={12} aria-hidden="true" />
        </button>
      ) : (
        <span data-tone={verdict.tone}>
          <PullRequestStatusIcon icon={verdict.icon} size={14} />
          {verdict.label}
          {hasMergeConflicts && reserveConflictToggle ? <ChevronRight size={12} aria-hidden="true" style={{ visibility: 'hidden' }} /> : null}
        </span>
      )}
      {hasMergeConflicts && (onToggleConflicts || reserveConflictToggle) && detail.isDraft ? (
        <span data-tone="muted"><PullRequestStatusIcon icon="draft" size={14} />Draft</span>
      ) : null}
      <span data-tone={checksTone}>
        <PullRequestStatusIcon icon={checksTone === 'success' ? 'check' : checksTone === 'danger' ? 'failing' : checksTone === 'pending' ? 'running' : 'dot'} size={14} />
        {detail.checks.total > 0 ? checksHeaderLabel(detail.checks) : 'No checks reported'}
      </span>
    </>
  );
}
