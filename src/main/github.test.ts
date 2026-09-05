import { describe, expect, it } from 'vitest';

import type { GitHubPullRequestSummary } from '@shared/types';

import { analyzeReviewPatchSyntax } from './git/reviewSyntax';
import {
  buildCompleteFilePatch,
  buildGitHubFileTextBatchQuery,
  buildGitHubActionsPullRequestGroups,
  buildGitHubPullRequestSuggestion,
  buildGitHubPullRequestReviewPlan,
  canReuseGitHubPullRequestInbox,
  categorizePullRequest,
  createGitHubFileReviewCommentPayload,
  createGitHubReviewerRequestPayload,
  filterGitHubActionsRuns,
  gitHubWorkflowFileArgs,
  gitHubWorkflowRunDetailArgs,
  gitHubWorkflowRunFailedLogArgs,
  gitHubWorkflowRunJobsArgs,
  mergeGitHubPullRequestReviewPlanContext,
  parseGitHubWorkflowRuns,
  parseGitHubWorkflowJobGraph,
  parseGitHubWorkflowRunJobsResponse,
  parseGitHubInboxResponse,
  parseGitHubRecentPushEvents,
  parseGitHubBodyImageUrls,
  parseGitHubPullRequestResponse,
  parseGitHubPullRequestReviewerCandidates,
  parseGitHubFileTextBatchResponse,
  parsePullRequestCommit,
  parseGitHubRepositoriesResponse,
  parseGitHubRepositoryMergeSettings,
  parseReviewComment,
  reviewCommentBelongsToPullRequest,
  searchGitHubActionsRunPages,
  selectGitHubReviewContextFiles
} from './github';

describe('GitHub pull request reviewer requests', () => {
  it('parses and sorts collaborator and team candidates', () => {
    expect(
      parseGitHubPullRequestReviewerCandidates(
        [
          { login: 'zoe', avatar_url: 'https://avatars.example/zoe' },
          { login: 'anna', name: 'Anna Reviewer' }
        ],
        [
          {
            slug: 'platform',
            name: 'Platform',
            organization: { login: 'acme' }
          }
        ]
      )
    ).toEqual([
      {
        id: 'team:acme/platform',
        kind: 'team',
        organization: 'acme',
        slug: 'platform',
        name: 'Platform',
        avatarUrl: undefined
      },
      {
        id: 'user:anna',
        kind: 'user',
        login: 'anna',
        name: 'Anna Reviewer',
        avatarUrl: undefined
      },
      {
        id: 'user:zoe',
        kind: 'user',
        login: 'zoe',
        name: undefined,
        avatarUrl: 'https://avatars.example/zoe'
      }
    ]);
  });

  it('builds GitHub request bodies for users and teams', () => {
    expect(createGitHubReviewerRequestPayload({ kind: 'user', login: 'anna' })).toEqual({
      reviewers: ['anna']
    });
    expect(createGitHubReviewerRequestPayload({ kind: 'team', slug: 'platform' })).toEqual({
      team_reviewers: ['platform']
    });
  });
});

describe('GitHub pull request file context', () => {
  it('batches file contents into one GraphQL repository query', () => {
    const result = buildGitHubFileTextBatchQuery('acme', 'widgets', [
      { path: 'src/old name.ts', ref: 'base-sha' },
      { path: 'src/new:name.ts', ref: 'head-sha' }
    ]);

    expect(result.query).toContain('content0: object(expression: $expression0)');
    expect(result.query).toContain('content1: object(expression: $expression1)');
    expect(result.variables).toEqual({
      owner: 'acme',
      repository: 'widgets',
      expression0: 'base-sha:src/old name.ts',
      expression1: 'head-sha:src/new:name.ts'
    });
  });

  it('keeps complete text blobs and rejects binary, truncated, or missing blobs', () => {
    expect(
      parseGitHubFileTextBatchResponse(
        {
          data: {
            repository: {
              content0: { text: 'complete', isBinary: false, isTruncated: false },
              content1: { text: null, isBinary: true, isTruncated: false },
              content2: { text: 'partial', isBinary: false, isTruncated: true },
              content3: null
            }
          }
        },
        4
      )
    ).toEqual(['complete', undefined, undefined, undefined]);
  });

  it('adds background file context without reordering the visible review', async () => {
    const pullRequest = pullRequestSummary();
    const file = pullRequestFile('src/product.ts');
    const initialPlan = await buildGitHubPullRequestReviewPlan(
      'github.com',
      pullRequest,
      'head-sha',
      [file]
    );
    const enrichedPlan = await buildGitHubPullRequestReviewPlan(
      'github.com',
      pullRequest,
      'head-sha',
      [file],
      [{ path: file.path, oldContents: 'old\n', newContents: 'new\n' }]
    );
    const mergedPlan = mergeGitHubPullRequestReviewPlanContext(initialPlan, enrichedPlan);

    expect(mergedPlan.sourceFingerprint).toBe(initialPlan.sourceFingerprint);
    expect(mergedPlan.units.map((unit) => unit.id)).toEqual(
      initialPlan.units.map((unit) => unit.id)
    );
    expect(mergedPlan.units.flatMap((unit) => unit.chunks).map((chunk) => chunk.id)).toEqual(
      initialPlan.units.flatMap((unit) => unit.chunks).map((chunk) => chunk.id)
    );
    expect(mergedPlan.fileContexts).toEqual(enrichedPlan.fileContexts);
    expect(mergedPlan.units[0]?.chunks[0]?.fileContextId).toBe(
      enrichedPlan.fileContexts[0]?.id
    );
  });
});

describe('GitHub pull request suggestions', () => {
  it('selects the newest branch push by the authenticated user and ignores stale or unrelated events', () => {
    const candidates = parseGitHubRecentPushEvents(
      [
        pushEvent({ createdAt: '2026-08-12T10:00:00Z', head: 'new-head' }),
        pushEvent({ createdAt: '2026-08-11T10:00:00Z', head: 'old-head' }),
        pushEvent({ createdAt: '2026-08-12T09:30:00Z', branch: 'Feature/recent-work' }),
        pushEvent({ createdAt: '2026-08-12T09:00:00Z', actor: 'someone-else', branch: 'feature/other' }),
        pushEvent({ createdAt: '2026-06-01T10:00:00Z', branch: 'feature/stale' }),
        { type: 'IssuesEvent' }
      ],
      'octocat',
      Date.parse('2026-08-01T00:00:00Z')
    );

    expect(candidates).toEqual([
      {
        owner: 'acme',
        repository: 'widgets',
        branch: 'feature/recent-work',
        headSha: 'new-head',
        pushedAt: '2026-08-12T10:00:00Z'
      },
      {
        owner: 'acme',
        repository: 'widgets',
        branch: 'Feature/recent-work',
        headSha: 'head-sha',
        pushedAt: '2026-08-12T09:30:00Z'
      }
    ]);
  });

  it('builds GitHub quick-create URLs only for branches ahead without an open pull request', () => {
    const candidate = {
      owner: 'acme',
      repository: 'widgets',
      branch: 'feature/recent work',
      headSha: 'head-sha',
      pushedAt: '2026-08-12T10:00:00Z'
    };

    expect(
      buildGitHubPullRequestSuggestion(
        candidate,
        'main',
        'https://github.com/acme/widgets',
        [],
        { ahead_by: 3 }
      )
    ).toMatchObject({
      branch: 'feature/recent work',
      defaultBranch: 'main',
      compareUrl: 'https://github.com/acme/widgets/compare/main...feature%2Frecent%20work?quick_pull=1'
    });
    expect(
      buildGitHubPullRequestSuggestion(candidate, 'main', 'https://github.com/acme/widgets', [{}], { ahead_by: 3 })
    ).toBeUndefined();
    expect(
      buildGitHubPullRequestSuggestion(candidate, 'main', 'https://github.com/acme/widgets', [], { ahead_by: 0 })
    ).toBeUndefined();
    expect(
      buildGitHubPullRequestSuggestion(
        { ...candidate, branch: 'main' },
        'main',
        'https://github.com/acme/widgets',
        [],
        { ahead_by: 3 }
      )
    ).toBeUndefined();
  });
});

describe('GitHub Actions dashboards', () => {
  it('loads the run and its workflow file at the exact run revision', () => {
    const input = {
      profileId: 'profile-1',
      owner: 'acme',
      repository: 'widgets',
      runId: 101
    };

    expect(gitHubWorkflowRunDetailArgs(input, 'github.example.com')).toEqual([
      'api',
      '--hostname',
      'github.example.com',
      'repos/acme/widgets/actions/runs/101'
    ]);
    expect(
      gitHubWorkflowFileArgs(
        input,
        '.github/workflows/release production.yml',
        'abc/123',
        'github.example.com'
      )
    ).toEqual([
      'api',
      '--hostname',
      'github.example.com',
      '-H',
      'Accept: application/vnd.github.raw+json',
      'repos/acme/widgets/contents/.github/workflows/release%20production.yml?ref=abc%2F123'
    ]);
  });

  it('parses scalar, inline, and block workflow job dependencies', () => {
    expect(
      parseGitHubWorkflowJobGraph(`name: Release\non: push\njobs:\n  detect-changes:\n    runs-on: ubuntu-latest\n  build:\n    name: Build image\n    needs: detect-changes\n  deploy:\n    name: "Deploy production"\n    needs: [detect-changes, build]\n  record:\n    needs:\n      - build\n      - deploy\n    if: always()\n`)
    ).toEqual([
      { id: 'detect-changes', needs: [] },
      { id: 'build', name: 'Build image', needs: ['detect-changes'] },
      {
        id: 'deploy',
        name: 'Deploy production',
        needs: ['detect-changes', 'build']
      },
      { id: 'record', needs: ['build', 'deploy'] }
    ]);
  });

  it('loads workflow jobs from the selected repository and GitHub host', () => {
    expect(
      gitHubWorkflowRunJobsArgs(
        {
          profileId: 'profile-1',
          owner: 'acme',
          repository: 'widgets',
          runId: 101
        },
        'github.example.com'
      )
    ).toEqual([
      'api',
      '--hostname',
      'github.example.com',
      'repos/acme/widgets/actions/runs/101/jobs?per_page=100'
    ]);
  });

  it('normalizes workflow jobs and steps for the in-app run view', () => {
    const detail = parseGitHubWorkflowRunJobsResponse(
      {
        total_count: 2,
        jobs: [
          {
            id: 500,
            name: 'detect',
            status: 'completed',
            conclusion: 'success',
            html_url: 'https://github.com/acme/widgets/actions/runs/101/job/500',
            labels: [],
            steps: []
          },
          {
            id: 501,
            name: 'build',
            status: 'completed',
            conclusion: 'success',
            html_url: 'https://github.com/acme/widgets/actions/runs/101/job/501',
            started_at: '2026-07-25T10:01:00Z',
            completed_at: '2026-07-25T10:02:00Z',
            runner_name: 'GitHub Actions 1',
            labels: ['ubuntu-latest'],
            steps: [
              {
                number: 1,
                name: 'Checkout',
                status: 'completed',
                conclusion: 'success',
                started_at: '2026-07-25T10:01:00Z',
                completed_at: '2026-07-25T10:01:05Z'
              }
            ]
          }
        ]
      },
      {
        profileId: 'profile-1',
        owner: 'acme',
        repository: 'widgets',
        runId: 101
      },
      [
        { id: 'detect', needs: [] },
        { id: 'build', name: 'build', needs: ['detect'] }
      ],
      '.github/workflows/ci.yml'
    );

    expect(detail).toMatchObject({
      runId: 101,
      workflowPath: '.github/workflows/ci.yml',
      dependencyGraphAvailable: true,
      totalJobCount: 2,
      jobs: [
        {
          id: 500,
          name: 'detect',
          dependencyJobIds: []
        },
        {
          id: 501,
          name: 'build',
          status: 'completed',
          conclusion: 'success',
          runnerName: 'GitHub Actions 1',
          labels: ['ubuntu-latest'],
          dependencyJobIds: [500],
          steps: [{ number: 1, name: 'Checkout', conclusion: 'success' }]
        }
      ]
    });
  });

  it('loads only failed-step logs for the selected run and GitHub host', () => {
    expect(
      gitHubWorkflowRunFailedLogArgs(
        {
          profileId: 'profile-1',
          owner: 'acme',
          repository: 'widgets',
          runId: 101
        },
        'github.example.com'
      )
    ).toEqual([
      'run',
      'view',
      '101',
      '--repo',
      'github.example.com/acme/widgets',
      '--log-failed'
    ]);
  });

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
    const result = parseGitHubWorkflowRuns({
      workflow_runs: [
        workflowRun({ id: 101, status: 'in_progress', conclusion: null }),
        workflowRun({
          id: 100,
          status: 'completed',
          conclusion: 'timed_out',
          run_started_at: null
        })
      ]
    });

    expect(result).toMatchObject([
      {
        id: 101,
        status: 'in-progress',
        conclusion: undefined,
        createdAt: '2026-07-25T10:00:00Z',
        startedAt: '2026-07-25T10:01:00Z'
      },
      { id: 100, status: 'completed', conclusion: 'timed-out', startedAt: undefined }
    ]);

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
    const parsed = parseGitHubWorkflowRuns({
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
    });

    expect(
      filterGitHubActionsRuns(
        parsed,
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
      suggestions: [],
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

  it('parses a merged pull request outside the open inbox', () => {
    const response = parseGitHubPullRequestResponse(
      {
        data: {
          viewer: { login: 'octocat' },
          repository: {
            pullRequest: pullRequestNode({
              number: 699,
              state: 'MERGED',
              title: 'Fix price, SEO, and sitemap edge cases',
              url: 'https://github.com/VosoBrands/hive/pull/699',
              repository: { nameWithOwner: 'VosoBrands/hive' },
              headRepository: { nameWithOwner: 'VosoBrands/hive' },
              author: { login: 'octocat' }
            })
          }
        }
      },
      'work'
    );

    expect(response.viewerLogin).toBe('octocat');
    expect(response.pullRequest).toMatchObject({
      profileId: 'work',
      owner: 'VosoBrands',
      repository: 'hive',
      number: 699,
      state: 'merged'
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

  it('pairs GitHub attachment sources with authenticated rendered image URLs', () => {
    const sourceUrl = 'https://github.com/user-attachments/assets/image-id';
    const renderedUrl = 'https://private-user-images.githubusercontent.com/1/image-id.png?jwt=signed';

    expect(
      parseGitHubBodyImageUrls(
        `<img width="900" alt="Overview" src="${sourceUrl}" />`,
        `<p><img alt="Overview" src="${renderedUrl}" /></p>`
      )
    ).toEqual({ [sourceUrl]: renderedUrl });
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

  it('bounds textual context files in review priority order', async () => {
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
    const firstTwoPaths = selectGitHubReviewContextFiles(reviewPlan, files, 2)
      .map((file) => file.path);

    expect(selectedPaths).toHaveLength(24);
    expect(firstTwoPaths).toEqual(selectedPaths.slice(0, 2));
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
  return parseGitHubWorkflowRuns({ workflow_runs: runs });
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

function pushEvent({
  actor = 'octocat',
  branch = 'feature/recent-work',
  createdAt,
  head = 'head-sha'
}: {
  actor?: string;
  branch?: string;
  createdAt: string;
  head?: string;
}): Record<string, unknown> {
  return {
    type: 'PushEvent',
    actor: { login: actor },
    repo: { name: 'acme/widgets' },
    created_at: createdAt,
    payload: {
      ref: `refs/heads/${branch}`,
      head
    }
  };
}
