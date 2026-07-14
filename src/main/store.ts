import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Store from 'electron-store';

import type { AppSettings, AppSettingsInput, GitProfile, RepositorySummary, WorkspaceState } from '@shared/types';
import { createDefaultAppSettings, normalizeAppSettings } from '@shared/settings';
import {
  activateRepositoryTab,
  assignRepositoryProfile,
  closeRepositoryTab,
  createDefaultWorkspaceState,
  normalizeWorkspaceState,
  partitionWorkspaceByProfile,
  profileWorkspaceKey,
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
};

const store = new Store<StoreShape>({
  name: 'git-gud-workspace',
  clearInvalidConfig: true,
  ...testStoreDirectory('workspace'),
  defaults: {
    workspace: createDefaultWorkspaceState(),
    workspacesByProfile: {},
    settings: createDefaultAppSettings()
  }
});

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

export function activateWorkspaceTab(tabId: string): WorkspaceState {
  return saveWorkspace(activateRepositoryTab(getWorkspace(), tabId));
}

export function closeWorkspaceTab(tabId: string): WorkspaceState {
  return saveWorkspace(closeRepositoryTab(getWorkspace(), tabId));
}

export function selectWorkspaceCommit(tabId: string, selectedCommit: string | undefined): WorkspaceState {
  return saveWorkspace(selectRepositoryCommit(getWorkspace(), tabId, selectedCommit));
}

export function selectWorkspaceFile(tabId: string, selectedFile: string | undefined): WorkspaceState {
  return saveWorkspace(selectRepositoryFile(getWorkspace(), tabId, selectedFile));
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

function saveWorkspace(workspace: WorkspaceState): WorkspaceState {
  const workspacesByProfile = getProfileWorkspaces();
  const activeProfileId = getActiveProfileId();
  const normalized = workspaceForProfile(normalizeWorkspaceState(workspace), activeProfileId);
  store.set('workspacesByProfile', {
    ...workspacesByProfile,
    [profileWorkspaceKey(activeProfileId)]: normalized
  });
  return normalized;
}

function getProfileWorkspaces(): Record<string, WorkspaceState> {
  const stored = normalizeStoredProfileWorkspaces(store.get('workspacesByProfile', {}));

  if (Object.keys(stored).length > 0) {
    return stored;
  }

  const profiles = listProfiles();
  const migrated = partitionWorkspaceByProfile(
    store.get('workspace', createDefaultWorkspaceState()),
    (repoPath, assignedProfileId) => resolveLegacyWorkspaceProfile(repoPath, assignedProfileId, profiles)
  );
  store.set('workspacesByProfile', migrated.workspacesByProfile);
  setActiveProfileId(migrated.activeProfileId);
  return migrated.workspacesByProfile;
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
