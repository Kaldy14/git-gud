import type {
  GitHubPullRequestConversationComment,
  GitHubPullRequestReview
} from '@shared/types';

type PullRequestDiscussionEntryBase = {
  key: string;
  author: string;
  authorAvatarUrl?: string;
  body: string;
  createdAt: string;
  url: string;
};

export type PullRequestDiscussionEntry =
  | (PullRequestDiscussionEntryBase & {
      kind: 'conversation';
    })
  | (PullRequestDiscussionEntryBase & {
      kind: 'review';
      reviewState: GitHubPullRequestReview['state'];
    });

export function buildPullRequestDiscussion(
  conversationComments: GitHubPullRequestConversationComment[],
  reviews: GitHubPullRequestReview[]
): PullRequestDiscussionEntry[] {
  const entries: PullRequestDiscussionEntry[] = [
    ...conversationComments.map((comment) => ({
      key: `conversation:${comment.id}`,
      kind: 'conversation' as const,
      author: comment.author,
      authorAvatarUrl: comment.authorAvatarUrl,
      body: comment.body,
      createdAt: comment.createdAt,
      url: comment.url
    })),
    ...reviews.flatMap<PullRequestDiscussionEntry>((review) => {
      if (!review.body.trim() || !review.submittedAt) {
        return [];
      }

      return [{
        key: `review:${review.id}`,
        kind: 'review',
        author: review.author,
        authorAvatarUrl: review.authorAvatarUrl,
        body: review.body,
        createdAt: review.submittedAt,
        url: review.url,
        reviewState: review.state
      }];
    })
  ];

  return entries.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}
