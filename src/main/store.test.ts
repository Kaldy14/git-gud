import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import type {
  GitHubActionsRuns,
  GitHubActionsRunsInput,
  GitHubWorkflowRun
} from '@shared/types';

import {
  deleteDashboard,
  flushPendingWorkspaceWrites,
  getDashboardActionAlerts,
  getDashboards,
  getRepositoryLastFetchedAt,
  openWorkspaceRepository,
  markDashboardActionAlertsRead,
  recordDashboardActionRuns,
  recordRepositoryFetch,
  saveDashboard,
  selectDashboard,
  selectWorkspaceCommit,
  selectWorkspaceFile
} from './store';

describe('workspace persistence', () => {
  it('persists successful fetch timestamps by shared Git directory', () => {
    const commonDir = `/tmp/git-gud-fetch-${randomUUID()}/.git`;
    const fetchedAt = '2026-07-26T12:30:00.000Z';

    expect(getRepositoryLastFetchedAt(commonDir)).toBeUndefined();
    recordRepositoryFetch(commonDir, fetchedAt);
    expect(getRepositoryLastFetchedAt(commonDir)).toBe(fetchedAt);
  });

  it('flushes deferred commit and file selections before shutdown', async () => {
    const repoPath = '/tmp/git-gud-store-test-repo';
    const workspace = openWorkspaceRepository({
      path: repoPath,
      name: 'store-test-repo',
      gitDir: `${repoPath}/.git`,
      commonDir: `${repoPath}/.git`
    });
    const tabId = workspace.activeTabId;

    if (!tabId) {
      throw new Error('Expected the test repository to open a tab.');
    }

    selectWorkspaceCommit(tabId, 'abc123');
    selectWorkspaceFile(tabId, 'src/index.ts');
    flushPendingWorkspaceWrites();

    const stored = await readFile(
      join(tmpdir(), 'git-gud-vitest-store', 'workspace', 'git-gud-workspace.json'),
      'utf8'
    );
    expect(stored).toContain('abc123');
    expect(stored).toContain('src/index.ts');
  });

  it('persists profile-scoped dashboards with GitHub and Portainer tiles', () => {
    const profileId = `profile:dashboard-store-test:${randomUUID()}`;
    const saved = saveDashboard({
      profileId,
      name: 'Release health',
      tiles: [
        {
          kind: 'github-actions',
          owner: 'acme',
          repository: 'widgets',
          limit: 10,
          filters: {
            branches: ['main'],
            includeTags: true,
            includeMyPullRequests: false
          }
        },
        {
          kind: 'portainer-swarm-stack',
          connectionId: 'portainer:production',
          endpointId: 3,
          stackId: 12,
          stackName: 'storefront',
          environmentName: 'Production Swarm'
        }
      ]
    });
    const firstDashboardId = saved.dashboards[0]?.id;

    expect(saved.dashboards).toHaveLength(1);
    expect(saved.selectedDashboardId).toBe(firstDashboardId);
    expect(saved.dashboards[0]).toMatchObject({
      profileId,
      name: 'Release health',
      tiles: [
        {
          kind: 'github-actions',
          owner: 'acme',
          repository: 'widgets',
          limit: 10,
          filters: {
            branches: ['main'],
            includeTags: true,
            includeMyPullRequests: false
          }
        },
        {
          kind: 'portainer-swarm-stack',
          connectionId: 'portainer:production',
          endpointId: 3,
          stackId: 12,
          stackName: 'storefront',
          environmentName: 'Production Swarm'
        }
      ]
    });
    expect(getDashboards(profileId)).toEqual(saved);

    const savedDashboard = saved.dashboards[0];
    const githubTile = savedDashboard?.tiles.find(
      (tile) => tile.kind === 'github-actions'
    );
    const portainerTile = savedDashboard?.tiles.find(
      (tile) => tile.kind === 'portainer-swarm-stack'
    );

    if (
      !savedDashboard ||
      githubTile?.kind !== 'github-actions' ||
      portainerTile?.kind !== 'portainer-swarm-stack'
    ) {
      throw new Error('Expected both persisted dashboard tile kinds.');
    }

    const reordered = saveDashboard({
      id: savedDashboard.id,
      profileId,
      name: savedDashboard.name,
      tiles: [portainerTile, { ...githubTile, limit: 15 }]
    });

    expect(reordered.dashboards[0]?.tiles.map((tile) => tile.id)).toEqual([
      portainerTile.id,
      githubTile.id
    ]);
    expect(reordered.dashboards[0]?.tiles[1]).toMatchObject({
      id: githubTile.id,
      kind: 'github-actions',
      limit: 15
    });
    expect(getDashboards(profileId)).toEqual(reordered);

    const withSecondDashboard = saveDashboard({
      profileId,
      name: 'Main branch',
      tiles: []
    });
    const secondDashboardId = withSecondDashboard.dashboards[1]?.id;

    if (!firstDashboardId || !secondDashboardId) {
      throw new Error('Expected both dashboards to be saved.');
    }

    expect(selectDashboard(profileId, secondDashboardId).selectedDashboardId).toBe(
      secondDashboardId
    );
    expect(getDashboards(profileId).selectedDashboardId).toBe(secondDashboardId);
    expect(deleteDashboard(profileId, secondDashboardId).selectedDashboardId).toBe(
      firstDashboardId
    );
    expect(deleteDashboard(profileId, firstDashboardId).dashboards).toEqual([]);
  });

  it('records new workflow failures once and keeps them unread until acknowledged', () => {
    const profileId = `profile:dashboard-alert-test:${randomUUID()}`;
    const input: GitHubActionsRunsInput = {
      profileId,
      owner: 'acme',
      repository: 'widgets',
      limit: 10,
      filters: {
        branches: [],
        includeTags: false,
        includeMyPullRequests: false
      }
    };
    const running = dashboardWorkflowRun({
      status: 'in-progress',
      conclusion: undefined,
      updatedAt: '2026-07-28T10:05:00.000Z'
    });
    const baseline = recordDashboardActionRuns(
      input,
      dashboardActionRunsResult(input, [running], '2026-07-28T10:06:00.000Z')
    );

    expect(baseline.newAlerts).toEqual([]);
    expect(baseline.notify).toBe(false);

    const failed = dashboardWorkflowRun({
      status: 'completed',
      conclusion: 'failure',
      updatedAt: '2026-07-28T10:10:00.000Z'
    });
    const failure = recordDashboardActionRuns(
      input,
      dashboardActionRunsResult(input, [failed], '2026-07-28T10:11:00.000Z')
    );

    expect(failure.notify).toBe(true);
    expect(failure.newAlerts).toHaveLength(1);
    expect(failure.state).toMatchObject({
      profileId,
      unreadCount: 1,
      alerts: [
        {
          owner: 'acme',
          repository: 'widgets',
          runId: 101,
          runNumber: 101,
          conclusion: 'failure'
        }
      ]
    });

    const duplicate = recordDashboardActionRuns(
      input,
      dashboardActionRunsResult(input, [failed], '2026-07-28T10:12:00.000Z')
    );
    expect(duplicate.newAlerts).toEqual([]);
    expect(duplicate.state.unreadCount).toBe(1);

    const alertId = failure.newAlerts[0]?.id;

    if (!alertId) {
      throw new Error('Expected a persisted workflow failure alert.');
    }

    const read = markDashboardActionAlertsRead(
      profileId,
      [alertId],
      '2026-07-28T10:13:00.000Z'
    );
    expect(read.unreadCount).toBe(0);
    expect(read.alerts[0]?.readAt).toBe('2026-07-28T10:13:00.000Z');
    expect(getDashboardActionAlerts(profileId)).toEqual(read);
  });

  it('detects a failed run that completed between background polls', () => {
    const profileId = `profile:dashboard-missed-alert-test:${randomUUID()}`;
    const input: GitHubActionsRunsInput = {
      profileId,
      owner: 'acme',
      repository: 'api',
      limit: 5,
      filters: {
        branches: ['main'],
        includeTags: false,
        includeMyPullRequests: false
      }
    };

    recordDashboardActionRuns(
      input,
      dashboardActionRunsResult(input, [], '2026-07-28T11:00:00.000Z')
    );
    const missedFailure = recordDashboardActionRuns(
      input,
      dashboardActionRunsResult(
        input,
        [
          dashboardWorkflowRun({
            id: 102,
            runNumber: 102,
            status: 'completed',
            conclusion: 'timed-out',
            updatedAt: '2026-07-28T11:00:30.000Z'
          })
        ],
        '2026-07-28T11:01:00.000Z'
      )
    );

    expect(missedFailure.notify).toBe(true);
    expect(missedFailure.newAlerts[0]).toMatchObject({
      runId: 102,
      conclusion: 'timed-out'
    });
  });

  it('normalizes missing filters in dashboards saved by older versions', async () => {
    const profileId = `profile:legacy-dashboard-store-test:${randomUUID()}`;
    const storePath = join(
      tmpdir(),
      'git-gud-vitest-store',
      'workspace',
      'git-gud-workspace.json'
    );
    const stored = JSON.parse(await readFile(storePath, 'utf8')) as {
      dashboards?: unknown[];
    };
    stored.dashboards = [
      ...(stored.dashboards ?? []),
      {
        id: randomUUID(),
        profileId,
        name: 'Legacy actions',
        tiles: [
          {
            id: randomUUID(),
            kind: 'github-actions',
            owner: 'acme',
            repository: 'widgets',
            limit: 5
          }
        ],
        createdAt: '2026-07-20T10:00:00.000Z',
        updatedAt: '2026-07-20T10:00:00.000Z'
      }
    ];
    await writeFile(storePath, JSON.stringify(stored), 'utf8');

    const restoredTile = getDashboards(profileId).dashboards[0]?.tiles[0];
    expect(restoredTile?.kind).toBe('github-actions');
    expect(restoredTile?.kind === 'github-actions' ? restoredTile.filters : undefined).toEqual({
      branches: [],
      includeTags: false,
      includeMyPullRequests: false
    });
  });
});

function dashboardActionRunsResult(
  input: GitHubActionsRunsInput,
  runs: GitHubWorkflowRun[],
  loadedAt: string
): GitHubActionsRuns {
  return {
    profileId: input.profileId,
    owner: input.owner,
    repository: input.repository,
    runs,
    searchedRunCount: runs.length,
    searchLimitReached: false,
    loadedAt
  };
}

function dashboardWorkflowRun(
  overrides: Partial<GitHubWorkflowRun>
): GitHubWorkflowRun {
  return {
    id: 101,
    name: 'CI',
    displayTitle: 'Verify dashboard notifications',
    runNumber: 101,
    event: 'push',
    branch: 'main',
    sha: 'abcdef1234567890',
    status: 'in-progress',
    url: 'https://github.com/acme/widgets/actions/runs/101',
    actor: 'developer',
    pullRequestNumbers: [],
    createdAt: '2026-07-28T10:00:00.000Z',
    startedAt: '2026-07-28T10:01:00.000Z',
    updatedAt: '2026-07-28T10:05:00.000Z',
    ...overrides
  };
}
