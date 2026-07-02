import Store from 'electron-store';

import type { WorkspaceState } from '@shared/types';
import {
  activateRepositoryTab,
  closeRepositoryTab,
  createDefaultWorkspaceState,
  setSidebarCollapsed,
  upsertRepositoryTab
} from '@shared/workspace';
import type { RepositorySummary } from '@shared/types';

type StoreShape = {
  workspace: WorkspaceState;
};

const store = new Store<StoreShape>({
  name: 'git-gud-workspace',
  defaults: {
    workspace: createDefaultWorkspaceState()
  }
});

export function getWorkspace(): WorkspaceState {
  return store.get('workspace', createDefaultWorkspaceState());
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

export function updateSidebarCollapsed(collapsed: boolean): WorkspaceState {
  return saveWorkspace(setSidebarCollapsed(getWorkspace(), collapsed));
}

function saveWorkspace(workspace: WorkspaceState): WorkspaceState {
  store.set('workspace', workspace);
  return workspace;
}
