import { describe, expect, it } from 'vitest';

import type { Dashboard } from '@shared/types';

import { resolveActiveDashboard } from './dashboardSelection';

const profileADashboards = [
  createDashboard('profile:a', 'a-overview', 'Overview'),
  createDashboard('profile:a', 'a-actions', 'Actions')
];
const profileBDashboards = [
  createDashboard('profile:b', 'b-overview', 'Overview'),
  createDashboard('profile:b', 'b-releases', 'Releases')
];

describe('resolveActiveDashboard', () => {
  it('restores the persisted dashboard on a cold load', () => {
    expect(
      resolveActiveDashboard(profileADashboards, undefined, 'a-actions')?.id
    ).toBe('a-actions');
  });

  it('uses the new profile selection instead of a stale requested dashboard', () => {
    expect(
      resolveActiveDashboard(profileBDashboards, 'a-actions', 'b-releases')?.id
    ).toBe('b-releases');
  });

  it('keeps an explicit in-profile selection ahead of persisted state', () => {
    expect(
      resolveActiveDashboard(profileBDashboards, 'b-overview', 'b-releases')?.id
    ).toBe('b-overview');
  });
});

function createDashboard(profileId: string, id: string, name: string): Dashboard {
  return {
    id,
    profileId,
    name,
    tiles: [],
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z'
  };
}
