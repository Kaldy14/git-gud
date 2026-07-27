import { describe, expect, it } from 'vitest';

import type { GitHubPullRequestSummary } from '@shared/types';

import {
  buildCompleteFilePatch,
  buildGitHubPullRequestReviewPlan,
  categorizePullRequest,
  createGitHubFileReviewCommentPayload,
  parseGitHubActionsRunsResponse,
  parseGitHubInboxResponse,
  parseGitHubRepositoriesResponse,
  parseGitHubRepositoryMergeSettings,
  parseReviewComment,
  reviewCommentBelongsToPullRequest,
  selectGitHubReviewContextFiles
} from './github';

describe('GitHub Actions dashboards', () => {
  it('parses accessible repositories for the project selector', () => {
    expect(
      parseGitHubRepositoriesResponse([
        {
          name: 'widgets',
          full_name: 'acme/widgets',
          html_url: 'https://github.com/acme/widgets',
          private: true,
          default_branch: 'main',
          owner: { login: 'acme' }
        }
      ])
    ).toEqual([
      {
        owner: 'acme',
        name: 'widgets',
        fullName: 'acme/widgets',
        url: 'https://github.com/acme/widgets',
        isPrivate: true,
        defaultBranch: 'main'
      }
    ]);
  });

  it('normalizes running and completed workflow runs', () => {
    const result = parseGitHubActionsRunsResponse(
      {
        workflow_runs: [
          workflowRun({ id: 101, status: 'in_progress', conclusion: null }),
          workflowRun({ id: 100, status: 'completed', conclusion: 'timed_out' })
        ]
      },
      {
        profileId: 'profile-1',
        owner: 'acme',
        repository: 'widgets',
        limit: 2
      }
    );

    expect(result.runs).toMatchObject([
      { id: 101, status: 'in-progress', conclusion: undefined },
      { id: 100, status: 'completed', conclusion: 'timed-out' }
    ]);
    expect(result).toMatchObject({
      profileId: 'profile-1',
      owner: 'acme',
      repository: 'widgets'
    });
  });
});

describe('GitHub pull request inbox', () => {
  it('parses and builds file-level review comments', () => {
    expect(parseReviewComment({
      id: 123,
      body: 'Consider splitting this module.',
      user: { login: 'octocat', avatar_url: 'https://avatars.example/octocat' },
      html_url: 'https://github.com/acme/widgets/pull/42#discussion_r123',
      path: 'src/widget.ts',
      subject_type: 'file',
      created_at: '2026-07-27T10:00:00Z',
      updated_at: '2026-07-27T10:00:00Z'
    })).toMatchObject({
      id: 123,
      path: 'src/widget.ts',
      subjectType: 'file',
      line: undefined,
      side: undefined
    });
    expect(createGitHubFileReviewCommentPayload({
      id: 'draft-file-1',
      body: 'Consider splitting this module.',
      path: 'src/widget.ts'
    }, 'head-sha')).toEqual({
      body: 'Consider splitting this module.',
      commit_id: 'head-sha',
      path: 'src/widget.ts',
      subject_type: 'file'
    });
  });

  it('scopes review comment edits to the requested pull request', () => {
    const locator = {
      profileId: 'profile-1',
      owner: 'acme',
      repository: 'widgets',
      number: 42
    };
    expect(
      reviewCommentBelongsToPullRequest(
        'https://api.github.com/repos/acme/widgets/pulls/42',
        locator
      )
    ).toBe(true);
    expect(
      reviewCommentBelongsToPullRequest(
        'https://github.acme.test/api/v3/repos/acme/widgets/pulls/42',
        locator
      )
    ).toBe(true);
    expect(
      reviewCommentBelongsToPullRequest(
        'https://api.github.com/repos/acme/widgets/pulls/41',
        locator
      )
    ).toBe(false);
  });

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
                id: 'conflict',
                number: 5,
                title: 'Conflicting work',
                mergeStateStatus: 'DIRTY',
                mergeable: 'CONFLICTING'
              }),
              pullRequestNode({
                id: 'action',
                number: 6,
                title: 'Changes requested',
                reviewDecision: 'CHANGES_REQUESTED'
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
      { id: 'conflict', category: 'waiting' },
      { id: 'action', category: 'needs-action' },
      { id: 'ready', category: 'ready-to-merge' }
    ]);
    expect(response.pullRequests.find((pullRequest) => pullRequest.id === 'direct')).toMatchObject({
      comments: 5,
      authorAvatarUrl: 'https://avatars.example/developer'
    });
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
    const oldContents = Array.from({ length: 12 }, (_, index) => `line ${index + 1}\n`).join('');
    const newContents = oldContents.replace('line 6\n', 'export const timeout = 20\n');
    const reviewPlan = buildGitHubPullRequestReviewPlan(
      'github.com',
      pullRequest,
      'head-sha',
      [
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
            '@@ -3,7 +3,7 @@',
            ' line 3',
            ' line 4',
            ' line 5',
            '-line 6',
            '+export const timeout = 20',
            ' line 7',
            ' line 8',
            ' line 9'
          ].join('\n')
        }
      ],
      [{ path: 'src/auth/session.ts', oldContents, newContents }]
    );

    expect(reviewPlan.repoPath).toBe('github://github.com/acme/widgets');
    expect(reviewPlan.target).toEqual({
      kind: 'branch',
      name: 'feature/focused-review',
      sha: 'head-sha'
    });
    expect(reviewPlan.targetKey).toContain('github-pr:profile-1:acme/widgets#42:head-sha');
    expect(reviewPlan.units.flatMap((unit) => unit.chunks)).toHaveLength(1);
    expect(reviewPlan.fileContexts).toEqual([
      expect.objectContaining({
        path: 'src/auth/session.ts',
        oldContents,
        newContents
      })
    ]);
    expect(reviewPlan.units[0]?.chunks[0]?.fileContextId).toBe(reviewPlan.fileContexts[0]?.id);
  });

  it('bounds remote file-context requests in focused review order', () => {
    const pullRequest = pullRequestSummary();
    const files = [
      pullRequestFile('src/first.ts'),
      pullRequestFile('src/second.ts'),
      pullRequestFile('src/third.ts'),
      { ...pullRequestFile('src/added.ts'), status: 'added' as const }
    ];
    const reviewPlan = buildGitHubPullRequestReviewPlan('github.com', pullRequest, 'head-sha', files);

    expect(selectGitHubReviewContextFiles(reviewPlan, files, 2).map((file) => file.path)).toEqual([
      'src/first.ts',
      'src/second.ts'
    ]);
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

function pullRequestSummary(): GitHubPullRequestSummary {
  return {
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
}

function pullRequestFile(path: string) {
  return {
    sha: `blob-${path}`,
    path,
    status: 'modified' as const,
    additions: 1,
    deletions: 1,
    changes: 2,
    patch: [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      '@@ -1 +1 @@',
      '-old',
      '+new'
    ].join('\n')
  };
}

function workflowRun(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 101,
    name: 'CI',
    display_title: 'Verify dashboard support',
    run_number: 42,
    event: 'push',
    head_branch: 'feature/dashboards',
    head_sha: 'abcdef1234567890',
    status: 'completed',
    conclusion: 'success',
    html_url: 'https://github.com/acme/widgets/actions/runs/101',
    actor: { login: 'developer' },
    created_at: '2026-07-25T10:00:00Z',
    updated_at: '2026-07-25T10:02:00Z',
    ...overrides
  };
}

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
    headRefOid: 'head-sha',
    baseRefName: 'main',
    author: { login: 'developer', avatarUrl: 'https://avatars.example/developer' },
    repository: { nameWithOwner: 'acme/widgets' },
    headRepository: { nameWithOwner: 'acme/widgets' },
    totalCommentsCount: 5,
    reviewRequests: { nodes: [] },
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
    },
    ...overrides
  };
}
