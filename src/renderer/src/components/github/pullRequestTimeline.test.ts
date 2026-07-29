import { describe, expect, it } from 'vitest';

import type {
  GitHubPullRequestCommit,
  GitHubPullRequestConversationComment,
  GitHubPullRequestReview,
  GitHubPullRequestReviewComment
} from '@shared/types';

import { buildPullRequestTimeline } from './pullRequestTimeline';

describe('pull request timeline', () => {
  it('sorts commits, comments, and reviews chronologically', () => {
    expect(
      buildPullRequestTimeline({
        commits: [commit({ committedAt: '2026-07-29T08:00:00Z' })],
        conversationComments: [conversationComment({ createdAt: '2026-07-29T10:00:00Z' })],
        reviews: [review({ submittedAt: '2026-07-29T09:00:00Z' })],
        reviewComments: []
      }).map((entry) => entry.kind)
    ).toEqual(['commit', 'review', 'conversation']);
  });

  it('groups inline comments under their submitted review', () => {
    const timeline = buildPullRequestTimeline({
      commits: [],
      conversationComments: [],
      reviews: [review({ id: 12 })],
      reviewComments: [
        reviewComment({ id: 20, reviewId: 12 }),
        reviewComment({ id: 21, reviewId: 99 })
      ]
    });

    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({
      kind: 'review',
      comments: [{ id: 20 }]
    });
    expect(timeline[1]).toMatchObject({
      kind: 'review-comment',
      comment: { id: 21 }
    });
  });
});

function commit(overrides: Partial<GitHubPullRequestCommit>): GitHubPullRequestCommit {
  return {
    sha: 'abc123',
    message: 'Add approval context',
    author: 'developer',
    committedAt: '2026-07-29T08:00:00Z',
    url: 'https://github.com/acme/widgets/commit/abc123',
    ...overrides
  };
}

function conversationComment(
  overrides: Partial<GitHubPullRequestConversationComment>
): GitHubPullRequestConversationComment {
  return {
    id: 1,
    body: 'Looks useful',
    author: 'teammate',
    url: 'https://github.com/acme/widgets/pull/42#issuecomment-1',
    createdAt: '2026-07-29T10:00:00Z',
    updatedAt: '2026-07-29T10:00:00Z',
    ...overrides
  };
}

function review(overrides: Partial<GitHubPullRequestReview>): GitHubPullRequestReview {
  return {
    id: 12,
    author: 'reviewer',
    body: '',
    state: 'approved',
    submittedAt: '2026-07-29T09:00:00Z',
    url: 'https://github.com/acme/widgets/pull/42#pullrequestreview-12',
    ...overrides
  };
}

function reviewComment(
  overrides: Partial<GitHubPullRequestReviewComment>
): GitHubPullRequestReviewComment {
  return {
    id: 20,
    body: 'Please keep this concise.',
    author: 'reviewer',
    url: 'https://github.com/acme/widgets/pull/42#discussion_r20',
    path: 'src/status.ts',
    createdAt: '2026-07-29T09:00:00Z',
    updatedAt: '2026-07-29T09:00:00Z',
    subjectType: 'line',
    line: 42,
    side: 'right',
    ...overrides
  };
}
