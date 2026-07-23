import { describe, expect, it } from 'vitest';

import type { GitHubPullRequestSummary } from '@shared/types';

import { pullRequestStatus } from './pullRequestInboxStatus';

describe('pull request inbox status', () => {
  it('shows GitHub merge conflicts even when the viewer was requested for review', () => {
    expect(
      pullRequestStatus(
        pullRequestSummary({
          category: 'needs-your-review',
          mergeState: 'dirty',
          mergeable: 'conflicting'
        })
      )
    ).toEqual({
      label: 'Merge conflicts',
      tone: 'danger',
      icon: 'warning'
    });
  });

  it('shows failing checks before approval state', () => {
    expect(
      pullRequestStatus(
        pullRequestSummary({
          reviewDecision: 'approved',
          checks: {
            state: 'failure',
            total: 3,
            passed: 2,
            failed: 1,
            pending: 0
          }
        })
      )
    ).toEqual({
      label: 'Checks failing',
      tone: 'danger',
      icon: 'warning'
    });
  });

  it('uses GitHub review state when the pull request is otherwise healthy', () => {
    expect(
      pullRequestStatus(
        pullRequestSummary({
          reviewDecision: 'approved'
        })
      )
    ).toEqual({
      label: 'Approved',
      tone: 'success',
      icon: 'check'
    });
  });
});

function pullRequestSummary(
  overrides: Partial<GitHubPullRequestSummary>
): GitHubPullRequestSummary {
  return {
    profileId: 'profile-1',
    id: 'pull-request-1',
    owner: 'acme',
    repository: 'widgets',
    number: 42,
    title: 'Use live GitHub data',
    url: 'https://github.com/acme/widgets/pull/42',
    author: 'developer',
    authorAvatarUrl: 'https://avatars.example/developer',
    updatedAt: '2026-07-23T10:00:00Z',
    category: 'waiting',
    isDraft: false,
    reviewDecision: 'review-required',
    mergeState: 'clean',
    mergeable: 'mergeable',
    canMerge: true,
    comments: 5,
    changedFiles: 1,
    additions: 1,
    deletions: 1,
    headRefName: 'feature/live-data',
    baseRefName: 'main',
    checks: {
      state: 'success',
      total: 3,
      passed: 3,
      failed: 0,
      pending: 0
    },
    ...overrides
  };
}
