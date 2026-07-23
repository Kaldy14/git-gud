import { describe, expect, it } from 'vitest';

import type { GitHubPullRequestSummary } from '@shared/types';

import {
  buildCompleteFilePatch,
  buildGitHubPullRequestReviewPlan,
  categorizePullRequest,
  parseGitHubInboxResponse,
  parseGitHubRepositoryMergeSettings
} from './github';

describe('GitHub pull request inbox', () => {
  it('groups direct review requests, team requests, and authored work by next action', () => {
    const response = parseGitHubInboxResponse(
      {
        data: {
          viewer: { login: 'octocat' },
          review: {
            nodes: [
              pullRequestNode({
                id: 'direct',
                number: 1,
                title: 'Direct review',
                reviewRequests: {
                  nodes: [{ requestedReviewer: { __typename: 'User', login: 'octocat' } }]
                }
              }),
              pullRequestNode({
                id: 'team',
                number: 2,
                title: 'Team review',
                reviewRequests: {
                  nodes: [{ requestedReviewer: { __typename: 'Team', slug: 'platform' } }]
                }
              })
            ]
          },
          authored: {
            nodes: [
              pullRequestNode({
                id: 'draft',
                number: 3,
                title: 'Draft work',
                isDraft: true
              }),
              pullRequestNode({
                id: 'ready',
                number: 4,
                title: 'Ready work',
                reviewDecision: 'APPROVED',
                mergeStateStatus: 'CLEAN',
                mergeable: 'MERGEABLE'
              }),
              pullRequestNode({
                id: 'action',
                number: 5,
                title: 'Conflicting work',
                mergeStateStatus: 'DIRTY',
                mergeable: 'CONFLICTING'
              })
            ]
          }
        }
      },
      'profile-1',
      'github.com'
    );

    expect(response.pullRequests.map(({ id, category }) => ({ id, category }))).toEqual([
      { id: 'direct', category: 'needs-your-review' },
      { id: 'team', category: 'needs-team-review' },
      { id: 'draft', category: 'drafts' },
      { id: 'action', category: 'needs-action' },
      { id: 'ready', category: 'ready-to-merge' }
    ]);
    expect(response.pullRequests.find((pullRequest) => pullRequest.id === 'ready')?.checks).toEqual({
      state: 'success',
      total: 3,
      passed: 2,
      failed: 0,
      pending: 1
    });
  });

  it('keeps approved work waiting while checks are pending', () => {
    expect(
      categorizePullRequest({
        source: 'authored',
        viewerLogin: 'octocat',
        isDraft: false,
        reviewDecision: 'approved',
        mergeState: 'clean',
        mergeable: 'mergeable',
        checks: {
          state: 'pending',
          total: 4,
          passed: 2,
          failed: 0,
          pending: 2
        },
        reviewRequests: { nodes: [] }
      })
    ).toBe('waiting');
  });

  it('turns GitHub hunk-only file patches into one complete diff', () => {
    expect(
      buildCompleteFilePatch(
        {
          filename: 'src/widget.ts',
          previous_filename: 'src/old-widget.ts',
          status: 'renamed'
        },
        '@@ -1 +1 @@\n-old\n+new'
      )
    ).toBe(
      [
        'diff --git a/src/old-widget.ts b/src/widget.ts',
        '--- a/src/old-widget.ts',
        '+++ b/src/widget.ts',
        '@@ -1 +1 @@',
        '-old',
        '+new'
      ].join('\n')
    );
  });

  it('quotes paths with spaces in reconstructed patches', () => {
    expect(
      buildCompleteFilePatch(
        {
          filename: 'src/new widget.ts',
          previous_filename: 'src/old widget.ts',
          status: 'renamed'
        },
        '@@ -1 +1 @@\n-old\n+new'
      )
    ).toContain('diff --git "a/src/old widget.ts" "b/src/new widget.ts"');
  });

  it('feeds remote pull request patches into the focused review plan', () => {
    const pullRequest: GitHubPullRequestSummary = {
      profileId: 'profile-1',
      id: 'pr-42',
      owner: 'acme',
      repository: 'widgets',
      number: 42,
      title: 'Focus the review',
      url: 'https://github.com/acme/widgets/pull/42',
      author: 'developer',
      updatedAt: '2026-07-23T10:00:00Z',
      category: 'needs-your-review',
      isDraft: false,
      reviewDecision: 'review-required',
      mergeState: 'blocked',
      mergeable: 'mergeable',
      canMerge: true,
      comments: 0,
      changedFiles: 1,
      additions: 1,
      deletions: 1,
      headRefName: 'feature/focused-review',
      baseRefName: 'main',
      checks: { state: 'success', total: 1, passed: 1, failed: 0, pending: 0 }
    };
    const reviewPlan = buildGitHubPullRequestReviewPlan('github.com', pullRequest, 'head-sha', [
      {
        sha: 'blob-sha',
        path: 'src/auth/session.ts',
        status: 'modified',
        additions: 1,
        deletions: 1,
        changes: 2,
        patch: [
          'diff --git a/src/auth/session.ts b/src/auth/session.ts',
          '--- a/src/auth/session.ts',
          '+++ b/src/auth/session.ts',
          '@@ -1 +1 @@',
          '-export const timeout = 10',
          '+export const timeout = 20'
        ].join('\n')
      }
    ]);

    expect(reviewPlan.repoPath).toBe('github://github.com/acme/widgets');
    expect(reviewPlan.target).toEqual({
      kind: 'branch',
      name: 'feature/focused-review',
      sha: 'head-sha'
    });
    expect(reviewPlan.targetKey).toContain('github-pr:profile-1:acme/widgets#42:head-sha');
    expect(reviewPlan.units.flatMap((unit) => unit.chunks)).toHaveLength(1);
  });

  it('uses only merge methods enabled by the GitHub repository', () => {
    expect(
      parseGitHubRepositoryMergeSettings({
        allow_squash_merge: true,
        allow_merge_commit: false,
        allow_rebase_merge: false
      })
    ).toEqual({
      allowedMethods: ['squash'],
      defaultMethod: 'squash'
    });

    expect(
      parseGitHubRepositoryMergeSettings({
        allow_squash_merge: false,
        allow_merge_commit: true,
        allow_rebase_merge: true
      })
    ).toEqual({
      allowedMethods: ['merge', 'rebase'],
      defaultMethod: 'merge'
    });
  });
});

function pullRequestNode(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'pull-request',
    number: 1,
    title: 'Pull request',
    url: 'https://github.com/acme/widgets/pull/1',
    updatedAt: '2026-07-23T10:00:00Z',
    isDraft: false,
    state: 'OPEN',
    reviewDecision: null,
    mergeStateStatus: 'BLOCKED',
    mergeable: 'MERGEABLE',
    viewerCanUpdate: true,
    viewerCanClose: true,
    changedFiles: 2,
    additions: 8,
    deletions: 3,
    headRefName: 'feature/review',
    baseRefName: 'main',
    author: { login: 'developer', avatarUrl: 'https://avatars.example/developer' },
    repository: { nameWithOwner: 'acme/widgets' },
    comments: { totalCount: 2 },
    reviewRequests: { nodes: [] },
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              state: 'SUCCESS',
              contexts: {
                totalCount: 3,
                nodes: [
                  { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
                  { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED' },
                  { __typename: 'StatusContext', state: 'SUCCESS' }
                ]
              }
            }
          }
        }
      ]
    },
    ...overrides
  };
}
