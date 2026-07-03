import { describe, expect, it } from 'vitest';

import {
  activateRepositoryTab,
  assignRepositoryProfile,
  closeRepositoryTab,
  createDefaultWorkspaceState,
  createRepoTabId,
  upsertRepositoryTab
} from './workspace';

const alphaRepo = {
  path: '/repos/alpha',
  name: 'alpha',
  gitDir: '/repos/alpha/.git',
  commonDir: '/repos/alpha/.git'
};

const betaRepo = {
  path: '/repos/beta',
  name: 'beta',
  gitDir: '/repos/beta/.git',
  commonDir: '/repos/beta/.git'
};

describe('workspace state', () => {
  it('opens repositories as persistent tabs and recent repos', () => {
    const state = upsertRepositoryTab(createDefaultWorkspaceState(), alphaRepo, '2026-07-02T10:00:00.000Z');

    expect(state.activeTabId).toBe(createRepoTabId(alphaRepo.path));
    expect(state.tabs).toHaveLength(1);
    expect(state.recentRepos).toEqual([
      {
        path: alphaRepo.path,
        name: alphaRepo.name,
        lastOpenedAt: '2026-07-02T10:00:00.000Z'
      }
    ]);
  });

  it('activates and closes tabs without losing recent repos', () => {
    const withAlpha = upsertRepositoryTab(createDefaultWorkspaceState(), alphaRepo, '2026-07-02T10:00:00.000Z');
    const withBeta = upsertRepositoryTab(withAlpha, betaRepo, '2026-07-02T10:01:00.000Z');
    const activated = activateRepositoryTab(withBeta, createRepoTabId(alphaRepo.path));
    const closed = closeRepositoryTab(activated, createRepoTabId(alphaRepo.path));

    expect(closed.tabs.map((tab) => tab.path)).toEqual([betaRepo.path]);
    expect(closed.activeTabId).toBe(createRepoTabId(betaRepo.path));
    expect(closed.recentRepos.map((repo) => repo.path)).toEqual([betaRepo.path, alphaRepo.path]);
  });

  it('persists a repo profile assignment on the tab', () => {
    const state = upsertRepositoryTab(createDefaultWorkspaceState(), alphaRepo, '2026-07-02T10:00:00.000Z');
    const assigned = assignRepositoryProfile(state, alphaRepo.path, 'profile:kaldy');

    expect(assigned.tabs[0]?.assignedProfileId).toBe('profile:kaldy');
  });
});
