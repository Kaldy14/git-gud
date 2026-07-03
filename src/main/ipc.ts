import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron';

import type { IpcChannelMap, IpcChannelName } from '@shared/ipc';
import type { WorkspaceState } from '@shared/types';

import { loadCommitGraph } from './git/commitGraph';
import { loadRepositoryOverview } from './git/repositoryOverview';
import { validateRepository } from './git/repoInspector';
import type { RepoWatcherRegistry } from './git/watcher';
import { assignProfileToRepository, listProfiles, saveProfile } from './profiles';
import {
  activateWorkspaceTab,
  closeWorkspaceTab,
  getWorkspace,
  openWorkspaceRepository,
  selectWorkspaceCommit,
  updateSidebarCollapsed
} from './store';

type IpcHandler<TChannel extends IpcChannelName> = (
  event: IpcMainInvokeEvent,
  ...args: IpcChannelMap[TChannel]['args']
) => Promise<IpcChannelMap[TChannel]['result']> | IpcChannelMap[TChannel]['result'];

export function registerIpcHandlers(repoWatchers: RepoWatcherRegistry): void {
  handle('workspace:get', () => getWorkspace());

  handle('repo:open-dialog', async (event) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions: OpenDialogOptions = {
      title: 'Open Git Repository',
      properties: ['openDirectory']
    };
    const result = browserWindow
      ? await dialog.showOpenDialog(browserWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    if (result.canceled || !result.filePaths[0]) {
      return null;
    }

    const repository = await validateRepository(result.filePaths[0]);
    return syncWorkspaceWatchers(openWorkspaceRepository(repository), repoWatchers);
  });

  handle('repo:open-path', async (_event, repoPath) => {
    const repository = await validateRepository(repoPath);
    return syncWorkspaceWatchers(openWorkspaceRepository(repository), repoWatchers);
  });

  handle('tabs:activate', (_event, tabId) => activateWorkspaceTab(tabId));
  handle('tabs:close', (_event, tabId) => syncWorkspaceWatchers(closeWorkspaceTab(tabId), repoWatchers));
  handle('tabs:select-commit', (_event, tabId, selectedCommit) => selectWorkspaceCommit(tabId, selectedCommit));
  handle('workspace:set-sidebar-collapsed', (_event, collapsed) => updateSidebarCollapsed(collapsed));
  handle('repo:overview', async (_event, repoPath) => {
    const tab = getWorkspace().tabs.find((candidate) => candidate.path === repoPath);

    if (!tab) {
      throw new Error('Repository is not open in this workspace.');
    }

    return loadRepositoryOverview(tab);
  });
  handle('repo:graph', async (_event, repoPath, limit) => {
    const tab = getWorkspace().tabs.find((candidate) => candidate.path === repoPath);

    if (!tab) {
      throw new Error('Repository is not open in this workspace.');
    }

    return loadCommitGraph(tab, limit);
  });
  handle('profiles:list', () => listProfiles());
  handle('profiles:save', (_event, profile) => saveProfile(profile));
  handle('repo:assign-profile', async (_event, repoPath, profileId) => assignProfileToRepository(repoPath, profileId));
}

function handle<TChannel extends IpcChannelName>(channel: TChannel, handler: IpcHandler<TChannel>): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => handler(event, ...(args as IpcChannelMap[TChannel]['args'])));
}

function syncWorkspaceWatchers(workspace: WorkspaceState, repoWatchers: RepoWatcherRegistry): WorkspaceState {
  repoWatchers.sync(workspace.tabs);
  return workspace;
}
