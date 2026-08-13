import { describe, expect, it } from 'vitest';

import type {
  GitHubPullRequestInbox,
  GitHubPullRequestSummary,
  GitProfile
} from '@shared/types';

import {
  appendPullRequestDeepLinkTarget,
  findPullRequestForDeepLink,
  profilesForPullRequestDeepLink
} from './pullRequestDeepLinkNavigation';

const target = {
  host: 'github.com',
  owner: 'Kaldy14',
  repository: 'git-gud',
  number: 123
};

describe('pull request deep-link navigation', () => {
  it('prefers the active connected profile for the target host', () => {
    const profiles = [
      profile({ id: 'work', githubLogin: 'work-user' }),
      profile({ id: 'personal', githubLogin: 'personal-user' })
    ];

    expect(
      profilesForPullRequestDeepLink(target, profiles, 'personal').map(
        (candidate) => candidate.id
      )
    ).toEqual(['personal', 'work']);
  });

  it('falls back to the first connected profile for the target host', () => {
    const profiles = [
      profile({ id: 'enterprise', githubHost: 'github.example.com' }),
      profile({ id: 'personal' })
    ];

    expect(
      profilesForPullRequestDeepLink(target, profiles, 'enterprise').map(
        (candidate) => candidate.id
      )
    ).toEqual(['personal']);
  });

  it('finds the linked pull request case-insensitively', () => {
    const pullRequest = pullRequestSummary();
    const inbox: GitHubPullRequestInbox = {
      profileId: 'personal',
      viewerLogin: 'Kaldy14',
      host: 'github.com',
      pullRequests: [pullRequest],
      suggestions: [],
      loadedAt: '2026-08-06T12:00:00.000Z'
    };

    expect(
      findPullRequestForDeepLink(
        { ...target, owner: 'kaldy14', repository: 'GIT-GUD' },
        inbox
      )
    ).toBe(pullRequest);
  });

  it('deduplicates repeated pending targets', () => {
    expect(
      appendPullRequestDeepLinkTarget(
        [target],
        { ...target, owner: 'kaldy14', repository: 'GIT-GUD' }
      )
    ).toEqual([target]);
  });
});

function profile(overrides: Partial<GitProfile>): GitProfile {
  return {
    id: 'personal',
    name: 'Personal',
    email: 'developer@example.com',
    avatarColor: '#58a6ff',
    ghConfigDir: '/profiles/personal',
    githubLogin: 'Kaldy14',
    githubHost: 'github.com',
    ...overrides
  };
}

function pullRequestSummary(): GitHubPullRequestSummary {
  return {
    profileId: 'personal',
    id: 'PR_kwDO123',
    title: 'Share Git Gud pull request links',
    url: 'https://github.com/Kaldy14/git-gud/pull/123',
    owner: 'Kaldy14',
    repository: 'git-gud',
    number: 123,
    author: 'Kaldy14',
    updatedAt: '2026-08-06T12:00:00.000Z',
    category: 'waiting',
    isDraft: false,
    reviewDecision: 'review-required',
    mergeState: 'clean',
    mergeable: 'mergeable',
    canMerge: true,
    reviewers: [],
    comments: 0,
    changedFiles: 1,
    additions: 10,
    deletions: 2,
    headRefName: 'feature/deep-links',
    headSha: 'a'.repeat(40),
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
