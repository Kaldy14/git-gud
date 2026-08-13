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
      threads: PullRequestReviewThread[];
    }
  | {
      key: string;
      kind: 'review-thread';
      createdAt: string;
      thread: PullRequestReviewThread;
    };

export type PullRequestReviewThread = {
  root: GitHubPullRequestReviewComment;
  replies: GitHubPullRequestReviewComment[];
};

export function buildPullRequestTimeline(input: {
  commits: GitHubPullRequestCommit[];
  conversationComments: GitHubPullRequestConversationComment[];
  reviews: GitHubPullRequestReview[];
  reviewComments: GitHubPullRequestReviewComment[];
}): PullRequestTimelineEntry[] {
  const reviewIds = new Set(input.reviews.map((review) => review.id));
  const threadsByReviewId = new Map<number, PullRequestReviewThread[]>();
  const standaloneThreads: PullRequestReviewThread[] = [];

  for (const thread of buildReviewThreads(input.reviewComments)) {
    if (thread.root.reviewId === undefined || !reviewIds.has(thread.root.reviewId)) {
      standaloneThreads.push(thread);
    } else {
      const threads = threadsByReviewId.get(thread.root.reviewId) ?? [];
      threads.push(thread);
      threadsByReviewId.set(thread.root.reviewId, threads);
    }
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
        threads: [...(threadsByReviewId.get(review.id) ?? [])]
          .sort((left, right) => Date.parse(left.root.createdAt) - Date.parse(right.root.createdAt))
      }];
    }),
    ...standaloneThreads.map<PullRequestTimelineEntry>((thread) => ({
      key: `review-thread:${thread.root.id}`,
      kind: 'review-thread',
      createdAt: thread.root.createdAt,
      thread
    }))
  ];

  return [...entries].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

function buildReviewThreads(
  comments: GitHubPullRequestReviewComment[]
): PullRequestReviewThread[] {
  const commentById = new Map(comments.map((comment) => [comment.id, comment]));
  const threadByRootId = new Map<number, PullRequestReviewThread>();

  for (const comment of comments) {
    const root = findThreadRoot(comment, commentById);
    const existingThread = threadByRootId.get(root.id) ?? { root, replies: [] };

    if (comment.id !== root.id) {
      existingThread.replies.push(comment);
    }

    threadByRootId.set(root.id, existingThread);
  }

  return [...threadByRootId.values()]
    .map((thread) => ({
      ...thread,
      replies: thread.replies.sort(
        (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)
      )
    }))
    .sort((left, right) => Date.parse(left.root.createdAt) - Date.parse(right.root.createdAt));
}

function findThreadRoot(
  comment: GitHubPullRequestReviewComment,
  commentById: ReadonlyMap<number, GitHubPullRequestReviewComment>
): GitHubPullRequestReviewComment {
  const seen = new Set<number>();
  let current = comment;

  while (current.inReplyToId !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = commentById.get(current.inReplyToId);
    if (!parent) {
      break;
    }
    current = parent;
  }

  return current;
}
