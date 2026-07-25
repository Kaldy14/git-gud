import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import Store from 'electron-store';

import type {
  AppSettings,
  AppSettingsInput,
  Dashboard,
  DashboardInput,
  DashboardState,
  GitProfile,
  RepositorySummary,
  WorkspaceState
} from '@shared/types';
import { createDefaultAppSettings, normalizeAppSettings } from '@shared/settings';
import {
  activateRepositoryTab,
  assignRepositoryProfile,
  closeRepositoryTab,
  createDefaultWorkspaceState,
  normalizeWorkspaceState,
  partitionWorkspaceByProfile,
  profileWorkspaceKey,
  replaceRepositoryTab,
  selectRepositoryCommit,
  selectRepositoryFile,
  setDetailPanelCollapsed,
  setDetailPanelWidth,
  setSidebarCollapsed,
  setSidebarWidth,
  upsertRepositoryTab
} from '@shared/workspace';

import { listProfiles } from './profiles';

type StoreShape = {
  workspace: WorkspaceState;
  workspacesByProfile: Record<string, WorkspaceState>;
  activeProfileId?: string;
  settings: AppSettings;
  dashboards: Dashboard[];
};

const store = new Store<StoreShape>({
  name: 'git-gud-workspace',
  clearInvalidConfig: true,
  ...testStoreDirectory('workspace'),
  defaults: {
    workspace: createDefaultWorkspaceState(),
    workspacesByProfile: {},
    settings: createDefaultAppSettings(),
    dashboards: []
  }
});

const SELECTION_PERSIST_DELAY_MS = 150;
const pendingWorkspaceWrites = new Map<string, WorkspaceState>();
const pendingWorkspaceWriteTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function getWorkspace(): WorkspaceState {
  const workspacesByProfile = getProfileWorkspaces();
  const activeProfileId = getActiveProfileId();
  const storedWorkspace = workspacesByProfile[profileWorkspaceKey(activeProfileId)];
  const workspace = normalizeWorkspaceState(storedWorkspace ?? createDefaultWorkspaceState(activeProfileId));

  return workspaceForProfile(workspace, activeProfileId);
}

export function activateWorkspaceProfile(profileId: string | undefined): WorkspaceState {
  getProfileWorkspaces();
  setActiveProfileId(profileId);
  return getWorkspace();
}

export function openWorkspaceRepository(repository: RepositorySummary): WorkspaceState {
  const workspace = getWorkspace();
  const opened = upsertRepositoryTab(workspace, repository);
  return saveWorkspace(assignRepositoryProfile(opened, repository.path, workspace.activeProfileId));
}

export function replaceWorkspaceRepository(tabId: string, repository: RepositorySummary): WorkspaceState {
  const workspace = getWorkspace();
  return saveWorkspace(replaceRepositoryTab(workspace, tabId, repository));
}

export function activateWorkspaceTab(tabId: string): WorkspaceState {
  return saveWorkspace(activateRepositoryTab(getWorkspace(), tabId));
}

export function closeWorkspaceTab(tabId: string): WorkspaceState {
  return saveWorkspace(closeRepositoryTab(getWorkspace(), tabId));
}

export function selectWorkspaceCommit(tabId: string, selectedCommit: string | undefined): WorkspaceState {
  return saveWorkspace(selectRepositoryCommit(getWorkspace(), tabId, selectedCommit), true);
}

export function selectWorkspaceFile(tabId: string, selectedFile: string | undefined): WorkspaceState {
  return saveWorkspace(selectRepositoryFile(getWorkspace(), tabId, selectedFile), true);
}

export function updateSidebarCollapsed(collapsed: boolean): WorkspaceState {
  return saveWorkspace(setSidebarCollapsed(getWorkspace(), collapsed));
}

export function updateSidebarWidth(width: number): WorkspaceState {
  return saveWorkspace(setSidebarWidth(getWorkspace(), width));
}

export function updateDetailPanelCollapsed(collapsed: boolean): WorkspaceState {
  return saveWorkspace(setDetailPanelCollapsed(getWorkspace(), collapsed));
}

export function updateDetailPanelWidth(width: number): WorkspaceState {
  return saveWorkspace(setDetailPanelWidth(getWorkspace(), width));
}

export function assignWorkspaceProfile(repoPath: string, profileId: string | undefined): WorkspaceState {
  return saveWorkspace(assignRepositoryProfile(getWorkspace(), repoPath, profileId));
}

export function getAppSettings(): AppSettings {
  return normalizeAppSettings(store.get('settings', createDefaultAppSettings()));
}

export function updateAppSettings(settings: AppSettingsInput): AppSettings {
  const nextSettings = normalizeAppSettings(settings, getAppSettings());
  store.set('settings', nextSettings);
  return nextSettings;
}

export function getDashboards(profileId: string): DashboardState {
  return {
    profileId,
    dashboards: normalizeDashboards(store.get('dashboards', []))
      .filter((dashboard) => dashboard.profileId === profileId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  };
}

export function saveDashboard(input: DashboardInput): DashboardState {
  const dashboards = normalizeDashboards(store.get('dashboards', []));
  const existing = input.id
    ? dashboards.find(
        (dashboard) => dashboard.id === input.id && dashboard.profileId === input.profileId
      )
    : undefined;
  const now = new Date().toISOString();
  const dashboard: Dashboard = {
    id: existing?.id ?? randomUUID(),
    profileId: input.profileId,
    name: input.name.trim(),
    tiles: input.tiles.map((tile) => ({
      id: tile.id || randomUUID(),
      kind: 'github-actions',
      owner: tile.owner.trim(),
      repository: tile.repository.trim(),
      limit: tile.limit
    })),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  const nextDashboards = existing
    ? dashboards.map((candidate) => (candidate.id === existing.id ? dashboard : candidate))
    : [...dashboards, dashboard];

  store.set('dashboards', nextDashboards);
  return getDashboards(input.profileId);
}

export function deleteDashboard(profileId: string, dashboardId: string): DashboardState {
  const dashboards = normalizeDashboards(store.get('dashboards', []));
  store.set(
    'dashboards',
    dashboards.filter(
      (dashboard) => dashboard.id !== dashboardId || dashboard.profileId !== profileId
    )
  );
  return getDashboards(profileId);
}

export function flushPendingWorkspaceWrites(): void {
  if (pendingWorkspaceWrites.size === 0) {
    return;
  }

  for (const timer of pendingWorkspaceWriteTimers.values()) {
    clearTimeout(timer);
  }

  pendingWorkspaceWriteTimers.clear();
  const stored = normalizeStoredProfileWorkspaces(store.get('workspacesByProfile', {}));
  store.set('workspacesByProfile', {
    ...stored,
    ...Object.fromEntries(pendingWorkspaceWrites)
  });
  pendingWorkspaceWrites.clear();
}

function normalizeDashboards(value: unknown): Dashboard[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((dashboard) => {
    if (!dashboard || typeof dashboard !== 'object') {
      return [];
    }

    const candidate = dashboard as Partial<Dashboard>;

    if (
      typeof candidate.id !== 'string' ||
      typeof candidate.profileId !== 'string' ||
      typeof candidate.name !== 'string' ||
      typeof candidate.createdAt !== 'string' ||
      typeof candidate.updatedAt !== 'string' ||
      !Array.isArray(candidate.tiles)
    ) {
      return [];
    }

    const tiles = candidate.tiles.flatMap((tile) => {
      if (
        !tile ||
        typeof tile !== 'object' ||
        tile.kind !== 'github-actions' ||
        typeof tile.id !== 'string' ||
        typeof tile.owner !== 'string' ||
        typeof tile.repository !== 'string' ||
        typeof tile.limit !== 'number' ||
        !Number.isInteger(tile.limit) ||
        tile.limit < 1 ||
        tile.limit > 20
      ) {
        return [];
      }

      return [tile];
    });

    return [
      {
        id: candidate.id,
        profileId: candidate.profileId,
        name: candidate.name,
        tiles,
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt
      }
    ];
  });
}

function saveWorkspace(workspace: WorkspaceState, deferPersistence = false): WorkspaceState {
  const workspacesByProfile = getProfileWorkspaces();
  const activeProfileId = getActiveProfileId();
  const workspaceKey = profileWorkspaceKey(activeProfileId);
  const normalized = workspaceForProfile(normalizeWorkspaceState(workspace), activeProfileId);

  if (deferPersistence) {
    scheduleWorkspaceWrite(workspaceKey, normalized);
    return normalized;
  }

  cancelPendingWorkspaceWrite(workspaceKey);
  store.set('workspacesByProfile', {
    ...workspacesByProfile,
    [workspaceKey]: normalized
  });
  return normalized;
}

function getProfileWorkspaces(): Record<string, WorkspaceState> {
  const stored = normalizeStoredProfileWorkspaces(store.get('workspacesByProfile', {}));

  if (Object.keys(stored).length > 0) {
    return overlayPendingWorkspaceWrites(stored);
  }

  const profiles = listProfiles();
  const migrated = partitionWorkspaceByProfile(
    store.get('workspace', createDefaultWorkspaceState()),
    (repoPath, assignedProfileId) => resolveLegacyWorkspaceProfile(repoPath, assignedProfileId, profiles)
  );
  store.set('workspacesByProfile', migrated.workspacesByProfile);
  setActiveProfileId(migrated.activeProfileId);
  return overlayPendingWorkspaceWrites(migrated.workspacesByProfile);
}

function scheduleWorkspaceWrite(workspaceKey: string, workspace: WorkspaceState): void {
  pendingWorkspaceWrites.set(workspaceKey, workspace);
  const previousTimer = pendingWorkspaceWriteTimers.get(workspaceKey);

  if (previousTimer) {
    clearTimeout(previousTimer);
  }

  const timer = setTimeout(() => {
    pendingWorkspaceWriteTimers.delete(workspaceKey);
    const latestWorkspace = pendingWorkspaceWrites.get(workspaceKey);

    if (!latestWorkspace) {
      return;
    }

    pendingWorkspaceWrites.delete(workspaceKey);
    const stored = normalizeStoredProfileWorkspaces(store.get('workspacesByProfile', {}));
    store.set('workspacesByProfile', {
      ...stored,
      [workspaceKey]: latestWorkspace
    });
  }, SELECTION_PERSIST_DELAY_MS);
  timer.unref();
  pendingWorkspaceWriteTimers.set(workspaceKey, timer);
}

function cancelPendingWorkspaceWrite(workspaceKey: string): void {
  const timer = pendingWorkspaceWriteTimers.get(workspaceKey);

  if (timer) {
    clearTimeout(timer);
    pendingWorkspaceWriteTimers.delete(workspaceKey);
  }

  pendingWorkspaceWrites.delete(workspaceKey);
}

function overlayPendingWorkspaceWrites(
  workspacesByProfile: Record<string, WorkspaceState>
): Record<string, WorkspaceState> {
  if (pendingWorkspaceWrites.size === 0) {
    return workspacesByProfile;
  }

  return {
    ...workspacesByProfile,
    ...Object.fromEntries(pendingWorkspaceWrites)
  };
}

function normalizeStoredProfileWorkspaces(value: unknown): Record<string, WorkspaceState> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, workspace]) => [key, normalizeWorkspaceState(workspace)])
  );
}

function resolveLegacyWorkspaceProfile(
  repoPath: string,
  assignedProfileId: string | undefined,
  profiles: GitProfile[]
): string | undefined {
  const matchingProfile = profiles.find((profile) =>
    profile.remoteUrlPatterns?.some((pattern) => repoPath.includes(pattern))
  );
  return matchingProfile?.id ?? assignedProfileId;
}

function workspaceForProfile(workspace: WorkspaceState, activeProfileId: string | undefined): WorkspaceState {
  return {
    ...workspace,
    activeProfileId,
    tabs: workspace.tabs.map((tab) => ({
      ...tab,
      assignedProfileId: activeProfileId
    }))
  };
}

function getActiveProfileId(): string | undefined {
  const value: unknown = store.get('activeProfileId');
  return typeof value === 'string' && value ? value : undefined;
}

function setActiveProfileId(profileId: string | undefined): void {
  if (profileId) {
    store.set('activeProfileId', profileId);
    return;
  }

  store.delete('activeProfileId');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function testStoreDirectory(name: string): { cwd: string } | Record<string, never> {
  if (process.env.NODE_ENV !== 'test') {
    return {};
  }

  return {
    cwd: join(tmpdir(), 'git-gud-vitest-store', name)
  };
}
