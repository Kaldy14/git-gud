import { describe, expect, it } from 'vitest';

import {
  activateRepositoryTab,
  assignRepositoryProfile,
  closeRepositoryTab,
  createDefaultWorkspaceState,
  createRepoTabId,
  normalizeWorkspaceState,
  partitionWorkspaceByProfile,
  profileWorkspaceKey,
  selectRepositoryCommit,
  setDetailPanelCollapsed,
  setDetailPanelWidth,
  setSidebarWidth,
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

  it('persists the selected commit on the tab', () => {
    const state = upsertRepositoryTab(createDefaultWorkspaceState(), alphaRepo, '2026-07-02T10:00:00.000Z');
    const selected = selectRepositoryCommit(state, createRepoTabId(alphaRepo.path), 'abc123');

    expect(selected.tabs[0]?.selectedCommit).toBe('abc123');
  });

  it('persists sidebar width within supported bounds', () => {
    const state = createDefaultWorkspaceState();

    expect(setSidebarWidth(state, 420).sidebarWidth).toBe(420);
    expect(setSidebarWidth(state, 120).sidebarWidth).toBe(220);
    expect(setSidebarWidth(state, 900).sidebarWidth).toBe(560);
  });

  it('persists a bounded detail panel layout', () => {
    const state = createDefaultWorkspaceState();
    const collapsed = setDetailPanelCollapsed(state, true);

    expect(collapsed.detailPanelCollapsed).toBe(true);
    expect(setDetailPanelWidth(state, 440).detailPanelWidth).toBe(440);
    expect(setDetailPanelWidth(state, 120).detailPanelWidth).toBe(300);
    expect(setDetailPanelWidth(state, 900).detailPanelWidth).toBe(620);
  });

  it('repairs malformed persisted workspace values', () => {
    const normalized = normalizeWorkspaceState({
      tabs: [{ id: 'broken' }],
      activeTabId: 'missing',
      recentRepos: [{ path: '/repo', name: 'repo', lastOpenedAt: 'now' }, null],
      sidebarCollapsed: 'no',
      sidebarWidth: Number.POSITIVE_INFINITY,
      detailPanelCollapsed: true,
      detailPanelWidth: 9999
    });

    expect(normalized.tabs).toEqual([]);
    expect(normalized.activeTabId).toBeUndefined();
    expect(normalized.recentRepos).toHaveLength(1);
    expect(normalized.sidebarCollapsed).toBe(false);
    expect(normalized.sidebarWidth).toBe(382);
    expect(normalized.detailPanelCollapsed).toBe(true);
    expect(normalized.detailPanelWidth).toBe(620);
  });

  it('partitions legacy tabs and recents into independent profile workspaces', () => {
    const withAlpha = assignRepositoryProfile(
      upsertRepositoryTab(createDefaultWorkspaceState(), alphaRepo, '2026-07-02T10:00:00.000Z'),
      alphaRepo.path,
      'profile:wrong'
    );
    const legacy = upsertRepositoryTab(withAlpha, betaRepo, '2026-07-02T10:01:00.000Z');
    const partitioned = partitionWorkspaceByProfile(legacy, (repoPath) =>
      repoPath === alphaRepo.path ? 'profile:kaldy' : 'profile:vaclav'
    );

    expect(partitioned.activeProfileId).toBe('profile:vaclav');
    expect(partitioned.workspacesByProfile[profileWorkspaceKey('profile:kaldy')]?.tabs).toEqual([
      expect.objectContaining({ path: alphaRepo.path, assignedProfileId: 'profile:kaldy' })
    ]);
    expect(partitioned.workspacesByProfile[profileWorkspaceKey('profile:vaclav')]?.tabs).toEqual([
      expect.objectContaining({ path: betaRepo.path, assignedProfileId: 'profile:vaclav' })
    ]);
    expect(
      partitioned.workspacesByProfile[profileWorkspaceKey('profile:kaldy')]?.recentRepos.map((repo) => repo.path)
    ).toEqual([alphaRepo.path]);
    expect(
      partitioned.workspacesByProfile[profileWorkspaceKey('profile:vaclav')]?.recentRepos.map((repo) => repo.path)
    ).toEqual([betaRepo.path]);
  });
});
