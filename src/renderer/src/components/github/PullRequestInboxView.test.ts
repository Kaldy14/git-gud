import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { GitHubPullRequestSummary } from '@shared/types';

import { PullRequestInboxView } from './PullRequestInboxView';
import { resolvePullRequestGroupExpansion } from './pullRequestInboxGroups';
import {
  hasPullRequestMergeConflicts,
  pullRequestStatus
} from './pullRequestInboxStatus';

describe('pull request inbox group expansion', () => {
  it('expands populated groups and collapses empty groups by default', () => {
    expect(resolvePullRequestGroupExpansion(undefined, 2)).toBe(true);
    expect(resolvePullRequestGroupExpansion(undefined, 0)).toBe(false);
  });

  it('preserves an explicit user expansion choice', () => {
    expect(resolvePullRequestGroupExpansion(false, 2)).toBe(false);
    expect(resolvePullRequestGroupExpansion(true, 0)).toBe(true);
  });
});

describe('pull request creation suggestions', () => {
  it('renders a recently pushed branch as an external quick-create link', () => {
    const markup = renderToStaticMarkup(
      createElement(PullRequestInboxView, {
        profile: {
          id: 'profile-1',
          name: 'Work',
          email: 'developer@example.com',
          avatarColor: '#45b8ac',
          ghConfigDir: '/tmp/gh',
          githubLogin: 'developer'
        },
        inbox: {
          profileId: 'profile-1',
          viewerLogin: 'developer',
          host: 'github.com',
          pullRequests: [],
          suggestions: [{
            id: 'acme/widgets:feature/recent-work',
            owner: 'acme',
            repository: 'widgets',
            branch: 'feature/recent-work',
            defaultBranch: 'main',
            headSha: 'head-sha',
            pushedAt: new Date().toISOString(),
            compareUrl: 'https://github.com/acme/widgets/compare/main...feature%2Frecent-work?quick_pull=1'
          }],
          loadedAt: new Date().toISOString()
        },
        isLoading: false,
        isRefreshing: false,
        onRefresh: () => undefined,
        onClose: () => undefined,
        onOpenProfileSettings: () => undefined,
        onSelectPullRequest: () => undefined
      })
    );

    expect(markup).toContain('Recently pushed branches');
    expect(markup).toContain('feature/recent-work');
    expect(markup).toContain('Compare &amp; create pull request');
    expect(markup).toContain('href="https://github.com/acme/widgets/compare/main...feature%2Frecent-work?quick_pull=1"');
    expect(markup).toContain('target="_blank"');
  });
});

describe('pull request inbox status', () => {
  it('recognizes either GitHub conflict signal', () => {
    expect(
      hasPullRequestMergeConflicts(
        pullRequestSummary({ mergeable: 'conflicting', mergeState: 'unknown' })
      )
    ).toBe(true);
    expect(
      hasPullRequestMergeConflicts(
        pullRequestSummary({ mergeable: 'unknown', mergeState: 'dirty' })
      )
    ).toBe(true);
    expect(hasPullRequestMergeConflicts(pullRequestSummary({}))).toBe(false);
  });

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

  it('shows branch-rule readiness when the pull request is otherwise healthy', () => {
    expect(
      pullRequestStatus(
        pullRequestSummary({
          reviewDecision: 'approved'
        })
      )
    ).toEqual({
      label: 'Ready to merge',
      tone: 'success',
      icon: 'check'
    });
  });

  it('uses clean merge state when GitHub omits the aggregate review decision', () => {
    expect(
      pullRequestStatus(
        pullRequestSummary({
          reviewDecision: 'unknown',
          reviewers: [{
            author: 'teammate',
            authorAvatarUrl: 'https://avatars.example/teammate',
            state: 'approved'
          }]
        })
      )
    ).toEqual({
      label: 'Ready to merge',
      tone: 'success',
      icon: 'check'
    });
  });

  it('shows an outstanding requested reviewer as pending', () => {
    expect(
      pullRequestStatus(
        pullRequestSummary({
          reviewDecision: 'unknown',
          mergeState: 'blocked',
          reviewers: [{
            author: 'teammate',
            state: 'pending'
          }]
        })
      )
    ).toEqual({
      label: 'Awaiting review',
      tone: 'pending',
      icon: 'dot'
    });
  });

  it('surfaces a colleague request for changes without relying on reviewDecision', () => {
    expect(
      pullRequestStatus(
        pullRequestSummary({
          reviewDecision: 'unknown',
          reviewers: [{
            author: 'teammate',
            state: 'changes-requested'
          }]
        })
      )
    ).toEqual({
      label: 'Changes requested',
      tone: 'danger',
      icon: 'warning'
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
    reviewers: [],
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
