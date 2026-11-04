import { describe, expect, it } from 'vitest';

import type {
  GitHubPullRequestCommit,
  GitHubPullRequestConversationComment,
  GitHubPullRequestReview,
  GitHubPullRequestReviewComment
} from '@shared/types';

import { buildPullRequestTimeline, groupPullRequestActivity } from './pullRequestTimeline';

describe('pull request timeline', () => {
  it('collapses consecutive commits and can hide bot discussion', () => {
    const timeline = buildPullRequestTimeline({
      commits: [
        commit({ sha: 'a1', committedAt: '2026-07-29T08:00:00Z' }),
        commit({ sha: 'a2', committedAt: '2026-07-29T08:10:00Z' }),
        commit({ sha: 'a3', committedAt: '2026-07-29T11:00:00Z' })
      ],
      conversationComments: [
        conversationComment({ id: 1, createdAt: '2026-07-29T09:00:00Z' }),
        conversationComment({ id: 2, author: 'coderabbitai[bot]', createdAt: '2026-07-29T10:00:00Z' })
      ],
      reviews: [],
      reviewComments: []
    });

    expect(groupPullRequestActivity(timeline, { hideBots: false }).map((item) =>
      item.kind === 'commits' ? `commits:${item.commits.length}` : item.entry.kind)
    ).toEqual(['commits:2', 'conversation', 'conversation', 'commit']);
    // Bot comments drop out; commits stay.
    expect(groupPullRequestActivity(timeline, { hideBots: true }).map((item) =>
      item.kind === 'commits' ? `commits:${item.commits.length}` : item.entry.kind)
    ).toEqual(['commits:2', 'conversation', 'commit']);
  });

  it('keeps a bot-started thread when a person replied to it', () => {
    const timeline = buildPullRequestTimeline({
      commits: [],
      conversationComments: [],
      reviews: [],
      reviewComments: [
        reviewComment({ id: 30, author: 'coderabbitai[bot]', reviewId: undefined }),
        reviewComment({ id: 31, author: 'teammate', inReplyToId: 30, reviewId: undefined, createdAt: '2026-07-29T09:05:00Z' }),
        reviewComment({ id: 40, author: 'coderabbitai[bot]', reviewId: undefined, createdAt: '2026-07-29T10:00:00Z' })
      ]
    });

    const kept = groupPullRequestActivity(timeline, { hideBots: true });
    expect(kept.map((item) => item.kind === 'entry' && item.entry.kind === 'review-thread' ? item.entry.thread.root.id : undefined))
      .toEqual([30]);
  });

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

  it('groups review comment replies into threads under their submitted review', () => {
    const timeline = buildPullRequestTimeline({
      commits: [],
      conversationComments: [],
      reviews: [review({ id: 12 })],
      reviewComments: [
        reviewComment({ id: 20, reviewId: 12 }),
        reviewComment({
          id: 22,
          reviewId: 12,
          inReplyToId: 20,
          createdAt: '2026-07-29T09:05:00Z'
        }),
        reviewComment({ id: 21, reviewId: 99 })
      ]
    });

    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({
      kind: 'review',
      threads: [{ root: { id: 20 }, replies: [{ id: 22 }] }]
    });
    expect(timeline[1]).toMatchObject({
      kind: 'review-thread',
      thread: { root: { id: 21 }, replies: [] }
    });
  });

  it('groups replies even when they arrive before their root comment', () => {
    const timeline = buildPullRequestTimeline({
      commits: [],
      conversationComments: [],
      reviews: [review({ id: 12 })],
      reviewComments: [
        reviewComment({ id: 22, reviewId: 12, inReplyToId: 20 }),
        reviewComment({ id: 20, reviewId: 12 })
      ]
    });

    expect(timeline).toMatchObject([{
      kind: 'review',
      threads: [{ root: { id: 20 }, replies: [{ id: 22 }] }]
    }]);
  });

  it('keeps a reply with an unavailable parent as a standalone thread', () => {
    const timeline = buildPullRequestTimeline({
      commits: [],
      conversationComments: [],
      reviews: [],
      reviewComments: [reviewComment({ id: 22, inReplyToId: 20 })]
    });

    expect(timeline).toMatchObject([{
      kind: 'review-thread',
      thread: { root: { id: 22 }, replies: [] }
    }]);
  });

  it('sorts replies chronologically within a thread', () => {
    const timeline = buildPullRequestTimeline({
      commits: [],
      conversationComments: [],
      reviews: [review({ id: 12 })],
      reviewComments: [
        reviewComment({ id: 20, reviewId: 12 }),
        reviewComment({ id: 23, reviewId: 12, inReplyToId: 20, createdAt: '2026-07-29T09:10:00Z' }),
        reviewComment({ id: 22, reviewId: 12, inReplyToId: 20, createdAt: '2026-07-29T09:05:00Z' })
      ]
    });

    expect(timeline).toMatchObject([{
      kind: 'review',
      threads: [{ replies: [{ id: 22 }, { id: 23 }] }]
    }]);
  });

  it('follows nested reply references back to the root comment', () => {
    const timeline = buildPullRequestTimeline({
      commits: [],
      conversationComments: [],
      reviews: [review({ id: 12 })],
      reviewComments: [
        reviewComment({ id: 20, reviewId: 12 }),
        reviewComment({ id: 22, reviewId: 12, inReplyToId: 20 }),
        reviewComment({ id: 23, reviewId: 12, inReplyToId: 22 })
      ]
    });

    expect(timeline).toMatchObject([{
      kind: 'review',
      threads: [{ root: { id: 20 }, replies: [{ id: 22 }, { id: 23 }] }]
    }]);
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
