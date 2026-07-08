import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Store from 'electron-store';

import type { AppSettings, AppSettingsInput, WorkspaceState } from '@shared/types';
import { createDefaultAppSettings, normalizeAppSettings } from '@shared/settings';
import {
  activateRepositoryTab,
  assignRepositoryProfile,
  closeRepositoryTab,
  createDefaultWorkspaceState,
  normalizeSidebarWidth,
  selectRepositoryCommit,
  selectRepositoryFile,
  setSidebarCollapsed,
  setSidebarWidth,
  upsertRepositoryTab
} from '@shared/workspace';
import type { RepositorySummary } from '@shared/types';

type StoreShape = {
  workspace: WorkspaceState;
  settings: AppSettings;
};

const store = new Store<StoreShape>({
  name: 'git-gud-workspace',
  ...testStoreDirectory('workspace'),
  defaults: {
    workspace: createDefaultWorkspaceState(),
    settings: createDefaultAppSettings()
  }
});

export function getWorkspace(): WorkspaceState {
  const defaults = createDefaultWorkspaceState();
  const workspace = store.get('workspace', defaults);

  return {
    ...defaults,
    ...workspace,
    sidebarWidth: normalizeSidebarWidth(workspace.sidebarWidth),
    detailPanelWidth: workspace.detailPanelWidth ?? defaults.detailPanelWidth
  };
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
