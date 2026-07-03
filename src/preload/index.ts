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
  selectCommit: (tabId, selectedCommit) => invoke('tabs:select-commit', tabId, selectedCommit),
  selectFile: (tabId, selectedFile) => invoke('tabs:select-file', tabId, selectedFile),
  setSidebarCollapsed: (collapsed) => invoke('workspace:set-sidebar-collapsed', collapsed),
  getRepositoryOverview: (repoPath) => invoke('repo:overview', repoPath),
  getCommitGraph: (repoPath, limit) => invoke('repo:graph', repoPath, limit),
  getCommitDetail: (repoPath, sha) => invoke('repo:commit-detail', repoPath, sha),
  getWipDetail: (repoPath) => invoke('repo:wip-detail', repoPath),
  getFileDiff: (repoPath, request) => invoke('repo:file-diff', repoPath, request),
  stageFile: (repoPath, path) => invoke('repo:stage-file', repoPath, path),
  unstageFile: (repoPath, path) => invoke('repo:unstage-file', repoPath, path),
  stageAll: (repoPath) => invoke('repo:stage-all', repoPath),
  unstageAll: (repoPath) => invoke('repo:unstage-all', repoPath),
  commitChanges: (repoPath, input) => invoke('repo:commit', repoPath, input),
  listProfiles: () => invoke('profiles:list'),
  saveProfile: (profile) => invoke('profiles:save', profile),
  assignProfile: (repoPath, profileId) => invoke('repo:assign-profile', repoPath, profileId),
  onRepositoryChanged: (listener) => {
    const channel = 'repo:changed';
    const wrappedListener = (_event: Electron.IpcRendererEvent, event: Parameters<typeof listener>[0]): void => {
      listener(event);
    };

    ipcRenderer.on(channel, wrappedListener);
    return () => ipcRenderer.removeListener(channel, wrappedListener);
  }
};

contextBridge.exposeInMainWorld('api', api);
