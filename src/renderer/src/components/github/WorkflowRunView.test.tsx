import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { gitHubWorkflowRunDetailQueryKey } from '@renderer/queries/github';
import type { GitHubWorkflowRun } from '@shared/types';

import { WorkflowRunView } from './WorkflowRunView';
import {
  arrangeWorkflowJobGraph,
  workflowGraphEdgePath
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

  it('rounds dependency-line bends while leaving level links straight', () => {
    expect(workflowGraphEdgePath(100, 20, 220, 80)).toBe(
      'M 100 20 H 152 Q 160 20 160 28 V 72 Q 160 80 168 80 H 220'
    );
    expect(workflowGraphEdgePath(100, 20, 220, 20)).toBe(
      'M 100 20 H 220'
    );
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
