import { describe, expect, it } from 'vitest';

import type { Dashboard } from '@shared/types';

import { dashboardActionMonitoringInputs } from './dashboardAlerts';

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
          filters
        },
        {
          id: 'tile:duplicate',
          kind: 'github-actions',
          owner: 'acme',
          repository: 'widgets',
          limit: 10,
          filters
        },
        {
          id: 'tile:pull-requests',
          kind: 'github-actions',
          owner: 'acme',
          repository: 'widgets',
          limit: 10,
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
        filters
      },
      {
        profileId,
        owner: 'acme',
        repository: 'widgets',
        limit: 10,
        filters: {
          branches: [],
          includeTags: false,
          includeMyPullRequests: true
        }
      }
    ]);
  });
});
