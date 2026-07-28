import { describe, expect, it } from 'vitest';

import type {
  GitHubPullRequestLocator,
  GitReviewPlan
} from '@shared/types';

import { GitHubPullRequestReviewPlanCache } from './githubReviewPlans';

const locator: GitHubPullRequestLocator = {
  profileId: 'profile-1',
  owner: 'acme',
  repository: 'widgets',
  number: 42
};

describe('GitHub pull request review plan cache', () => {
  it('returns only the main-process plan matching the current fingerprint', () => {
    const cache = new GitHubPullRequestReviewPlanCache();
    const plan = reviewPlan('fingerprint-1');

    cache.remember(locator, plan);

    expect(cache.get(locator, 'fingerprint-1')).toBe(plan);
    expect(cache.has(plan)).toBe(true);
    expect(() => cache.get(locator, 'fingerprint-2')).toThrow(
      'The pull request changed while the AI guide was starting.'
    );
  });

  it('requires the pull request detail to be loaded first', () => {
    const cache = new GitHubPullRequestReviewPlanCache();

    expect(() => cache.get(locator, 'fingerprint-1')).toThrow(
      'Reload the pull request before starting its AI guide.'
    );
  });

  it('replaces the cached plan when the pull request refreshes', () => {
    const cache = new GitHubPullRequestReviewPlanCache();
    const previousPlan = reviewPlan('fingerprint-1');
    const currentPlan = reviewPlan('fingerprint-2');

    cache.remember(locator, previousPlan);
    cache.remember(locator, currentPlan);

    expect(cache.has(previousPlan)).toBe(false);
    expect(cache.get(locator, 'fingerprint-2')).toBe(currentPlan);
  });

  it('evicts the oldest pull request plan when the recent-plan limit is reached', () => {
    const cache = new GitHubPullRequestReviewPlanCache(2);
    const firstLocator = { ...locator, number: 1 };
    const secondLocator = { ...locator, number: 2 };
    const thirdLocator = { ...locator, number: 3 };

    cache.remember(firstLocator, reviewPlan('fingerprint-1'));
    cache.remember(secondLocator, reviewPlan('fingerprint-2'));
    cache.remember(thirdLocator, reviewPlan('fingerprint-3'));

    expect(() => cache.get(firstLocator, 'fingerprint-1')).toThrow(
      'Reload the pull request before starting its AI guide.'
    );
    expect(cache.get(secondLocator, 'fingerprint-2').sourceFingerprint).toBe('fingerprint-2');
    expect(cache.get(thirdLocator, 'fingerprint-3').sourceFingerprint).toBe('fingerprint-3');
  });
});

function reviewPlan(sourceFingerprint: string): GitReviewPlan {
  return {
    repoPath: 'github://github.com/acme/widgets',
    target: {
      kind: 'branch',
      name: 'feature/review',
      sha: 'head-sha'
    },
    targetKey: `github-pr:profile-1:acme/widgets#42:${sourceFingerprint}`,
    sourceFingerprint,
    units: [],
    fileContexts: [],
    reviewedChunkIds: [],
    loadedAt: '2026-07-24T10:00:00.000Z'
  };
}
