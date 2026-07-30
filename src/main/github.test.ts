import { describe, expect, it } from 'vitest';

import type { GitHubPullRequestSummary } from '@shared/types';

import { analyzeReviewPatchSyntax } from './git/reviewSyntax';
import {
  buildCompleteFilePatch,
  buildGitHubActionsPullRequestGroups,
  buildGitHubPullRequestReviewPlan,
  canReuseGitHubPullRequestInbox,
  categorizePullRequest,
  createGitHubFileReviewCommentPayload,
  filterGitHubActionsRuns,
  parseGitHubActionsRunsResponse,
  parseGitHubInboxResponse,
  parsePullRequestCommit,
  parseGitHubRepositoriesResponse,
  parseGitHubRepositoryMergeSettings,
  parseReviewComment,
  reviewCommentBelongsToPullRequest,
  searchGitHubActionsRunPages,
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
          workflowRun({
            id: 100,
            status: 'completed',
            conclusion: 'timed_out',
            run_started_at: null
          })
        ]
      },
      {
        profileId: 'profile-1',
        owner: 'acme',
        repository: 'widgets',
        limit: 2,
        view: 'runs',
        filters: {
          branches: [],
          includeTags: false,
          includeMyPullRequests: false
        }
      }
    );

    expect(result.runs).toMatchObject([
      {
        id: 101,
        status: 'in-progress',
        conclusion: undefined,
        createdAt: '2026-07-25T10:00:00Z',
        startedAt: '2026-07-25T10:01:00Z'
      },
      { id: 100, status: 'completed', conclusion: 'timed-out', startedAt: undefined }
    ]);
    expect(result).toMatchObject({
      profileId: 'profile-1',
      owner: 'acme',
      repository: 'widgets',
      searchedRunCount: 2,
      searchLimitReached: false
    });
  });

  it('does not treat an issue comment execution ref as a branch', () => {
    const [run] = parsedWorkflowRuns([
      workflowRun({
        event: 'issue_comment',
        head_branch: 'main',
        display_title: 'PR title',
        pull_requests: []
      })
    ]);

    expect(run).toMatchObject({
      event: 'issue_comment',
      branch: undefined,
      displayTitle: 'PR title'
    });
    expect(
      filterGitHubActionsRuns(
        [run],
        {
          branches: ['main'],
          includeTags: false,
          includeMyPullRequests: false
        }
      )
    ).toEqual([]);
  });

  it('combines exact branch, current tag, and authored pull request filters with OR semantics', () => {
    const parsed = parseGitHubActionsRunsResponse(
      {
        workflow_runs: [
          workflowRun({ id: 1, head_branch: 'main', head_sha: 'main-sha' }),
          workflowRun({ id: 2, head_branch: 'v2.0.0', head_sha: 'tag-sha', event: 'push' }),
          workflowRun({
            id: 3,
            head_branch: 'feature/mine',
            head_sha: 'pr-sha',
            event: 'pull_request',
            pull_requests: [{ number: 42 }]
          }),
          workflowRun({ id: 4, head_branch: 'develop', head_sha: 'other-sha' }),
          workflowRun({ id: 5, head_branch: 'v2.0.0', head_sha: 'old-tag-sha', event: 'push' }),
          workflowRun({ id: 6, head_branch: 'v2.0.0', head_sha: 'tag-sha', event: 'workflow_dispatch' })
        ]
      },
      {
        profileId: 'profile-1',
        owner: 'acme',
        repository: 'widgets',
        limit: 20,
        view: 'runs',
        filters: {
          branches: [],
          includeTags: false,
          includeMyPullRequests: false
        }
      }
    );

    expect(
      filterGitHubActionsRuns(
        parsed.runs,
        {
          branches: ['main'],
          includeTags: true,
          includeMyPullRequests: true
        },
        [{ name: 'v2.0.0', sha: 'tag-sha' }],
        new Set([42])
      ).map((run) => run.id)
    ).toEqual([1, 2, 3]);
  });

  it('searches later pages when the first 100 workflow runs do not match', async () => {
    const firstPage = parsedWorkflowRuns(
      Array.from({ length: 100 }, (_, index) =>
        workflowRun({ id: 1_000 - index, head_branch: 'develop' })
      )
    );
    const secondPage = parsedWorkflowRuns([
      ...Array.from({ length: 20 }, (_, index) =>
        workflowRun({ id: 900 - index, head_branch: 'develop' })
      ),
      workflowRun({ id: 42, head_branch: 'main' })
    ]);
    const loadedPages: number[] = [];
    const result = await searchGitHubActionsRunPages(
      1,
      async (page) => {
        loadedPages.push(page);
        return page === 1 ? firstPage : secondPage;
      },
      async (runs) =>
        filterGitHubActionsRuns(runs, {
          branches: ['main'],
          includeTags: false,
          includeMyPullRequests: false
        })
    );

    expect(loadedPages).toEqual([1, 2]);
    expect(result).toMatchObject({
      searchedRunCount: 121,
      searchLimitReached: false
    });
    expect(result.runs.map((run) => run.id)).toEqual([42]);
  });

  it('reports when a filtered search reaches its 500-run boundary', async () => {
    const page = parsedWorkflowRuns(
      Array.from({ length: 100 }, (_, index) =>
        workflowRun({ id: index + 1, head_branch: 'develop' })
      )
    );
    const loadedPages: number[] = [];
    const result = await searchGitHubActionsRunPages(
      1,
      async (pageNumber) => {
        loadedPages.push(pageNumber);
        return page;
      },
      async () => []
    );

    expect(loadedPages).toEqual([1, 2, 3, 4, 5]);
    expect(result).toEqual({
      runs: [],
      searchedRunCount: 500,
      searchLimitReached: true
    });
  });

  it('groups open authored pull requests by their latest workflow attempts', () => {
    const pullRequest = pullRequestSummary();
    const runs = parsedWorkflowRuns([
      workflowRun({
        id: 103,
        name: 'Build',
        created_at: '2026-07-25T12:00:00Z',
        event: 'pull_request',
        pull_requests: [{ number: 42 }]
      }),
      workflowRun({
        id: 102,
        name: 'Preview',
        created_at: '2026-07-25T11:00:00Z',
        event: 'pull_request',
        pull_requests: [{ number: 42 }]
      }),
      workflowRun({
        id: 101,
        name: 'Build',
        created_at: '2026-07-25T10:00:00Z',
        event: 'pull_request',
        pull_requests: [{ number: 42 }]
      })
    ]);

    expect(
      buildGitHubActionsPullRequestGroups(
        [
          pullRequest,
          { ...pullRequest, id: 'pr-43', number: 43, author: 'someone-else' },
          { ...pullRequest, id: 'pr-44', number: 44, repository: 'api' }
        ],
        runs,
        'developer',
        'acme',
        'widgets',
        5
      )
    ).toEqual([
      {
        number: 42,
        title: 'Focus the review',
        url: 'https://github.com/acme/widgets/pull/42',
        headRefName: 'feature/focused-review',
        baseRefName: 'main',
        updatedAt: '2026-07-23T10:00:00Z',
        runs: [expect.objectContaining({ id: 103 }), expect.objectContaining({ id: 102 })]
      }
    ]);
  });
});

describe('GitHub pull request loading', () => {
  it('reuses only a fresh inbox while opening pull request detail', () => {
    const now = Date.parse('2026-07-28T10:00:00.000Z');
    const inbox = {
      profileId: 'profile-1',
      viewerLogin: 'reviewer',
      host: 'github.com',
      pullRequests: [],
      loadedAt: '2026-07-28T09:59:45.000Z'
    };

    expect(canReuseGitHubPullRequestInbox(inbox, now)).toBe(true);
    expect(
      canReuseGitHubPullRequestInbox(
        { ...inbox, loadedAt: '2026-07-28T09:59:29.999Z' },
        now
      )
    ).toBe(false);
    expect(
      canReuseGitHubPullRequestInbox(
        { ...inbox, loadedAt: 'not-a-date' },
        now
      )
    ).toBe(false);
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
                  nodes: [{
                    requestedReviewer: {
                      __typename: 'User',
                      login: 'octocat',
                      avatarUrl: 'https://avatars.example/octocat'
                    }
                  }]
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
                mergeable: 'CONFLICTING',
                latestReviews: {
                  nodes: [{
                    state: 'APPROVED',
                    submittedAt: '2026-07-23T09:00:00Z',
                    author: {
                      login: 'teammate',
                      avatarUrl: 'https://avatars.example/teammate'
                    }
                  }]
                }
              }),
              pullRequestNode({
                id: 'action',
                number: 6,
                title: 'Changes requested',
                reviewDecision: 'CHANGES_REQUESTED',
                latestReviews: {
                  nodes: [{
                    state: 'CHANGES_REQUESTED',
                    submittedAt: '2026-07-23T09:30:00Z',
                    author: {
                      login: 'strict-reviewer',
                      avatarUrl: 'https://avatars.example/strict-reviewer'
                    }
                  }]
                }
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
      authorAvatarUrl: 'https://avatars.example/developer',
      reviewers: [{
        author: 'octocat',
        authorAvatarUrl: 'https://avatars.example/octocat',
        state: 'pending'
      }]
    });
    expect(response.pullRequests.find((pullRequest) => pullRequest.id === 'conflict')?.reviewers).toEqual([
      {
        author: 'teammate',
        authorAvatarUrl: 'https://avatars.example/teammate',
        state: 'approved',
        submittedAt: '2026-07-23T09:00:00Z'
      }
    ]);
    expect(response.pullRequests.find((pullRequest) => pullRequest.id === 'action')?.reviewers).toEqual([
      {
        author: 'strict-reviewer',
        authorAvatarUrl: 'https://avatars.example/strict-reviewer',
        state: 'changes-requested',
        submittedAt: '2026-07-23T09:30:00Z'
      }
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
        reviewers: [],
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

  it('treats clean merge rules as ready when GitHub omits the aggregate review decision', () => {
    expect(
      categorizePullRequest({
        source: 'authored',
        viewerLogin: 'octocat',
        isDraft: false,
        reviewDecision: 'unknown',
        mergeState: 'clean',
        mergeable: 'mergeable',
        reviewers: [{
          author: 'teammate',
          state: 'approved'
        }],
        checks: {
          state: 'success',
          total: 3,
          passed: 3,
          failed: 0,
          pending: 0
        },
        reviewRequests: { nodes: [] }
      })
    ).toBe('ready-to-merge');
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

  it('parses pull request commits for the overview timeline', () => {
    expect(
      parsePullRequestCommit({
        sha: 'abcdef1234567890',
        html_url: 'https://github.com/acme/widgets/commit/abcdef1234567890',
        author: {
          login: 'developer',
          avatar_url: 'https://avatars.example/developer'
        },
        commit: {
          message: 'Add approval context\n\nKeep aggregate state visible.',
          author: {
            name: 'Developer',
            date: '2026-07-29T08:00:00Z'
          },
          committer: {
            date: '2026-07-29T08:01:00Z'
          }
        }
      })
    ).toEqual({
      sha: 'abcdef1234567890',
      message: 'Add approval context\n\nKeep aggregate state visible.',
      author: 'developer',
      authorAvatarUrl: 'https://avatars.example/developer',
      committedAt: '2026-07-29T08:00:00Z',
      url: 'https://github.com/acme/widgets/commit/abcdef1234567890'
    });
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

  it('feeds remote pull request patches into the focused review plan', async () => {
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
      reviewers: [],
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
    const reviewPlan = await buildGitHubPullRequestReviewPlan(
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

  it('uses Tree-sitter contexts for added and removed pull request files', async () => {
    const pullRequest = pullRequestSummary();
    const addedDefinition = [
      'export function loadProduct() {',
      '  return null;',
      '}'
    ].join('\n');
    const removedDefinition = [
      'export function loadLegacyProduct() {',
      '  return null;',
      '}'
    ].join('\n');
    const files = [
      {
        ...pullRequestFile('src/load-product.ts'),
        status: 'added' as const,
        additions: 3,
        deletions: 0,
        changes: 3,
        patch: [
          'diff --git a/src/load-product.ts b/src/load-product.ts',
          '--- /dev/null',
          '+++ b/src/load-product.ts',
          '@@ -0,0 +1,3 @@',
          '+export function loadProduct() {',
          '+  return null;',
          '+}'
        ].join('\n')
      },
      {
        ...pullRequestFile('src/load-legacy-product.ts'),
        status: 'removed' as const,
        additions: 0,
        deletions: 3,
        changes: 3,
        patch: [
          'diff --git a/src/load-legacy-product.ts b/src/load-legacy-product.ts',
          '--- a/src/load-legacy-product.ts',
          '+++ /dev/null',
          '@@ -1,3 +0,0 @@',
          '-export function loadLegacyProduct() {',
          '-  return null;',
          '-}'
        ].join('\n')
      }
    ];
    const reviewPlan = await buildGitHubPullRequestReviewPlan(
      'github.com',
      pullRequest,
      'head-sha',
      files,
      [
        {
          path: 'src/load-product.ts',
          oldContents: '',
          newContents: addedDefinition
        },
        {
          path: 'src/load-legacy-product.ts',
          oldContents: removedDefinition,
          newContents: ''
        }
      ]
    );
    const addedContext = reviewPlan.fileContexts.find((context) =>
      context.path === 'src/load-product.ts'
    );
    const removedContext = reviewPlan.fileContexts.find((context) =>
      context.path === 'src/load-legacy-product.ts'
    );

    expect(addedContext?.syntax).toMatchObject({
      language: 'typescript',
      oldNodes: [],
      hasErrors: false
    });
    expect(addedContext?.syntax?.newNodes.length).toBeGreaterThan(0);
    expect(removedContext?.syntax).toMatchObject({
      language: 'typescript',
      newNodes: [],
      hasErrors: false
    });
    expect(removedContext?.syntax?.oldNodes.length).toBeGreaterThan(0);
  });

  it('uses compact prepared syntax after full file context is no longer retained', async () => {
    const pullRequest = pullRequestSummary();
    const path = 'src/load-product.ts';
    const newContents = 'export function loadProduct() { return null; }\n';
    const file = {
      ...pullRequestFile(path),
      status: 'added' as const,
      additions: 1,
      deletions: 0,
      changes: 1,
      patch: [
        `diff --git a/${path} b/${path}`,
        '--- /dev/null',
        `+++ b/${path}`,
        '@@ -0,0 +1 @@',
        '+export function loadProduct() { return null; }'
      ].join('\n')
    };
    const syntax = await analyzeReviewPatchSyntax(
      path,
      file.patch,
      { oldContents: '', newContents },
      'github-prepared-syntax'
    );
    const reviewPlan = await buildGitHubPullRequestReviewPlan(
      'github.com',
      pullRequest,
      'head-sha',
      [file],
      [],
      new Map([[path, syntax]])
    );

    expect(reviewPlan.fileContexts).toEqual([]);
    expect(reviewPlan.units[0]?.chunks[0]).toMatchObject({
      path,
      role: 'anchor',
      reviewSection: 'definition'
    });
  });

  it('selects every textual pull request file for context analysis', async () => {
    const pullRequest = pullRequestSummary();
    const files = [
      ...Array.from({ length: 30 }, (_, index) => pullRequestFile(`src/file-${index}.ts`)),
      { ...pullRequestFile('src/added.ts'), status: 'added' as const },
      { ...pullRequestFile('src/removed.ts'), status: 'removed' as const },
      { ...pullRequestFile('assets/logo.png'), patch: undefined, omittedReason: 'binary' as const }
    ];
    const reviewPlan = await buildGitHubPullRequestReviewPlan(
      'github.com',
      pullRequest,
      'head-sha',
      files
    );
    const selectedPaths = selectGitHubReviewContextFiles(reviewPlan, files).map((file) => file.path);

    expect(selectedPaths).toHaveLength(32);
    expect(selectedPaths).toContain('src/added.ts');
    expect(selectedPaths).toContain('src/removed.ts');
    expect(selectedPaths).not.toContain('assets/logo.png');
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
    reviewers: [],
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
    run_started_at: '2026-07-25T10:01:00Z',
    updated_at: '2026-07-25T10:02:00Z',
    ...overrides
  };
}

function parsedWorkflowRuns(runs: Record<string, unknown>[]) {
  return parseGitHubActionsRunsResponse(
    { workflow_runs: runs },
    {
      profileId: 'profile-1',
      owner: 'acme',
      repository: 'widgets',
      limit: runs.length,
      view: 'runs',
      filters: {
        branches: [],
        includeTags: false,
        includeMyPullRequests: false
      }
    }
  ).runs;
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
    latestReviews: { nodes: [] },
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
