import { describe, expect, it } from 'vitest';

import type {
  GitHubPullRequestConversationComment,
  GitHubPullRequestReview
} from '@shared/types';

import { buildPullRequestDiscussion } from './pullRequestDiscussion';

describe('pull request discussion', () => {
  it('combines conversation comments and submitted review bodies chronologically', () => {
    expect(
      buildPullRequestDiscussion(
        [conversationComment({ id: 1, createdAt: '2026-07-24T10:00:00Z' })],
        [review({ id: 2, submittedAt: '2026-07-24T09:00:00Z' })]
      ).map((entry) => entry.key)
    ).toEqual(['review:2', 'conversation:1']);
  });

  it('omits empty and unsubmitted review bodies', () => {
    expect(
      buildPullRequestDiscussion(
        [],
        [
          review({ id: 1, body: '  ' }),
          review({ id: 2, submittedAt: undefined }),
          review({ id: 3, body: 'Visible review' })
        ]
      ).map((entry) => entry.key)
    ).toEqual(['review:3']);
  });
});

function conversationComment(
  overrides: Partial<GitHubPullRequestConversationComment>
): GitHubPullRequestConversationComment {
  return {
    id: 1,
    body: 'Conversation comment',
    author: 'reviewer',
    url: 'https://github.com/acme/widgets/pull/42#issuecomment-1',
    createdAt: '2026-07-24T10:00:00Z',
    updatedAt: '2026-07-24T10:00:00Z',
    ...overrides
  };
}

function review(overrides: Partial<GitHubPullRequestReview>): GitHubPullRequestReview {
  return {
    id: 1,
    author: 'reviewer',
    body: 'General review comment',
    state: 'commented',
    submittedAt: '2026-07-24T10:00:00Z',
    url: 'https://github.com/acme/widgets/pull/42#pullrequestreview-1',
    ...overrides
  };
}
