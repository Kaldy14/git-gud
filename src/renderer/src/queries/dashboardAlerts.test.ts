import { describe, expect, it } from 'vitest';

import type {
  Dashboard,
  GitHubActionsRuns,
  GitHubWorkflowRun,
  GitHubWorkflowRunStatus
} from '@shared/types';

import {
  countRunningDashboardWorkflowRuns,
  dashboardActionMonitoringInputs,
  isWorkflowRunRunning
} from './dashboardAlerts';

function workflowRun(id: number, status: GitHubWorkflowRunStatus): GitHubWorkflowRun {
  return {
    id,
    name: 'CI',
    displayTitle: `Run ${id}`,
    runNumber: id,
    event: 'push',
    branch: 'main',
    sha: `sha-${id}`,
    status,
    conclusion: status === 'completed' ? 'success' : undefined,
    url: `https://github.com/acme/widgets/actions/runs/${id}`,
    pullRequestNumbers: [],
    createdAt: '2026-07-28T10:00:00.000Z',
    updatedAt: '2026-07-28T10:00:00.000Z'
  };
}

function actionsRuns(
  owner: string,
  repository: string,
  runs: GitHubWorkflowRun[]
): GitHubActionsRuns {
  return {
    profileId: 'profile:monitoring',
    owner,
    repository,
    runs,
    pullRequests: [],
    searchedRunCount: runs.length,
    searchLimitReached: false,
    loadedAt: '2026-07-28T10:00:00.000Z'
  };
}

describe('dashboard action monitoring', () => {
  it('keeps distinct filters and deduplicates identical action tiles', () => {
    const profileId = 'profile:monitoring';
    const filters = {
      branches: ['main'],
      includeTags: false,
      includeMyPullRequests: false
    };
    const dashboard: Dashboard = {
      id: 'dashboard:delivery',
      profileId,
      name: 'Delivery',
      tiles: [
        {
          id: 'tile:first',
          kind: 'github-actions',
          owner: 'acme',
          repository: 'widgets',
          limit: 10,
          view: 'runs',
          filters
        },
        {
          id: 'tile:duplicate',
          kind: 'github-actions',
          owner: 'acme',
          repository: 'widgets',
          limit: 10,
          view: 'runs',
          filters
        },
        {
          id: 'tile:pull-requests',
          kind: 'github-actions',
          owner: 'acme',
          repository: 'widgets',
          limit: 10,
          view: 'pull-requests',
          filters: {
            branches: [],
            includeTags: false,
            includeMyPullRequests: true
          }
        }
      ],
      createdAt: '2026-07-28T10:00:00.000Z',
      updatedAt: '2026-07-28T10:00:00.000Z'
    };

    expect(dashboardActionMonitoringInputs(profileId, [dashboard])).toEqual([
      {
        profileId,
        owner: 'acme',
        repository: 'widgets',
        limit: 10,
        view: 'runs',
        filters
      },
      {
        profileId,
        owner: 'acme',
        repository: 'widgets',
        limit: 10,
        view: 'pull-requests',
        filters: {
          branches: [],
          includeTags: false,
          includeMyPullRequests: true
        }
      }
    ]);
  });

  it('treats only in-progress runs as running, matching the tile running summary', () => {
    const statuses: GitHubWorkflowRunStatus[] = [
      'queued',
      'in-progress',
      'completed',
      'waiting',
      'requested',
      'pending',
      'unknown'
    ];

    expect(
      statuses.filter((status) => isWorkflowRunRunning({ status }))
    ).toEqual(['in-progress']);
  });

  it('counts running runs once across overlapping tiles and repositories', () => {
    const broadTile = actionsRuns('acme', 'widgets', [
      workflowRun(1, 'in-progress'),
      workflowRun(2, 'in-progress'),
      workflowRun(3, 'queued'),
      workflowRun(4, 'completed')
    ]);
    // A filtered tile on the same repository returns an overlapping subset.
    const filteredTile = actionsRuns('Acme', 'Widgets', [workflowRun(2, 'in-progress')]);
    // The same run ID in another repository is a different run.
    const otherRepository = actionsRuns('acme', 'gadgets', [
      workflowRun(1, 'in-progress')
    ]);

    expect(
      countRunningDashboardWorkflowRuns([
        broadTile,
        filteredTile,
        undefined,
        otherRepository
      ])
    ).toBe(3);
  });

  it('reports zero when no loaded tile has a running run', () => {
    expect(countRunningDashboardWorkflowRuns([])).toBe(0);
    expect(
      countRunningDashboardWorkflowRuns([
        undefined,
        actionsRuns('acme', 'widgets', [
          workflowRun(1, 'completed'),
          workflowRun(2, 'pending')
        ])
      ])
    ).toBe(0);
  });
});
