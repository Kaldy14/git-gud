import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  dashboardsQueryKey,
  gitHubActionsRunsQueryKey,
  gitHubRepositoriesQueryKey
} from '@renderer/queries/github';
import {
  portainerConnectionsQueryKey,
  portainerStackImagesQueryKey,
  portainerStackRuntimeQueryKey
} from '@renderer/queries/portainer';
import type { Dashboard, GitHubWorkflowRun, GitProfile } from '@shared/types';

import {
  DashboardDialogSurface,
  DashboardView,
  WorkflowBranchFilterField
} from './DashboardView';

const profile: GitProfile = {
  id: 'profile:dashboard-tabs',
  name: 'Dashboard tabs',
  email: 'dashboard-tabs@example.com',
  avatarColor: '#5fd6c3',
  ghConfigDir: '/tmp/dashboard-tabs',
  githubLogin: 'dashboard-tabs',
  githubHost: 'github.com'
};

const dashboards: Dashboard[] = [
  createDashboard('dashboard:actions', 'Actions'),
  createDashboard('dashboard:releases', 'Release health')
];

describe('DashboardView', () => {
  it('places the create-dashboard control after the dashboard tabs and before dashboard actions', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(dashboardsQueryKey(profile.id), {
      profileId: profile.id,
      dashboards,
      selectedDashboardId: dashboards[0]?.id
    });
    queryClient.setQueryData(gitHubRepositoriesQueryKey(profile.id), []);

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <DashboardView
          profile={profile}
          requestedDashboardId={dashboards[0]?.id}
          onSelectDashboard={vi.fn()}
          onOpenProfileSettings={vi.fn()}
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    );

    const lastDashboardIndex = markup.indexOf('Release health');
    const createDashboardIndex = markup.indexOf('aria-label="Create dashboard"');
    const dashboardActionsIndex = markup.indexOf('class="dashboard-header-actions"');

    expect(lastDashboardIndex).toBeGreaterThan(-1);
    expect(createDashboardIndex).toBeGreaterThan(lastDashboardIndex);
    expect(dashboardActionsIndex).toBeGreaterThan(createDashboardIndex);
  });

  it('shows configured filters and a filtered empty state on an Actions tile', () => {
    const queryClient = new QueryClient();
    const filters = {
      branches: ['main'],
      includeTags: true,
      includeMyPullRequests: true
    };
    const dashboard: Dashboard = {
      ...createDashboard('dashboard:filtered', 'Focused delivery'),
      tiles: [
        {
          id: 'tile:filtered',
          kind: 'github-actions',
          owner: 'acme',
          repository: 'widgets',
          limit: 10,
          filters
        }
      ]
    };
    queryClient.setQueryData(dashboardsQueryKey(profile.id), {
      profileId: profile.id,
      dashboards: [dashboard],
      selectedDashboardId: dashboard.id
    });
    queryClient.setQueryData(gitHubRepositoriesQueryKey(profile.id), []);
    queryClient.setQueryData(
      gitHubActionsRunsQueryKey({
        profileId: profile.id,
        owner: 'acme',
        repository: 'widgets',
        limit: 10,
        filters
      }),
      {
        profileId: profile.id,
        owner: 'acme',
        repository: 'widgets',
        runs: [],
        searchedRunCount: 10,
        searchLimitReached: false,
        loadedAt: '2026-07-27T10:00:00.000Z'
      }
    );

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <DashboardView
          profile={profile}
          requestedDashboardId={dashboard.id}
          onSelectDashboard={vi.fn()}
          onOpenProfileSettings={vi.fn()}
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    );

    expect(markup).toContain('Run filters: main · tags · my PRs');
    expect(markup).toContain('No workflow runs match these filters.');
  });

  it('exposes edit controls and accessible drag handles for saved tiles', () => {
    const queryClient = new QueryClient();
    const filters = {
      branches: [],
      includeTags: false,
      includeMyPullRequests: false
    };
    const dashboard: Dashboard = {
      ...createDashboard('dashboard:layout', 'Delivery layout'),
      tiles: [
        {
          id: 'tile:widgets',
          kind: 'github-actions',
          owner: 'acme',
          repository: 'widgets',
          limit: 10,
          filters
        },
        {
          id: 'tile:api',
          kind: 'github-actions',
          owner: 'acme',
          repository: 'api',
          limit: 5,
          filters
        }
      ]
    };
    queryClient.setQueryData(dashboardsQueryKey(profile.id), {
      profileId: profile.id,
      dashboards: [dashboard],
      selectedDashboardId: dashboard.id
    });
    queryClient.setQueryData(gitHubRepositoriesQueryKey(profile.id), []);

    for (const tile of dashboard.tiles) {
      if (tile.kind !== 'github-actions') {
        continue;
      }

      queryClient.setQueryData(
        gitHubActionsRunsQueryKey({
          profileId: profile.id,
          owner: tile.owner,
          repository: tile.repository,
          limit: tile.limit,
          filters: tile.filters
        }),
        {
          profileId: profile.id,
          owner: tile.owner,
          repository: tile.repository,
          runs: [],
          searchedRunCount: 0,
          searchLimitReached: false,
          loadedAt: '2026-07-27T10:00:00.000Z'
        }
      );
    }

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <DashboardView
          profile={profile}
          requestedDashboardId={dashboard.id}
          onSelectDashboard={vi.fn()}
          onOpenProfileSettings={vi.fn()}
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    );

    expect(markup).toContain('data-dashboard-tile-id="tile:widgets"');
    expect(markup).toContain('data-dashboard-tile-id="tile:api"');
    expect(markup).toContain('aria-label="Edit acme/widgets tile"');
    expect(markup).toContain('aria-label="Edit acme/api tile"');
    expect(markup).toContain(
      'aria-label="Reorder acme/widgets tile, position 1 of 2. Drag or use arrow keys."'
    );
    expect(markup).toContain(
      'aria-label="Reorder acme/api tile, position 2 of 2. Drag or use arrow keys."'
    );
  });

  it('renders saved GitHub tile settings in the edit dialog', () => {
    const markup = renderToStaticMarkup(
      <DashboardDialogSurface
        dialog={{
          kind: 'edit-tile',
          tileId: 'tile:widgets',
          tileKind: 'github-actions',
          repository: 'acme/widgets',
          limit: 15,
          branches: 'main, release/next',
          includeTags: true,
          includeMyPullRequests: false,
          connectionId: '',
          endpointId: 0,
          stackId: 0
        }}
        repositories={[
          {
            owner: 'acme',
            name: 'widgets',
            fullName: 'acme/widgets',
            url: 'https://github.com/acme/widgets',
            isPrivate: true,
            defaultBranch: 'main'
          }
        ]}
        repositoriesLoading={false}
        gitHubConnected
        connections={[]}
        connectionsLoading={false}
        catalogLoading={false}
        isSaving={false}
        onChange={vi.fn()}
        onConfigurePortainer={vi.fn()}
        onOpenGitHubSettings={vi.fn()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    expect(markup).toContain('Edit dashboard tile');
    expect(markup).toContain(
      'Update this tile without changing its position in the dashboard.'
    );
    expect(markup).toContain('value="main, release/next"');
    expect(markup).toContain('value="15" selected=""');
    expect(markup).toContain('Save tile');
  });

  it('keeps the branch validation message associated with the invalid input', () => {
    const markup = renderToStaticMarkup(
      <WorkflowBranchFilterField
        value={Array.from({ length: 21 }, (_, index) => `branch-${index}`).join(',')}
        placeholder="main"
        onChange={vi.fn()}
      />
    );

    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain(
      'aria-describedby="dashboard-branch-filter-help dashboard-branch-filter-error"'
    );
    expect(markup).toContain('aria-errormessage="dashboard-branch-filter-error"');
    expect(markup).toContain('id="dashboard-branch-filter-error"');
  });

  it('shows the number of running workflows and their trigger and start times', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T10:09:00Z'));

    try {
      const runs = [
        workflowRun({ id: 101, runNumber: 101 }),
        workflowRun({ id: 100, runNumber: 100 }),
        workflowRun({ id: 99, runNumber: 99 }),
        workflowRun({ id: 98, runNumber: 98, status: 'queued', startedAt: undefined }),
        workflowRun({ id: 97, runNumber: 97, status: 'pending', startedAt: undefined }),
        workflowRun({ id: 96, runNumber: 96, status: 'unknown', startedAt: undefined })
      ];

      const markup = renderActionsDashboard(runs);

      expect(markup).toContain('3 Running');
      expect(markup).toContain('Triggered 9m ago');
      expect(markup).toContain('Started 8m ago');
      expect(markup).toContain('Queued');
      expect(markup).toContain('Unknown');
      expect(markup).not.toContain('2m ago');

      expect(
        renderActionsDashboard([
          workflowRun({ status: 'queued', startedAt: undefined }),
          workflowRun({ id: 100, status: 'pending', startedAt: undefined })
        ])
      ).toContain('2 Queued');
      expect(
        renderActionsDashboard([
          workflowRun({ status: 'unknown', startedAt: undefined })
        ])
      ).toContain('1 Unknown');
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders a saved Portainer Swarm stack tile from cached runtime and image data', () => {
    const queryClient = new QueryClient();
    const tile = {
      id: 'tile:portainer',
      kind: 'portainer-swarm-stack' as const,
      connectionId: 'portainer:production',
      endpointId: 3,
      stackId: 12,
      stackName: 'storefront',
      environmentName: 'Production Swarm'
    };
    const input = {
      connectionId: tile.connectionId,
      endpointId: tile.endpointId,
      stackId: tile.stackId,
      stackName: tile.stackName
    };
    const dashboard = {
      ...createDashboard('dashboard:infrastructure', 'Infrastructure'),
      tiles: [tile]
    };

    queryClient.setQueryData(dashboardsQueryKey(profile.id), {
      profileId: profile.id,
      dashboards: [dashboard],
      selectedDashboardId: dashboard.id
    });
    queryClient.setQueryData(gitHubRepositoriesQueryKey(profile.id), []);
    queryClient.setQueryData(portainerConnectionsQueryKey, []);
    queryClient.setQueryData(portainerStackRuntimeQueryKey(input), {
      ...input,
      health: 'healthy',
      desiredTasks: 3,
      runningTasks: 3,
      completedTasks: 0,
      services: [
        {
          id: 'service:web',
          name: 'web',
          image: 'registry.example.com/storefront:web',
          desiredTasks: 3,
          runningTasks: 3,
          completedTasks: 0,
          health: 'healthy',
          runningSince: '2026-07-27T10:00:00.000Z'
        }
      ],
      portainerUrl: 'https://portainer.example.com/#!/3/docker/stacks/12',
      loadedAt: new Date().toISOString()
    });
    queryClient.setQueryData(portainerStackImagesQueryKey(input), {
      connectionId: input.connectionId,
      endpointId: input.endpointId,
      stackId: input.stackId,
      services: [{ serviceId: 'service:web', freshness: 'up-to-date' }],
      loadedAt: new Date().toISOString()
    });

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <DashboardView
          profile={profile}
          requestedDashboardId={dashboard.id}
          onSelectDashboard={vi.fn()}
          onOpenProfileSettings={vi.fn()}
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    );

    expect(markup).toContain('Production Swarm/');
    expect(markup).toContain('storefront');
    expect(markup).toContain('registry.example.com/storefront:web');
    expect(markup).toContain('Up to date');
    expect(markup).toContain('Open in Portainer');
    expect(markup).toContain(
      'aria-label="Edit Production Swarm/storefront tile"'
    );
  });
});

function createDashboard(id: string, name: string): Dashboard {
  return {
    id,
    profileId: profile.id,
    name,
    tiles: [],
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z'
  };
}

function renderActionsDashboard(runs: GitHubWorkflowRun[]): string {
  const queryClient = new QueryClient();
  const filters = {
    branches: [],
    includeTags: false,
    includeMyPullRequests: false
  };
  const dashboard: Dashboard = {
    ...createDashboard('dashboard:actions', 'Actions'),
    tiles: [
      {
        id: 'tile:actions',
        kind: 'github-actions',
        owner: 'acme',
        repository: 'widgets',
        limit: 10,
        filters
      }
    ]
  };

  queryClient.setQueryData(dashboardsQueryKey(profile.id), {
    profileId: profile.id,
    dashboards: [dashboard],
    selectedDashboardId: dashboard.id
  });
  queryClient.setQueryData(gitHubRepositoriesQueryKey(profile.id), []);
  queryClient.setQueryData(
    gitHubActionsRunsQueryKey({
      profileId: profile.id,
      owner: 'acme',
      repository: 'widgets',
      limit: 10,
      filters
    }),
    {
      profileId: profile.id,
      owner: 'acme',
      repository: 'widgets',
      runs,
      searchedRunCount: runs.length,
      searchLimitReached: false,
      loadedAt: '2026-07-27T10:09:00Z'
    }
  );

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <DashboardView
        profile={profile}
        requestedDashboardId={dashboard.id}
        onSelectDashboard={vi.fn()}
        onOpenProfileSettings={vi.fn()}
        onClose={vi.fn()}
      />
    </QueryClientProvider>
  );
}

function workflowRun(overrides: Partial<GitHubWorkflowRun>): GitHubWorkflowRun {
  return {
    id: 101,
    name: 'CI',
    displayTitle: 'Verify dashboard support',
    runNumber: 101,
    event: 'push',
    branch: 'main',
    sha: 'abcdef1234567890',
    status: 'in-progress',
    url: 'https://github.com/acme/widgets/actions/runs/101',
    actor: 'developer',
    pullRequestNumbers: [],
    createdAt: '2026-07-27T10:00:00Z',
    startedAt: '2026-07-27T10:01:00Z',
    updatedAt: '2026-07-27T10:07:00Z',
    ...overrides
  };
}
