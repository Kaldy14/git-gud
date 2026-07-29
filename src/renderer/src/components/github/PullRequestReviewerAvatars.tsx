import type { ReactElement } from 'react';
import { useState } from 'react';
import { Check, CircleDot, X } from 'lucide-react';

import type { GitHubPullRequestReviewer } from '@shared/types';

export function PullRequestReviewerAvatars({
  reviewers
}: {
  reviewers: GitHubPullRequestReviewer[];
}): ReactElement | null {
  if (reviewers.length === 0) {
    return null;
  }

  const visibleReviewers = reviewers.slice(0, 3);
  const hiddenCount = reviewers.length - visibleReviewers.length;
  const reviewerLabel = reviewers
    .map((reviewer) => `${reviewer.author}: ${reviewerStateLabel(reviewer.state)}`)
    .join(', ');

  return (
    <span className="pr-reviewer-avatars" aria-label={reviewerLabel}>
      {visibleReviewers.map((reviewer) => (
        <ReviewerAvatar reviewer={reviewer} key={reviewer.author} />
      ))}
      {hiddenCount > 0 ? (
        <span className="pr-reviewer-avatar-wrap" title={`${hiddenCount} more reviewers`}>
          <span className="pr-reviewer-avatar pr-reviewer-avatar--count" aria-hidden="true">
            +{hiddenCount}
          </span>
        </span>
      ) : null}
    </span>
  );
}

function ReviewerAvatar({
  reviewer
}: {
  reviewer: GitHubPullRequestReviewer;
}): ReactElement {
  const [didAvatarFail, setDidAvatarFail] = useState(false);
  const label = `${reviewer.author}: ${reviewerStateLabel(reviewer.state)}`;

  return (
    <span className="pr-reviewer-avatar-wrap" data-state={reviewer.state} title={label}>
      {reviewer.authorAvatarUrl && !didAvatarFail ? (
        <img
          className="pr-reviewer-avatar"
          src={reviewer.authorAvatarUrl}
          alt=""
          aria-hidden="true"
          referrerPolicy="no-referrer"
          onError={() => setDidAvatarFail(true)}
        />
      ) : (
        <span className="pr-reviewer-avatar" aria-hidden="true">
          {reviewer.author.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="pr-reviewer-state" data-state={reviewer.state} aria-hidden="true">
        {reviewer.state === 'approved' ? (
          <Check size={8} strokeWidth={3} />
        ) : reviewer.state === 'changes-requested' ? (
          <X size={8} strokeWidth={3} />
        ) : (
          <CircleDot size={7} strokeWidth={2.5} />
        )}
      </span>
    </span>
  );
}

function reviewerStateLabel(state: GitHubPullRequestReviewer['state']): string {
  if (state === 'approved') {
    return 'approved';
  }
  if (state === 'changes-requested') {
    return 'requested changes';
  }
  return 'review pending';
}
