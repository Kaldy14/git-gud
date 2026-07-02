import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron';

import type { IpcChannelMap, IpcChannelName } from '@shared/ipc';

import { validateRepository } from './git/repoInspector';
import {
  activateWorkspaceTab,
  closeWorkspaceTab,
  getWorkspace,
  openWorkspaceRepository,
  updateSidebarCollapsed
} from './store';

type IpcHandler<TChannel extends IpcChannelName> = (
  event: IpcMainInvokeEvent,
  ...args: IpcChannelMap[TChannel]['args']
) => Promise<IpcChannelMap[TChannel]['result']> | IpcChannelMap[TChannel]['result'];

export function registerIpcHandlers(): void {
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
    return openWorkspaceRepository(repository);
  });

  handle('repo:open-path', async (_event, repoPath) => {
    const repository = await validateRepository(repoPath);
    return openWorkspaceRepository(repository);
  });

  handle('tabs:activate', (_event, tabId) => activateWorkspaceTab(tabId));
  handle('tabs:close', (_event, tabId) => closeWorkspaceTab(tabId));
  handle('workspace:set-sidebar-collapsed', (_event, collapsed) => updateSidebarCollapsed(collapsed));
}

function handle<TChannel extends IpcChannelName>(channel: TChannel, handler: IpcHandler<TChannel>): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => handler(event, ...(args as IpcChannelMap[TChannel]['args'])));
}
