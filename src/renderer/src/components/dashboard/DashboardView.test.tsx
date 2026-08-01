import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
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
import type {
  Dashboard,
  DashboardActionFailureAlert,
  GitHubWorkflowRun,
  GitProfile
} from '@shared/types';

import {
  DashboardDialogSurface,
  DashboardView,
  WorkflowBranchFilterField
} from './DashboardView';
import { dashboardRepositoryOptions } from './dashboardRepositoryOptions';

type CapturedContextMenuItem = {
  disabled?: boolean;
  onSelect?: () => void;
  title?: string;
};

const capturedContextMenuItems = vi.hoisted(
  () => [] as CapturedContextMenuItem[]
);

vi.mock('radix-ui', async () => {
  const actual = await vi.importActual<typeof import('radix-ui')>('radix-ui');
  const React = await import('react');
  const Passthrough = ({ children }: { children?: ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  const Item = ({
    children,
    ...props
  }: CapturedContextMenuItem & { children?: ReactNode }) => {
    capturedContextMenuItems.push(props);
    return React.createElement('div', null, children);
  };

  return {
    ...actual,
    ContextMenu: {
      ...actual.ContextMenu,
      Root: Passthrough,
      Trigger: Passthrough,
      Portal: Passthrough,
      Content: Passthrough,
      Label: Passthrough,
      Item
    }
  };
});

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
  it('keeps repositories available when another tile already uses the same project', () => {
    const repository = {
      owner: 'acme',
      name: 'widgets',
      fullName: 'acme/widgets',
      url: 'https://github.com/acme/widgets',
      isPrivate: true,
      defaultBranch: 'main'
    };
    const dashboard: Dashboard = {
      ...createDashboard('dashboard:duplicates', 'Focused workflows'),
      tiles: [
        {
          id: 'tile:main-and-tags',
          kind: 'github-actions',
          owner: repository.owner,
          repository: repository.name,
          limit: 10,
          view: 'runs',
          filters: {
            branches: ['main'],
            includeTags: true,
            includeMyPullRequests: false
          }
        }
      ]
    };

    expect(dashboardRepositoryOptions([repository], dashboard, undefined)).toEqual([
      repository
    ]);
  });

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

  it('shows unread workflow failures with explicit read controls', () => {
    const queryClient = new QueryClient();
    const alert: DashboardActionFailureAlert = {
      id: 'alert:101',
      profileId: profile.id,
      owner: 'acme',
      repository: 'widgets',
      runId: 101,
      runNumber: 101,
      workflowName: 'CI',
      displayTitle: 'Verify dashboard notifications',
      branch: 'main',
      conclusion: 'failure',
      url: 'https://github.com/acme/widgets/actions/runs/101',
      failedAt: '2026-07-28T10:10:00.000Z',
      detectedAt: '2026-07-28T10:11:00.000Z'
    };
    queryClient.setQueryData(dashboardsQueryKey(profile.id), {
      profileId: profile.id,
      dashboards: [dashboards[0]],
      selectedDashboardId: dashboards[0]?.id
    });
    queryClient.setQueryData(gitHubRepositoriesQueryKey(profile.id), []);

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <DashboardView
          profile={profile}
          requestedDashboardId={dashboards[0]?.id}
          actionAlerts={[alert]}
          onMarkActionAlertsRead={vi.fn()}
          onSelectDashboard={vi.fn()}
          onOpenProfileSettings={vi.fn()}
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    );

    expect(markup).toContain('aria-label="Unread workflow failures"');
    expect(markup).toContain('1 unread workflow failure');
    expect(markup).toContain('Verify dashboard notifications');
    expect(markup).toContain('acme/widgets · CI #101 · main');
    expect(markup).toContain('Mark all read');
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
          view: 'runs',
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
        view: 'runs',
        filters
      }),
      {
        profileId: profile.id,
        owner: 'acme',
        repository: 'widgets',
        runs: [],
        pullRequests: [],
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

  it('renders compact workflow rows grouped beneath open authored pull requests', () => {
    const queryClient = new QueryClient();
    const filters = {
      branches: [],
      includeTags: false,
      includeMyPullRequests: true
    };
    const tile = {
      id: 'tile:pull-requests',
      kind: 'github-actions' as const,
      owner: 'acme',
      repository: 'widgets',
      limit: 5,
      view: 'pull-requests' as const,
      filters
    };
    const dashboard: Dashboard = {
      ...createDashboard('dashboard:pull-requests', 'My pull requests'),
      tiles: [tile]
    };
    const buildRun = workflowRun({
      id: 102,
      name: 'Build',
      status: 'completed',
      conclusion: 'failure',
      pullRequestNumbers: [42]
    });
    const previewRun = workflowRun({
      id: 101,
      name: 'PR Preview Environments',
      status: 'completed',
      conclusion: 'success',
      pullRequestNumbers: [42]
    });

    queryClient.setQueryData(dashboardsQueryKey(profile.id), {
      profileId: profile.id,
      dashboards: [dashboard],
      selectedDashboardId: dashboard.id
    });
    queryClient.setQueryData(gitHubRepositoriesQueryKey(profile.id), []);
    queryClient.setQueryData(
      gitHubActionsRunsQueryKey({
        profileId: profile.id,
        owner: tile.owner,
        repository: tile.repository,
        limit: tile.limit,
        view: tile.view,
        filters
      }),
      {
        profileId: profile.id,
        owner: tile.owner,
        repository: tile.repository,
        runs: [buildRun, previewRun],
        pullRequests: [
          {
            number: 42,
            title: 'Group dashboard workflows',
            url: 'https://github.com/acme/widgets/pull/42',
            headRefName: 'feature/group-workflows',
            baseRefName: 'main',
            updatedAt: '2026-07-27T10:07:00Z',
            runs: [buildRun, previewRun]
          }
        ],
        searchedRunCount: 120,
        searchLimitReached: false,
        loadedAt: '2026-07-27T10:09:00Z'
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

    expect(markup).toContain('my open PRs · 1 PR');
    expect(markup).toContain('#42');
    expect(markup).toContain('Group dashboard workflows');
    expect(markup).toContain('feature/group-workflows');
    expect(markup).toContain('class="pull-request-workflow-run"');
    expect(markup).toContain('Build');
    expect(markup).toContain('PR Preview Environments');
    expect(markup).toContain('1 failed');
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
          view: 'runs',
          filters
        },
        {
          id: 'tile:api',
          kind: 'github-actions',
          owner: 'acme',
          repository: 'api',
          limit: 5,
          view: 'runs',
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
          view: tile.view,
          filters: tile.filters
        }),
        {
          profileId: profile.id,
          owner: tile.owner,
          repository: tile.repository,
          runs: [],
          pullRequests: [],
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
          view: 'runs',
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

  it('exposes failure actions only on failed workflow rows', () => {
    const markup = renderActionsDashboard([
      workflowRun({
        id: 101,
        status: 'completed',
        conclusion: 'failure'
      }),
      workflowRun({
        id: 100,
        status: 'completed',
        conclusion: 'success'
      })
    ]);

    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain(
      'title="Open workflow run · right-click for failure actions"'
    );
    expect(markup.match(/aria-haspopup="menu"/g)).toHaveLength(1);
  });

  it('routes the Send error to Codex menu item through the repository chooser', async () => {
    capturedContextMenuItems.length = 0;
    const chooseRepositoryPathForCodex = vi.fn(
      async () => '/repos/widgets'
    );
    const getGitHubWorkflowRunFailedLog = vi.fn(async () => 'Build failed');
    const openCodexTask = vi.fn(async () => undefined);
    vi.stubGlobal('window', {
      api: { getGitHubWorkflowRunFailedLog, openCodexTask }
    });

    try {
      const markup = renderActionsDashboard(
        [
          workflowRun({
            status: 'completed',
            conclusion: 'failure'
          })
        ],
        { chooseRepositoryPathForCodex }
      );
      const sendItem = capturedContextMenuItems.find((item) =>
        item.title?.startsWith('Choose the local checkout for acme/widgets')
      );

      expect(markup).toContain('Send error to Codex');
      expect(sendItem?.disabled).not.toBe(true);
      expect(sendItem?.onSelect).toBeTypeOf('function');

      sendItem?.onSelect?.();

      await vi.waitFor(() => {
        expect(openCodexTask).toHaveBeenCalledWith(
          '/repos/widgets',
          expect.stringContaining('Build failed')
        );
      });
      expect(chooseRepositoryPathForCodex).toHaveBeenCalledWith({
        host: 'github.com',
        owner: 'acme',
        name: 'widgets'
      });
      expect(getGitHubWorkflowRunFailedLog).toHaveBeenCalledWith({
        profileId: profile.id,
        owner: 'acme',
        repository: 'widgets',
        runId: 101
      });
    } finally {
      vi.unstubAllGlobals();
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
      stackType: 'swarm',
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
      portainerUrl:
        'https://portainer.example.com/#!/3/docker/stacks/storefront?id=12&type=1&regular=true',
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

function renderActionsDashboard(
  runs: GitHubWorkflowRun[],
  options: {
    chooseRepositoryPathForCodex?: (repository: {
      host: string;
      owner: string;
      name: string;
    }) => Promise<string | undefined>;
  } = {}
): string {
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
        view: 'runs',
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
      view: 'runs',
      filters
    }),
    {
      profileId: profile.id,
      owner: 'acme',
      repository: 'widgets',
      runs,
      pullRequests: [],
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
        chooseRepositoryPathForCodex={options.chooseRepositoryPathForCodex}
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
