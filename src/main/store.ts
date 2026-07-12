import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Store from 'electron-store';

import type { AppSettings, AppSettingsInput, RepositorySummary, WorkspaceState } from '@shared/types';
import { createDefaultAppSettings, normalizeAppSettings } from '@shared/settings';
import {
  activateRepositoryTab,
  assignRepositoryProfile,
  closeRepositoryTab,
  createDefaultWorkspaceState,
  normalizeWorkspaceState,
  selectRepositoryCommit,
  selectRepositoryFile,
  setDetailPanelCollapsed,
  setDetailPanelWidth,
  setSidebarCollapsed,
  setSidebarWidth,
  upsertRepositoryTab
} from '@shared/workspace';

type StoreShape = {
  workspace: WorkspaceState;
  settings: AppSettings;
};

const store = new Store<StoreShape>({
  name: 'git-gud-workspace',
  clearInvalidConfig: true,
  ...testStoreDirectory('workspace'),
  defaults: {
    workspace: createDefaultWorkspaceState(),
    settings: createDefaultAppSettings()
  }
});

export function getWorkspace(): WorkspaceState {
  return normalizeWorkspaceState(store.get('workspace', createDefaultWorkspaceState()));
}

export function openWorkspaceRepository(repository: RepositorySummary): WorkspaceState {
  return saveWorkspace(upsertRepositoryTab(getWorkspace(), repository));
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
  store.set('workspace', workspace);
  return workspace;
}

function testStoreDirectory(name: string): { cwd: string } | Record<string, never> {
  if (process.env.NODE_ENV !== 'test') {
    return {};
  }

  return {
    cwd: join(tmpdir(), 'git-gud-vitest-store', name)
  };
}
