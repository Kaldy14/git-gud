import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  dashboardsQueryKey,
  gitHubActionsRunsQueryKey,
  gitHubRepositoriesQueryKey
} from '@renderer/queries/github';
import type { Dashboard, GitProfile } from '@shared/types';

import { DashboardView, WorkflowBranchFilterField } from './DashboardView';

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
