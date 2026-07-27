import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import type {
  GitHubPullRequestInbox,
  GitHubPullRequestSummary
} from '@shared/types';

import {
  gitHubActionsRunsQueryKey,
  gitHubActionsRunsRefetchInterval,
  gitHubPullRequestInboxQueryKey,
  refreshGitHubPullRequestInboxAfterMerge
} from './github';

describe('GitHub Actions run queries', () => {
  it('uses the complete tile filter configuration in the cache key', () => {
    expect(
      gitHubActionsRunsQueryKey({
        profileId: 'profile',
        owner: 'owner',
        repository: 'repository',
        limit: 10,
        filters: {
          branches: ['main', 'release/next'],
          includeTags: true,
          includeMyPullRequests: true
        }
      })
    ).toEqual([
      'github-actions-runs',
      'profile',
      'owner',
      'repository',
      10,
      'main\nrelease/next',
      true,
      true
    ]);
  });

  it('polls filtered tiles less aggressively than unfiltered tiles', () => {
    expect(
      gitHubActionsRunsRefetchInterval({
        branches: [],
        includeTags: false,
        includeMyPullRequests: false
      })
    ).toBe(15_000);
    expect(
      gitHubActionsRunsRefetchInterval({
        branches: ['main'],
        includeTags: true,
        includeMyPullRequests: true
      })
    ).toBe(60_000);
  });
});

describe('GitHub pull request inbox refresh', () => {
  it('refetches the inbox and removes the merged pull request from a stale response', async () => {
    const queryClient = new QueryClient();
    const queryKey = gitHubPullRequestInboxQueryKey('profile');
    const queryFn = vi.fn(async () => inbox([pullRequest(1), pullRequest(2), pullRequest(3)], 'fresh'));
    queryClient.setQueryDefaults(queryKey, { queryFn });
    queryClient.setQueryData(queryKey, inbox([pullRequest(1), pullRequest(2)], 'cached'));

    await refreshGitHubPullRequestInboxAfterMerge(queryClient, {
      profileId: 'profile',
      owner: 'owner',
      repository: 'repository',
      number: 1
    });

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData<GitHubPullRequestInbox>(queryKey)).toEqual(
      inbox([pullRequest(2), pullRequest(3)], 'fresh')
    );
    queryClient.clear();
  });
});

function inbox(
  pullRequests: GitHubPullRequestSummary[],
  loadedAt: string
): GitHubPullRequestInbox {
  return {
    profileId: 'profile',
    viewerLogin: 'viewer',
    host: 'github.com',
    pullRequests,
    loadedAt
  };
}

function pullRequest(number: number): GitHubPullRequestSummary {
  return {
    profileId: 'profile',
    owner: 'owner',
    repository: 'repository',
    number,
    id: `pr-${number}`,
    title: `Pull request ${number}`,
    url: `https://github.com/owner/repository/pull/${number}`,
    author: 'author',
    updatedAt: '2026-07-25T10:00:00.000Z',
    category: 'ready-to-merge',
    isDraft: false,
    reviewDecision: 'approved',
    mergeState: 'clean',
    mergeable: 'mergeable',
    canMerge: true,
    comments: 0,
    changedFiles: 1,
    additions: 1,
    deletions: 0,
    headRefName: `feature-${number}`,
    baseRefName: 'main',
    checks: {
      state: 'success',
      total: 1,
      passed: 1,
      failed: 0,
      pending: 0
    }
  };
}
