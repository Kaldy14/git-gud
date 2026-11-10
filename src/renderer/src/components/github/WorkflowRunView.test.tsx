import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { gitHubWorkflowRunDetailQueryKey } from '@renderer/queries/github';
import type { GitHubWorkflowRun } from '@shared/types';

import { WorkflowRunView } from './WorkflowRunView';
import {
  arrangeWorkflowJobGraph,
  layoutWorkflowJobGraph,
  reduceWorkflowJobDependencies,
  workflowFailureFlow
} from './workflowRunGraph';

describe('WorkflowRunView', () => {
  it('renders an in-app summary with job navigation and steps data available', () => {
    const queryClient = new QueryClient();
    const input = {
      profileId: 'profile-1',
      owner: 'acme',
      repository: 'widgets',
      runId: 101
    };
    queryClient.setQueryData(gitHubWorkflowRunDetailQueryKey(input), {
      ...input,
      workflowPath: '.github/workflows/ci.yml',
      dependencyGraphAvailable: true,
      totalJobCount: 1,
      jobs: [
        {
          id: 501,
          name: 'build-and-test',
          dependencyJobIds: [],
          status: 'completed',
          conclusion: 'success',
          url: 'https://github.com/acme/widgets/actions/runs/101/job/501',
          startedAt: '2026-07-27T10:01:00Z',
          completedAt: '2026-07-27T10:02:00Z',
          runnerName: 'GitHub Actions 1',
          labels: ['ubuntu-latest'],
          steps: [
            {
              number: 1,
              name: 'Checkout',
              status: 'completed',
              conclusion: 'success',
              startedAt: '2026-07-27T10:01:00Z',
              completedAt: '2026-07-27T10:01:05Z'
            }
          ]
        }
      ],
      loadedAt: '2026-07-27T10:02:00Z'
    });

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <WorkflowRunView
          profileId={input.profileId}
          owner={input.owner}
          repository={input.repository}
          run={workflowRun()}
          onBack={vi.fn()}
        />
      </QueryClientProvider>
    );

    expect(markup).toContain('Workflow run Verify dashboard support');
    expect(markup).toContain('Summary');
    expect(markup).toContain('All jobs');
    expect(markup).toContain('build-and-test');
    expect(markup).toContain('Open on GitHub');
    expect(markup).toContain('CI');
  });

  it('renders full job names in navigation and graph cards without truncation hints', () => {
    const queryClient = new QueryClient();
    const input = {
      profileId: 'profile-1',
      owner: 'acme',
      repository: 'widgets',
      runId: 101
    };
    const longName =
      'Deploy Customer Access with Pulumi / deploy-production-eu-central-1-cluster';
    queryClient.setQueryData(gitHubWorkflowRunDetailQueryKey(input), {
      ...input,
      workflowPath: '.github/workflows/ci.yml',
      dependencyGraphAvailable: true,
      totalJobCount: 2,
      jobs: [workflowJob(1, 'detect-changes'), workflowJob(2, longName, [1])],
      loadedAt: '2026-07-27T10:02:00Z'
    });

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <WorkflowRunView
          profileId={input.profileId}
          owner={input.owner}
          repository={input.repository}
          run={workflowRun()}
          onBack={vi.fn()}
        />
      </QueryClientProvider>
    );

    expect(markup.split(`<span class="workflow-run-job-name">${longName}</span>`)).toHaveLength(3);
    expect(markup.match(/data-workflow-job-id="2"/g)).toHaveLength(2);
    expect(markup).not.toContain('…');
    expect(markup).not.toContain('Find jobs');
  });

  it('does not present queued time as job execution duration', () => {
    const queryClient = new QueryClient();
    const input = { profileId: 'profile-1', owner: 'acme', repository: 'widgets', runId: 101 };
    queryClient.setQueryData(gitHubWorkflowRunDetailQueryKey(input), {
      ...input,
      dependencyGraphAvailable: true,
      totalJobCount: 1,
      jobs: [{ ...workflowJob(1, 'waiting-build'), status: 'queued', conclusion: undefined, startedAt: '2026-07-27T10:00:00Z' }],
      loadedAt: '2026-07-27T10:02:00Z'
    });
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <WorkflowRunView profileId={input.profileId} owner={input.owner} repository={input.repository}
          run={{ ...workflowRun(), status: 'queued', conclusion: undefined }} onBack={vi.fn()} />
      </QueryClientProvider>
    );
    expect(markup).toContain('waiting-build');
    expect(markup).toContain('<small>Queued</small>');
    expect(markup).toContain('aria-label="waiting-build, Queued"');
    expect(markup).not.toMatch(/<small>\d/);
  });

  it('puts failed and running jobs first, in the navigation and in a tally', () => {
    const queryClient = new QueryClient();
    const input = { profileId: 'profile-1', owner: 'acme', repository: 'widgets', runId: 101 };
    queryClient.setQueryData(gitHubWorkflowRunDetailQueryKey(input), {
      ...input,
      dependencyGraphAvailable: true,
      totalJobCount: 4,
      jobs: [
        workflowJob(1, 'detect'),
        { ...workflowJob(2, 'build', [1]), status: 'in-progress' as const, conclusion: undefined },
        {
          ...workflowJob(3, 'lint', [1]),
          conclusion: 'failure' as const,
          startedAt: '2026-07-27T10:01:00Z',
          completedAt: '2026-07-27T10:02:00Z'
        },
        { ...workflowJob(4, 'docs', [1]), conclusion: 'skipped' as const }
      ],
      loadedAt: '2026-07-27T10:02:00Z'
    });
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <WorkflowRunView profileId={input.profileId} owner={input.owner} repository={input.repository}
          run={{ ...workflowRun(), status: 'in-progress', conclusion: undefined }} onBack={vi.fn()} />
      </QueryClientProvider>
    );

    const navigation = markup.slice(markup.indexOf('<aside'), markup.indexOf('</aside>'));
    expect(navigation.indexOf('>lint<')).toBeLessThan(navigation.indexOf('>build<'));
    expect(navigation.indexOf('>build<')).toBeLessThan(navigation.indexOf('>detect<'));
    expect(navigation).toContain('aria-label="Failed jobs"');
    expect(markup).toMatch(/data-state="failed"[^>]*>(<svg.*?<\/svg>)?1 failed/);
    expect(markup).toMatch(/data-state="running"[^>]*>(<svg.*?<\/svg>)?1 running/);
    expect(markup).toContain('aria-label="lint, Failed, 1m"');
    expect(markup).toMatch(/class="workflow-run-job-card"[^>]*data-state="failed"/);
  });

  it('does not label the navigation when every job is in the same state', () => {
    const queryClient = new QueryClient();
    const input = { profileId: 'profile-1', owner: 'acme', repository: 'widgets', runId: 101 };
    queryClient.setQueryData(gitHubWorkflowRunDetailQueryKey(input), {
      ...input,
      dependencyGraphAvailable: true,
      totalJobCount: 2,
      jobs: [workflowJob(1, 'detect'), workflowJob(2, 'build', [1])],
      loadedAt: '2026-07-27T10:02:00Z'
    });
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <WorkflowRunView profileId={input.profileId} owner={input.owner} repository={input.repository}
          run={workflowRun()} onBack={vi.fn()} />
      </QueryClientProvider>
    );

    expect(markup).not.toContain('workflow-run-nav-group-heading');
    expect(markup).toContain('2 passed');
  });

  it('places jobs into dependency levels instead of arbitrary columns', () => {
    const jobs = [
      workflowJob(1, 'detect'),
      workflowJob(2, 'build-a', [1]),
      workflowJob(3, 'build-b', [1]),
      workflowJob(4, 'deploy', [2, 3]),
      workflowJob(5, 'record', [1, 2, 3, 4])
    ];

    expect(
      arrangeWorkflowJobGraph(jobs).map((column) =>
        column.map((job) => job.name)
      )
    ).toEqual([
      ['detect'],
      ['build-a', 'build-b'],
      ['deploy'],
      ['record']
    ]);
  });

  it('collapses skipped jobs in navigation and the graph by default', () => {
    const queryClient = new QueryClient();
    const input = {
      profileId: 'profile-1',
      owner: 'acme',
      repository: 'widgets',
      runId: 101
    };
    queryClient.setQueryData(gitHubWorkflowRunDetailQueryKey(input), {
      ...input,
      workflowPath: '.github/workflows/ci.yml',
      dependencyGraphAvailable: true,
      totalJobCount: 3,
      jobs: [
        workflowJob(1, 'detect-changes'),
        { ...workflowJob(2, 'build-academy', [1]), conclusion: 'skipped' as const },
        { ...workflowJob(3, 'build-gorse', [1]), conclusion: 'skipped' as const }
      ],
      loadedAt: '2026-07-27T10:02:00Z'
    });

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <WorkflowRunView
          profileId={input.profileId}
          owner={input.owner}
          repository={input.repository}
          run={workflowRun()}
          onBack={vi.fn()}
        />
      </QueryClientProvider>
    );

    expect(markup).toContain('detect-changes');
    expect(markup).not.toContain('<span class="workflow-run-job-name">build-academy</span>');
    expect(markup).toContain('Show 2 skipped jobs');
    expect(markup).toContain('aria-expanded="false"');
  });

  it('folds skipped jobs into one node per dependency level and reroutes them', () => {
    const skipped = (job: ReturnType<typeof workflowJob>) => ({
      ...job,
      conclusion: 'skipped' as const
    });
    const jobs = [
      workflowJob(1, 'detect'),
      workflowJob(2, 'build', [1]),
      skipped(workflowJob(3, 'build-docs', [1])),
      skipped(workflowJob(4, 'deploy-docs', [3]))
    ];

    const collapsed = layoutWorkflowJobGraph(jobs, false);
    expect(
      collapsed.columns.map((column) =>
        column.map((node) => (node.kind === 'job' ? node.job.name : node.jobs.length))
      )
    ).toEqual([['detect'], ['build', 1], [1]]);
    expect(collapsed.nodeKeyByJobId.get(3)).toBe('skipped:1');
    expect(collapsed.nodeKeyByJobId.get(4)).toBe('skipped:2');

    const expanded = layoutWorkflowJobGraph(jobs, true);
    expect(expanded.columns.flat().every((node) => node.kind === 'job')).toBe(true);
  });

  it('draws only the dependencies a longer chain does not already imply', () => {
    const jobs = [
      workflowJob(1, 'detect'),
      workflowJob(2, 'build-a', [1]),
      workflowJob(3, 'build-b', [1]),
      workflowJob(4, 'deploy', [1, 2, 3]),
      workflowJob(5, 'record', [1, 2, 3, 4])
    ];

    expect(Object.fromEntries(reduceWorkflowJobDependencies(jobs))).toEqual({
      1: [],
      2: [1],
      3: [1],
      4: [2, 3],
      5: [4]
    });
    expect(layoutWorkflowJobGraph(jobs, true).edges).toEqual([
      { source: 'job:1', target: 'job:2' },
      { source: 'job:1', target: 'job:3' },
      { source: 'job:2', target: 'job:4' },
      { source: 'job:3', target: 'job:4' },
      { source: 'job:4', target: 'job:5' }
    ]);
  });

  it('links jobs that ran through collapsed skipped jobs instead of to them', () => {
    const skipped = (job: ReturnType<typeof workflowJob>) => ({
      ...job,
      conclusion: 'skipped' as const
    });
    const jobs = [
      workflowJob(1, 'build'),
      skipped(workflowJob(2, 'sync-credentials', [1])),
      workflowJob(3, 'deploy', [2]),
      skipped(workflowJob(4, 'notify', [3]))
    ];

    // Collapsed: deploy waits for build, and skipped nodes only ever end a line.
    expect(layoutWorkflowJobGraph(jobs, false).edges).toEqual([
      { source: 'job:1', target: 'skipped:1' },
      { source: 'job:1', target: 'job:3' },
      { source: 'job:3', target: 'skipped:3' }
    ]);
    // Expanded: the real chain.
    expect(layoutWorkflowJobGraph(jobs, true).edges).toEqual([
      { source: 'job:1', target: 'job:2' },
      { source: 'job:2', target: 'job:3' },
      { source: 'job:3', target: 'job:4' }
    ]);
  });

  it('pins what a failed job held up and what the first failure waited for', () => {
    const edges = [
      { source: 'build', target: 'deploy' },
      { source: 'database', target: 'deploy' },
      { source: 'deploy', target: 'verify' },
      { source: 'other', target: 'verify' },
      { source: 'verify', target: 'notify' },
      { source: 'build', target: 'docs' }
    ];

    // `verify` failed because `deploy` did, so its other input stays hidden.
    expect(workflowFailureFlow(edges, new Set(['deploy', 'verify']))).toEqual([
      { source: 'build', target: 'deploy' },
      { source: 'database', target: 'deploy' },
      { source: 'deploy', target: 'verify' },
      { source: 'verify', target: 'notify' }
    ]);
    expect(workflowFailureFlow(edges, new Set())).toEqual([]);
  });

  it('ignores dependency cycles instead of looping', () => {
    const jobs = [workflowJob(1, 'a', [2]), workflowJob(2, 'b', [1])];

    expect(() => layoutWorkflowJobGraph(jobs, true)).not.toThrow();
  });
});

function workflowJob(
  id: number,
  name: string,
  dependencyJobIds: number[] = []
) {
  return {
    id,
    name,
    dependencyJobIds,
    status: 'completed' as const,
    conclusion: 'success' as const,
    url: `https://github.com/acme/widgets/actions/runs/101/job/${id}`,
    labels: [],
    steps: []
  };
}

function workflowRun(): GitHubWorkflowRun {
  return {
    id: 101,
    name: 'CI',
    displayTitle: 'Verify dashboard support',
    runNumber: 42,
    event: 'push',
    branch: 'main',
    sha: 'abcdef1234567890',
    status: 'completed',
    conclusion: 'success',
    url: 'https://github.com/acme/widgets/actions/runs/101',
    actor: 'developer',
    pullRequestNumbers: [],
    createdAt: '2026-07-27T10:00:00Z',
    startedAt: '2026-07-27T10:01:00Z',
    updatedAt: '2026-07-27T10:02:00Z'
  };
}
