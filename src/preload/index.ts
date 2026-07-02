import { contextBridge, ipcRenderer } from 'electron';

import type { IpcChannelMap, RendererApi } from '@shared/ipc';

function invoke<TChannel extends keyof IpcChannelMap>(
  channel: TChannel,
  ...args: IpcChannelMap[TChannel]['args']
): Promise<IpcChannelMap[TChannel]['result']> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcChannelMap[TChannel]['result']>;
}

const api: RendererApi = {
  getWorkspace: () => invoke('workspace:get'),
  openRepository: () => invoke('repo:open-dialog'),
  openRepositoryAtPath: (repoPath) => invoke('repo:open-path', repoPath),
  activateTab: (tabId) => invoke('tabs:activate', tabId),
  closeTab: (tabId) => invoke('tabs:close', tabId),
  setSidebarCollapsed: (collapsed) => invoke('workspace:set-sidebar-collapsed', collapsed)
};

contextBridge.exposeInMainWorld('api', api);
