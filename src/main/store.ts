import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Store from 'electron-store';

import type { WorkspaceState } from '@shared/types';
import {
  activateRepositoryTab,
  assignRepositoryProfile,
  closeRepositoryTab,
  createDefaultWorkspaceState,
  selectRepositoryCommit,
  selectRepositoryFile,
  setSidebarCollapsed,
  upsertRepositoryTab
} from '@shared/workspace';
import type { RepositorySummary } from '@shared/types';

type StoreShape = {
  workspace: WorkspaceState;
};

const store = new Store<StoreShape>({
  name: 'git-gud-workspace',
  ...testStoreDirectory('workspace'),
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

export function selectWorkspaceCommit(tabId: string, selectedCommit: string | undefined): WorkspaceState {
  return saveWorkspace(selectRepositoryCommit(getWorkspace(), tabId, selectedCommit));
}

export function selectWorkspaceFile(tabId: string, selectedFile: string | undefined): WorkspaceState {
  return saveWorkspace(selectRepositoryFile(getWorkspace(), tabId, selectedFile));
}

export function updateSidebarCollapsed(collapsed: boolean): WorkspaceState {
  return saveWorkspace(setSidebarCollapsed(getWorkspace(), collapsed));
}

export function assignWorkspaceProfile(repoPath: string, profileId: string | undefined): WorkspaceState {
  return saveWorkspace(assignRepositoryProfile(getWorkspace(), repoPath, profileId));
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
