import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron';

import type { IpcChannelMap, IpcChannelName } from '@shared/ipc';
import type { WorkspaceState } from '@shared/types';

import { loadCommitGraph } from './git/commitGraph';
import { prepareInteractiveRebasePlan, rebaseOnto, runInteractiveRebase } from './git/commands/rebase';
import {
  checkoutRef,
  cherryPickCommit,
  createBranch,
  createTag,
  deleteBranch,
  deleteTag,
  fetchRepository,
  mergeRef,
  pullRepository,
  pushRepository,
  renameBranch,
  resetToCommit,
  resolveConflict,
  revertCommit,
  stashApply,
  stashDrop,
  stashPop,
  stashPush,
  undoOperation
} from './git/operations';
import {
  commitChanges,
  loadCommitDetail,
  loadFileDiff,
  loadWipDetail,
  stageAll,
  stageFile,
  unstageAll,
  unstageFile
} from './git/repositoryDetails';
import { loadRemotes, loadRepositoryOverview } from './git/repositoryOverview';
import { validateRepository } from './git/repoInspector';
import type { RepoWatcherRegistry } from './git/watcher';
import { validateIpcArgs } from './ipcValidation';
import { assignProfileToRepository, listProfiles, saveProfile, suggestProfileForRepository } from './profiles';
import {
  activateWorkspaceTab,
  closeWorkspaceTab,
  getWorkspace,
  openWorkspaceRepository,
  selectWorkspaceCommit,
  selectWorkspaceFile,
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
    const workspace = await applySuggestedProfileIfNeeded(openWorkspaceRepository(repository), repository.path);
    return syncWorkspaceWatchers(workspace, repoWatchers);
  });

  handle('repo:open-path', async (_event, repoPath) => {
    const repository = await validateRepository(repoPath);
    const workspace = await applySuggestedProfileIfNeeded(openWorkspaceRepository(repository), repository.path);
    return syncWorkspaceWatchers(workspace, repoWatchers);
  });

  handle('tabs:activate', (_event, tabId) => activateWorkspaceTab(tabId));
  handle('tabs:close', (_event, tabId) => syncWorkspaceWatchers(closeWorkspaceTab(tabId), repoWatchers));
  handle('tabs:select-commit', (_event, tabId, selectedCommit) => selectWorkspaceCommit(tabId, selectedCommit));
  handle('tabs:select-file', (_event, tabId, selectedFile) => selectWorkspaceFile(tabId, selectedFile));
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
  handle('repo:commit-detail', async (_event, repoPath, sha) => loadCommitDetail(getOpenRepositoryTab(repoPath), sha));
  handle('repo:wip-detail', async (_event, repoPath) => loadWipDetail(getOpenRepositoryTab(repoPath)));
  handle('repo:file-diff', async (_event, repoPath, request) => loadFileDiff(getOpenRepositoryTab(repoPath), request));
  handle('repo:stage-file', async (_event, repoPath, path) => stageFile(getOpenRepositoryTab(repoPath), path));
  handle('repo:unstage-file', async (_event, repoPath, path) => unstageFile(getOpenRepositoryTab(repoPath), path));
  handle('repo:stage-all', async (_event, repoPath) => stageAll(getOpenRepositoryTab(repoPath)));
  handle('repo:unstage-all', async (_event, repoPath) => unstageAll(getOpenRepositoryTab(repoPath)));
  handle('repo:commit', async (_event, repoPath, input) => commitChanges(getOpenRepositoryTab(repoPath), input));
  handle('repo:fetch', async (_event, repoPath) => fetchRepository(getOpenRepositoryTab(repoPath)));
  handle('repo:pull', async (_event, repoPath, input) => pullRepository(getOpenRepositoryTab(repoPath), input));
  handle('repo:push', async (_event, repoPath, input) => pushRepository(getOpenRepositoryTab(repoPath), input));
  handle('repo:create-branch', async (_event, repoPath, input) => createBranch(getOpenRepositoryTab(repoPath), input));
  handle('repo:rename-branch', async (_event, repoPath, input) => renameBranch(getOpenRepositoryTab(repoPath), input));
  handle('repo:delete-branch', async (_event, repoPath, input) => deleteBranch(getOpenRepositoryTab(repoPath), input));
  handle('repo:checkout', async (_event, repoPath, target) => checkoutRef(getOpenRepositoryTab(repoPath), target));
  handle('repo:merge', async (_event, repoPath, input) => mergeRef(getOpenRepositoryTab(repoPath), input));
  handle('repo:create-tag', async (_event, repoPath, input) => createTag(getOpenRepositoryTab(repoPath), input));
  handle('repo:delete-tag', async (_event, repoPath, input) => deleteTag(getOpenRepositoryTab(repoPath), input));
  handle('repo:stash-push', async (_event, repoPath, input) => stashPush(getOpenRepositoryTab(repoPath), input));
  handle('repo:stash-apply', async (_event, repoPath, input) => stashApply(getOpenRepositoryTab(repoPath), input));
  handle('repo:stash-pop', async (_event, repoPath, input) => stashPop(getOpenRepositoryTab(repoPath), input));
  handle('repo:stash-drop', async (_event, repoPath, input) => stashDrop(getOpenRepositoryTab(repoPath), input));
  handle('repo:cherry-pick', async (_event, repoPath, sha) => cherryPickCommit(getOpenRepositoryTab(repoPath), sha));
  handle('repo:revert', async (_event, repoPath, sha) => revertCommit(getOpenRepositoryTab(repoPath), sha));
  handle('repo:reset', async (_event, repoPath, input) => resetToCommit(getOpenRepositoryTab(repoPath), input));
  handle('repo:rebase', async (_event, repoPath, input) => rebaseOnto(getOpenRepositoryTab(repoPath), input));
  handle('repo:interactive-rebase-plan', async (_event, repoPath, base) =>
    prepareInteractiveRebasePlan(getOpenRepositoryTab(repoPath), base)
  );
  handle('repo:interactive-rebase', async (_event, repoPath, input) => runInteractiveRebase(getOpenRepositoryTab(repoPath), input));
  handle('repo:resolve-conflict', async (_event, repoPath, input) => resolveConflict(getOpenRepositoryTab(repoPath), input));
  handle('repo:undo', async (_event, repoPath, undoId) => undoOperation(getOpenRepositoryTab(repoPath), undoId));
  handle('profiles:list', () => listProfiles());
  handle('profiles:save', (_event, profile) => saveProfile(profile));
  handle('repo:assign-profile', async (_event, repoPath, profileId) => {
    const tab = getOpenRepositoryTab(repoPath);
    return assignProfileToRepository(repoPath, profileId, tab.assignedProfileId);
  });
}

function handle<TChannel extends IpcChannelName>(channel: TChannel, handler: IpcHandler<TChannel>): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    assertTrustedIpcSender(event);
    const validatedArgs = validateIpcArgs(channel, args);
    return handler(event, ...validatedArgs);
  });
}

function assertTrustedIpcSender(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url || event.sender.getURL();

  if (isTrustedRendererUrl(senderUrl)) {
    return;
  }

  throw new Error('Blocked IPC call from an untrusted renderer.');
}

function isTrustedRendererUrl(senderUrl: string): boolean {
  try {
    const url = new URL(senderUrl);

    if (url.protocol === 'file:') {
      return true;
    }

    const devRendererUrl = process.env.ELECTRON_RENDERER_URL;

    if (!devRendererUrl) {
      return false;
    }

    return url.origin === new URL(devRendererUrl).origin;
  } catch {
    return false;
  }
}

function syncWorkspaceWatchers(workspace: WorkspaceState, repoWatchers: RepoWatcherRegistry): WorkspaceState {
  repoWatchers.sync(workspace.tabs);
  return workspace;
}

function getOpenRepositoryTab(repoPath: string): WorkspaceState['tabs'][number] {
  const tab = getWorkspace().tabs.find((candidate) => candidate.path === repoPath);

  if (!tab) {
    throw new Error('Repository is not open in this workspace.');
  }

  return tab;
}

async function applySuggestedProfileIfNeeded(workspace: WorkspaceState, repoPath: string): Promise<WorkspaceState> {
  const tab = workspace.tabs.find((candidate) => candidate.path === repoPath);

  if (!tab || tab.assignedProfileId) {
    return workspace;
  }

  const remoteUrls = (await loadRemotes(repoPath)).flatMap((remote) => [remote.fetchUrl, remote.pushUrl]).filter(isString);
  const suggestedProfile = suggestProfileForRepository(repoPath, remoteUrls);

  if (!suggestedProfile) {
    return workspace;
  }

  return assignProfileToRepository(repoPath, suggestedProfile.id);
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}
