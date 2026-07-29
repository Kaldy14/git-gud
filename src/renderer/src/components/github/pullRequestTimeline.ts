import type {
  GitHubPullRequestCommit,
  GitHubPullRequestConversationComment,
  GitHubPullRequestReview,
  GitHubPullRequestReviewComment
} from '@shared/types';

export type PullRequestTimelineEntry =
  | {
      key: string;
      kind: 'commit';
      createdAt: string;
      commit: GitHubPullRequestCommit;
    }
  | {
      key: string;
      kind: 'conversation';
      createdAt: string;
      comment: GitHubPullRequestConversationComment;
    }
  | {
      key: string;
      kind: 'review';
      createdAt: string;
      review: GitHubPullRequestReview;
      comments: GitHubPullRequestReviewComment[];
    }
  | {
      key: string;
      kind: 'review-comment';
      createdAt: string;
      comment: GitHubPullRequestReviewComment;
    };

export function buildPullRequestTimeline(input: {
  commits: GitHubPullRequestCommit[];
  conversationComments: GitHubPullRequestConversationComment[];
  reviews: GitHubPullRequestReview[];
  reviewComments: GitHubPullRequestReviewComment[];
}): PullRequestTimelineEntry[] {
  const reviewIds = new Set(input.reviews.map((review) => review.id));
  const commentsByReviewId = new Map<number, GitHubPullRequestReviewComment[]>();

  for (const comment of input.reviewComments) {
    if (comment.reviewId === undefined || !reviewIds.has(comment.reviewId)) {
      continue;
    }

    const comments = commentsByReviewId.get(comment.reviewId) ?? [];
    comments.push(comment);
    commentsByReviewId.set(comment.reviewId, comments);
  }

  const entries: PullRequestTimelineEntry[] = [
    ...input.commits.map((commit) => ({
      key: `commit:${commit.sha}`,
      kind: 'commit' as const,
      createdAt: commit.committedAt,
      commit
    })),
    ...input.conversationComments.map((comment) => ({
      key: `conversation:${comment.id}`,
      kind: 'conversation' as const,
      createdAt: comment.createdAt,
      comment
    })),
    ...input.reviews.flatMap<PullRequestTimelineEntry>((review) => {
      if (!review.submittedAt) {
        return [];
      }

      return [{
        key: `review:${review.id}`,
        kind: 'review',
        createdAt: review.submittedAt,
        review,
        comments: [...(commentsByReviewId.get(review.id) ?? [])]
          .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
      }];
    }),
    ...input.reviewComments.flatMap<PullRequestTimelineEntry>((comment) => {
      if (comment.reviewId !== undefined && reviewIds.has(comment.reviewId)) {
        return [];
      }

      return [{
        key: `review-comment:${comment.id}`,
        kind: 'review-comment',
        createdAt: comment.createdAt,
        comment
      }];
    })
  ];

  return [...entries].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}
