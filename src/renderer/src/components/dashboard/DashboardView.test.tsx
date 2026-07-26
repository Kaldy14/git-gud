import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  dashboardsQueryKey,
  gitHubRepositoriesQueryKey
} from '@renderer/queries/github';
import type { Dashboard, GitProfile } from '@shared/types';

import { DashboardView } from './DashboardView';

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
