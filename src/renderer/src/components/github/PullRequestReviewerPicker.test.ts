import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type {
  GitHubPullRequestDetail,
  GitHubPullRequestReviewer,
  GitHubPullRequestReviewerCandidate
} from '@shared/types';

import { PullRequestReviewerPicker } from './PullRequestReviewerPicker';
import {
  filterReviewerCandidates,
  mergeCurrentReviewerCandidates
} from './reviewerPickerPresentation';

const candidates: GitHubPullRequestReviewerCandidate[] = [
  { id: 'user:author', kind: 'user', login: 'author' },
  { id: 'user:anna', kind: 'user', login: 'anna', name: 'Anna Reviewer' },
  { id: 'user:zoe', kind: 'user', login: 'zoe' },
  {
    id: 'team:acme/platform',
    kind: 'team',
    organization: 'acme',
    slug: 'platform',
    name: 'Platform'
  }
];

describe('pull request reviewer picker', () => {
  it('shows a visible add action when the pull request has no reviewers', () => {
    const markup = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(PullRequestReviewerPicker, {
          detail: pullRequestDetail(),
          onReviewersChanged: async () => undefined,
          onNotice: () => undefined
        })
      )
    );

    expect(markup).toContain('aria-label="Add reviewer"');
    expect(markup).toContain('>Add reviewer</span>');
  });

  it('keeps requested reviewers first and excludes the pull request author', () => {
    const reviewers: GitHubPullRequestReviewer[] = [
      { author: 'zoe', state: 'pending' }
    ];

    expect(
      filterReviewerCandidates(candidates, reviewers, 'author', '').map(({ id }) => id)
    ).toEqual(['user:zoe', 'team:acme/platform', 'user:anna']);
  });

  it('matches logins, display names, and team names', () => {
    expect(
      filterReviewerCandidates(candidates, [], 'author', 'reviewer').map(({ id }) => id)
    ).toEqual(['user:anna']);
    expect(
      filterReviewerCandidates(candidates, [], 'author', 'platform').map(({ id }) => id)
    ).toEqual(['team:acme/platform']);
  });

  it('preserves a pending reviewer when GitHub omits it from the candidate response', () => {
    expect(
      mergeCurrentReviewerCandidates([], [
        { author: 'acme/security', state: 'pending' },
        { author: 'anna', state: 'approved' }
      ])
    ).toEqual([
      {
        id: 'team:acme/security',
        kind: 'team',
        organization: 'acme',
        slug: 'security',
        name: 'security',
        avatarUrl: undefined
      }
    ]);
  });
});

function pullRequestDetail(): GitHubPullRequestDetail {
  const loadedAt = '2026-09-01T10:00:00.000Z';

  return {
    profileId: 'profile:acme',
    owner: 'acme',
    repository: 'widgets',
    number: 42,
    id: 'pr-42',
    title: 'Add reviewer controls',
    url: 'https://github.com/acme/widgets/pull/42',
    author: 'author',
    updatedAt: loadedAt,
    state: 'open',
    category: 'waiting',
    isDraft: false,
    reviewDecision: 'review-required',
    mergeState: 'clean',
    mergeable: 'mergeable',
    canMerge: true,
    reviewers: [],
    comments: 0,
    changedFiles: 1,
    additions: 4,
    deletions: 0,
    headRefName: 'feature/reviewers',
    headSha: 'head-sha',
    baseRefName: 'main',
    baseSha: 'base-sha',
    baseRefSha: 'base-ref-sha',
    checks: {
      state: 'success',
      total: 1,
      passed: 1,
      failed: 0,
      pending: 0
    },
    body: '',
    commits: 1,
    commitTimeline: [],
    files: [],
    reviewPlan: {
      repoPath: 'github://github.com/acme/widgets',
      target: { kind: 'branch', name: 'feature/reviewers', sha: 'head-sha' },
      targetKey: 'github-pr:profile:acme:acme/widgets#42:head-sha',
      sourceFingerprint: 'fingerprint',
      loadedAt,
      units: [],
      fileContexts: [],
      reviewedChunkIds: []
    },
    mergeSettings: {
      allowedMethods: ['squash'],
      defaultMethod: 'squash'
    },
    viewerLogin: 'author',
    reviewComments: [],
    conversationComments: [],
    reviews: [],
    loadedAt
  };
}
