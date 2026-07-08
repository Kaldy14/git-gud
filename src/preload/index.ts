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
  setSidebarWidth: (width) => invoke('workspace:set-sidebar-width', width),
  getRepositoryOverview: (repoPath) => invoke('repo:overview', repoPath),
  getCommitGraph: (repoPath, limit) => invoke('repo:graph', repoPath, limit),
  getCommitDetail: (repoPath, sha) => invoke('repo:commit-detail', repoPath, sha),
  getWipDetail: (repoPath) => invoke('repo:wip-detail', repoPath),
  getFileDiff: (repoPath, request) => invoke('repo:file-diff', repoPath, request),
  applyWipPatch: (repoPath, input) => invoke('repo:apply-patch', repoPath, input),
  stageFile: (repoPath, path) => invoke('repo:stage-file', repoPath, path),
  unstageFile: (repoPath, path) => invoke('repo:unstage-file', repoPath, path),
  discardFile: (repoPath, path) => invoke('repo:discard-file', repoPath, path),
  openFile: (repoPath, path) => invoke('repo:open-file', repoPath, path),
  revealFile: (repoPath, path) => invoke('repo:reveal-file', repoPath, path),
  stageAll: (repoPath) => invoke('repo:stage-all', repoPath),
  unstageAll: (repoPath) => invoke('repo:unstage-all', repoPath),
  commitChanges: (repoPath, input) => invoke('repo:commit', repoPath, input),
  fetchRepository: (repoPath) => invoke('repo:fetch', repoPath),
  pullRepository: (repoPath, input) => invoke('repo:pull', repoPath, input),
  pushRepository: (repoPath, input) => invoke('repo:push', repoPath, input),
  createBranch: (repoPath, input) => invoke('repo:create-branch', repoPath, input),
  renameBranch: (repoPath, input) => invoke('repo:rename-branch', repoPath, input),
  deleteBranch: (repoPath, input) => invoke('repo:delete-branch', repoPath, input),
  checkoutRef: (repoPath, target) => invoke('repo:checkout', repoPath, target),
  mergeRef: (repoPath, input) => invoke('repo:merge', repoPath, input),
  createTag: (repoPath, input) => invoke('repo:create-tag', repoPath, input),
  deleteTag: (repoPath, input) => invoke('repo:delete-tag', repoPath, input),
  stashPush: (repoPath, input) => invoke('repo:stash-push', repoPath, input),
  stashApply: (repoPath, input) => invoke('repo:stash-apply', repoPath, input),
  stashPop: (repoPath, input) => invoke('repo:stash-pop', repoPath, input),
  stashDrop: (repoPath, input) => invoke('repo:stash-drop', repoPath, input),
  cherryPick: (repoPath, sha) => invoke('repo:cherry-pick', repoPath, sha),
  revertCommit: (repoPath, sha) => invoke('repo:revert', repoPath, sha),
  resetToCommit: (repoPath, input) => invoke('repo:reset', repoPath, input),
  rebaseOnto: (repoPath, input) => invoke('repo:rebase', repoPath, input),
  getInteractiveRebasePlan: (repoPath, base) => invoke('repo:interactive-rebase-plan', repoPath, base),
  runInteractiveRebase: (repoPath, input) => invoke('repo:interactive-rebase', repoPath, input),
  resolveConflict: (repoPath, input) => invoke('repo:resolve-conflict', repoPath, input),
  undoOperation: (repoPath, undoId) => invoke('repo:undo', repoPath, undoId),
  openTerminal: (repoPath) => invoke('repo:open-terminal', repoPath),
  getSettings: () => invoke('settings:get'),
  updateSettings: (settings) => invoke('settings:update', settings),
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
