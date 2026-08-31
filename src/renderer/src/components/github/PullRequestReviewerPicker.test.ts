import { describe, expect, it } from 'vitest';

import type {
  GitHubPullRequestReviewer,
  GitHubPullRequestReviewerCandidate
} from '@shared/types';

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
