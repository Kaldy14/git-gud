import { randomUUID } from 'node:crypto';

import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron';

import type { IpcChannelMap, IpcChannelName } from '@shared/ipc';
import type { GitOperationProgressEvent, WorkspaceState } from '@shared/types';

import { loadCommitGraph } from './git/commitGraph';
import { prepareInteractiveRebasePlan, rebaseOnto, runInteractiveRebase } from './git/commands/rebase';
import { loadConflictFile, resolveConflictFile } from './git/conflicts';
import { gitExecutor } from './git/exec';
import {
  checkoutRef,
  cherryPickCommits,
  createBranch,
  createTag,
  deleteBranch,
  deleteTag,
  fetchRepository,
  mergeRef,
  pullRepository,
  pushTag,
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
  applyWipPatch,
  commitChanges,
  discardAllChanges,
  discardFile,
  loadCommitDetail,
  loadCommitSelectionDetail,
  loadFileDiff,
  loadReviewPlan,
  loadWipDetail,
  stageAll,
  stageFile,
  unstageAll,
  unstageFile
} from './git/repositoryDetails';
import { loadRepositoryOverview } from './git/repositoryOverview';
import { loadComparison, loadFileBlame, loadFileHistory } from './git/repositoryInspection';
import { validateRepository } from './git/repoInspector';
import { clearReviewSyntaxCache, clearReviewSyntaxCacheForRepository } from './git/reviewSyntax';
import type { RepoWatcherRegistry } from './git/watcher';
import { validateIpcArgs } from './ipcValidation';
import { isTrustedRendererUrl } from './ipcSecurity';
import { requestOperationCancellation } from './operationCancellation';
import { assignProfileToRepository, listGitHubAccounts, listProfiles, saveProfile } from './profiles';
import { loadReviewedChunks, updateReviewProgress } from './reviewProgress';
import {
  activateWorkspaceTab,
  activateWorkspaceProfile,
  closeWorkspaceTab,
  getAppSettings,
  getWorkspace,
  openWorkspaceRepository,
  replaceWorkspaceRepository,
  selectWorkspaceCommit,
  selectWorkspaceFile,
  updateAppSettings,
  updateDetailPanelCollapsed,
  updateDetailPanelWidth,
  updateSidebarCollapsed,
  updateSidebarWidth
} from './store';
import { openCodexTaskForRepository, openRepositoryFileInEditor, revealRepositoryFileInFinder } from './system';

type IpcHandler<TChannel extends IpcChannelName> = (
  event: IpcMainInvokeEvent,
  ...args: IpcChannelMap[TChannel]['args']
) => Promise<IpcChannelMap[TChannel]['result']> | IpcChannelMap[TChannel]['result'];

type TrackedOperation = {
  operationId: string;
  repoPath: string;
  label: string;
  startedAt: number;
  cancellable: boolean;
  cancelRequested: boolean;
};

const activeOperations = new Map<string, TrackedOperation>();
const trackedOperationDescriptors: Partial<Record<IpcChannelName, { label: string; cancellable?: boolean }>> = {
  'repo:apply-patch': { label: 'Apply patch' },
  'repo:stage-file': { label: 'Stage file' },
  'repo:unstage-file': { label: 'Unstage file' },
  'repo:discard-file': { label: 'Discard file changes' },
  'repo:discard-all': { label: 'Discard all changes' },
  'repo:stage-all': { label: 'Stage all files' },
  'repo:unstage-all': { label: 'Unstage all files' },
  'repo:commit': { label: 'Commit changes' },
  'repo:fetch': { label: 'Fetch', cancellable: true },
  'repo:pull': { label: 'Pull' },
  'repo:push': { label: 'Push' },
  'repo:create-branch': { label: 'Create branch' },
  'repo:rename-branch': { label: 'Rename branch' },
  'repo:delete-branch': { label: 'Delete branch' },
  'repo:checkout': { label: 'Checkout' },
  'repo:merge': { label: 'Merge' },
  'repo:create-tag': { label: 'Create tag' },
  'repo:push-tag': { label: 'Push tag', cancellable: true },
  'repo:delete-tag': { label: 'Delete tag' },
  'repo:stash-push': { label: 'Stash changes' },
  'repo:stash-apply': { label: 'Apply stash' },
  'repo:stash-pop': { label: 'Pop stash' },
  'repo:stash-drop': { label: 'Drop stash' },
  'repo:cherry-pick': { label: 'Cherry-pick' },
  'repo:revert': { label: 'Revert' },
  'repo:reset': { label: 'Reset' },
  'repo:rebase': { label: 'Rebase' },
  'repo:interactive-rebase': { label: 'Interactive rebase' },
  'repo:resolve-conflict': { label: 'Resolve conflict' },
  'repo:resolve-conflict-file': { label: 'Save conflict resolution' },
  'repo:undo': { label: 'Undo' },
  'repo:assign-profile': { label: 'Apply Git profile' }
};

export function registerIpcHandlers(repoWatchers: RepoWatcherRegistry): void {
  function inRepositoryTransaction<T>(
    repoPath: string,
    operation: (tab: WorkspaceState['tabs'][number]) => Promise<T>
  ): Promise<T> {
    const tab = getOpenRepositoryTab(repoPath);
    return gitExecutor.transaction(repoPath, () =>
      repoWatchers.runDuringMutation(repoPath, () => operation(tab))
    );
  }

  gitExecutor.onProgress((event) => {
    const operation = activeOperations.get(event.cwd);

    if (!operation) {
      return;
    }

    if (event.operationId !== operation.operationId) {
      return;
    }

    if (event.type === 'start') {
      emitOperationProgress(operation, 'running');
      return;
    }

    if (event.type === 'output') {
      const message = event.chunk.trim();

      if (message) {
        emitOperationProgress(operation, 'output', message, event.stream);
      }
    }
  });

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
    const workspace = openWorkspaceRepository(repository);
    return syncWorkspaceWatchers(workspace, repoWatchers);
  });

  handle('repo:open-path', async (_event, repoPath) => {
    const repository = await validateRepository(repoPath);
    const workspace = openWorkspaceRepository(repository);
    return syncWorkspaceWatchers(workspace, repoWatchers);
  });

  handle('repo:replace-path', async (_event, tabId, repoPath) => {
    const previousPath = getWorkspace().tabs.find((tab) => tab.id === tabId)?.path;

    if (!previousPath) {
      throw new Error('Repository tab is not open in this workspace.');
    }

    const repository = await validateRepository(repoPath);
    const workspace = syncWorkspaceWatchers(replaceWorkspaceRepository(tabId, repository), repoWatchers);

    if (!workspace.tabs.some((tab) => tab.path === previousPath)) {
      clearReviewSyntaxCacheForRepository(previousPath);
    }

    return workspace;
  });

  handle('tabs:activate', (_event, tabId) => activateWorkspaceTab(tabId));
  handle('tabs:close', (_event, tabId) => {
    const repoPath = getWorkspace().tabs.find((tab) => tab.id === tabId)?.path;
    const workspace = syncWorkspaceWatchers(closeWorkspaceTab(tabId), repoWatchers);

    if (repoPath) {
      clearReviewSyntaxCacheForRepository(repoPath);
    }

    return workspace;
  });
  handle('tabs:select-commit', (_event, tabId, selectedCommit) => selectWorkspaceCommit(tabId, selectedCommit));
  handle('tabs:select-file', (_event, tabId, selectedFile) => selectWorkspaceFile(tabId, selectedFile));
  handle('workspace:set-sidebar-collapsed', (_event, collapsed) => updateSidebarCollapsed(collapsed));
  handle('workspace:set-sidebar-width', (_event, width) => updateSidebarWidth(width));
  handle('workspace:set-detail-panel-collapsed', (_event, collapsed) => updateDetailPanelCollapsed(collapsed));
  handle('workspace:set-detail-panel-width', (_event, width) => updateDetailPanelWidth(width));
  handle('repo:overview', async (_event, repoPath) => {
    const tab = getWorkspace().tabs.find((candidate) => candidate.path === repoPath);

    if (!tab) {
      throw new Error('Repository is not open in this workspace.');
    }

    const overview = await loadRepositoryOverview(tab);
    repoWatchers.syncWorktrees(
      repoPath,
      overview.worktrees.filter((worktree) => !worktree.bare).map((worktree) => worktree.path)
    );
    return overview;
  });
  handle('repo:graph', async (_event, repoPath, limit) => {
    const tab = getWorkspace().tabs.find((candidate) => candidate.path === repoPath);

    if (!tab) {
      throw new Error('Repository is not open in this workspace.');
    }

    return loadCommitGraph(tab, limit);
  });
  handle('repo:commit-detail', async (_event, repoPath, sha) => loadCommitDetail(getOpenRepositoryTab(repoPath), sha));
  handle('repo:commit-selection-detail', async (_event, repoPath, shas) =>
    loadCommitSelectionDetail(getOpenRepositoryTab(repoPath), shas)
  );
  handle('repo:wip-detail', async (_event, repoPath) => loadWipDetail(getOpenRepositoryTab(repoPath)));
  handle('repo:file-diff', async (_event, repoPath, request) => loadFileDiff(getOpenRepositoryTab(repoPath), request));
  handle('repo:review-plan', async (_event, repoPath, target) => {
    const plan = await loadReviewPlan(getOpenRepositoryTab(repoPath), target);
    const validChunkIds = new Set(plan.units.flatMap((unit) => unit.chunks.map((chunk) => chunk.id)));
    return {
      ...plan,
      reviewedChunkIds: loadReviewedChunks(repoPath, plan.targetKey, validChunkIds)
    };
  });
  handle('repo:set-review-progress', (_event, repoPath, update) => {
    getOpenRepositoryTab(repoPath);
    return updateReviewProgress(repoPath, update);
  });
  handle('repo:file-history', async (_event, repoPath, path, limit) =>
    loadFileHistory(getOpenRepositoryTab(repoPath), path, limit)
  );
  handle('repo:file-blame', async (_event, repoPath, path, revision) =>
    loadFileBlame(getOpenRepositoryTab(repoPath), path, revision)
  );
  handle('repo:compare', async (_event, repoPath, base, head) =>
    loadComparison(getOpenRepositoryTab(repoPath), base, head)
  );
  handle('repo:apply-patch', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => applyWipPatch(tab, input))
  );
  handle('repo:stage-file', async (_event, repoPath, path) =>
    inRepositoryTransaction(repoPath, (tab) => stageFile(tab, path))
  );
  handle('repo:unstage-file', async (_event, repoPath, path) =>
    inRepositoryTransaction(repoPath, (tab) => unstageFile(tab, path))
  );
  handle('repo:discard-file', async (_event, repoPath, path) =>
    inRepositoryTransaction(repoPath, (tab) => discardFile(tab, path))
  );
  handle('repo:discard-all', async (_event, repoPath) =>
    inRepositoryTransaction(repoPath, discardAllChanges)
  );
  handle('repo:open-file', async (_event, repoPath, path) => openRepositoryFileInEditor(getOpenRepositoryTab(repoPath), path));
  handle('repo:reveal-file', async (_event, repoPath, path) => revealRepositoryFileInFinder(getOpenRepositoryTab(repoPath), path));
  handle('system:open-codex-task', async (_event, repoPath, prompt) =>
    openCodexTaskForRepository(getOpenRepositoryTab(repoPath), prompt)
  );
  handle('repo:stage-all', async (_event, repoPath) => inRepositoryTransaction(repoPath, stageAll));
  handle('repo:unstage-all', async (_event, repoPath) => inRepositoryTransaction(repoPath, unstageAll));
  handle('repo:commit', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => commitChanges(tab, input))
  );
  handle('repo:fetch', async (_event, repoPath) => inRepositoryTransaction(repoPath, fetchRepository));
  handle('repo:pull', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => pullRepository(tab, input))
  );
  handle('repo:push', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => pushRepository(tab, input))
  );
  handle('repo:create-branch', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => createBranch(tab, input))
  );
  handle('repo:rename-branch', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => renameBranch(tab, input))
  );
  handle('repo:delete-branch', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => deleteBranch(tab, input))
  );
  handle('repo:checkout', async (_event, repoPath, target) =>
    inRepositoryTransaction(repoPath, (tab) => checkoutRef(tab, target))
  );
  handle('repo:merge', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => mergeRef(tab, input))
  );
  handle('repo:create-tag', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => createTag(tab, input))
  );
  handle('repo:push-tag', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => pushTag(tab, input))
  );
  handle('repo:delete-tag', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => deleteTag(tab, input))
  );
  handle('repo:stash-push', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => stashPush(tab, input))
  );
  handle('repo:stash-apply', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => stashApply(tab, input))
  );
  handle('repo:stash-pop', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => stashPop(tab, input))
  );
  handle('repo:stash-drop', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => stashDrop(tab, input))
  );
  handle('repo:cherry-pick', async (_event, repoPath, shas) =>
    inRepositoryTransaction(repoPath, (tab) => cherryPickCommits(tab, shas))
  );
  handle('repo:revert', async (_event, repoPath, sha) =>
    inRepositoryTransaction(repoPath, (tab) => revertCommit(tab, sha))
  );
  handle('repo:reset', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => resetToCommit(tab, input))
  );
  handle('repo:rebase', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => rebaseOnto(tab, input))
  );
  handle('repo:interactive-rebase-plan', async (_event, repoPath, base) =>
    prepareInteractiveRebasePlan(getOpenRepositoryTab(repoPath), base)
  );
  handle('repo:interactive-rebase', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => runInteractiveRebase(tab, input))
  );
  handle('repo:resolve-conflict', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => resolveConflict(tab, input))
  );
  handle('repo:conflict-file', async (_event, repoPath, path) =>
    loadConflictFile(getOpenRepositoryTab(repoPath), path)
  );
  handle('repo:resolve-conflict-file', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => resolveConflictFile(tab, input))
  );
  handle('repo:undo', async (_event, repoPath, undoId) =>
    inRepositoryTransaction(repoPath, (tab) => undoOperation(tab, undoId))
  );
  handle('repo:cancel-operation', (_event, repoPath, operationId) =>
    cancelRepositoryOperation(repoPath, operationId)
  );
  handle('settings:get', () => getAppSettings());
  handle('settings:update', (_event, settings) => updateAppSettings(settings));
  handle('profiles:list', () => listProfiles());
  handle('profiles:list-github-accounts', () => listGitHubAccounts());
  handle('profiles:save', (_event, profile) => saveProfile(profile));
  handle('profiles:activate', (_event, profileId) => {
    if (profileId && !listProfiles().some((profile) => profile.id === profileId)) {
      throw new Error(`Profile ${profileId} does not exist.`);
    }

    clearReviewSyntaxCache();
    return syncWorkspaceWatchers(activateWorkspaceProfile(profileId), repoWatchers);
  });
  handle('repo:assign-profile', async (_event, repoPath, profileId) => {
    return inRepositoryTransaction(repoPath, (tab) =>
      assignProfileToRepository(repoPath, profileId, tab.assignedProfileId)
    );
  });
}

function handle<TChannel extends IpcChannelName>(channel: TChannel, handler: IpcHandler<TChannel>): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    assertTrustedIpcSender(event);
    const validatedArgs = validateIpcArgs(channel, args);
    const descriptor = trackedOperationDescriptors[channel];

    if (!descriptor) {
      return handler(event, ...validatedArgs);
    }

    const repoPath = (validatedArgs as readonly unknown[])[0];

    if (typeof repoPath !== 'string') {
      throw new Error(`${channel} is missing its repository path.`);
    }

    return runTrackedOperation(repoPath, descriptor, () => handler(event, ...validatedArgs));
  });
}

async function runTrackedOperation<T>(
  repoPath: string,
  descriptor: { label: string; cancellable?: boolean },
  operation: () => Promise<T> | T
): Promise<T> {
  if (activeOperations.has(repoPath)) {
    throw new Error('Another Git operation is already running for this repository.');
  }

  const trackedOperation: TrackedOperation = {
    operationId: randomUUID(),
    repoPath,
    label: descriptor.label,
    startedAt: Date.now(),
    cancellable: descriptor.cancellable ?? false,
    cancelRequested: false
  };
  activeOperations.set(repoPath, trackedOperation);
  emitOperationProgress(trackedOperation, 'queued');

  try {
    const result = await gitExecutor.withProgressContext(trackedOperation.operationId, async () => operation());
    emitOperationProgress(trackedOperation, 'completed');
    return result;
  } catch (error) {
    if (trackedOperation.cancelRequested) {
      emitOperationProgress(trackedOperation, 'cancelled', `${trackedOperation.label} cancelled by user.`);
    } else {
      emitOperationProgress(
        trackedOperation,
        'failed',
        error instanceof Error ? error.message : 'Git operation failed.'
      );
    }
    throw error;
  } finally {
    activeOperations.delete(repoPath);
  }
}

function cancelRepositoryOperation(
  repoPath: string,
  operationId: string
): IpcChannelMap['repo:cancel-operation']['result'] {
  return requestOperationCancellation(
    activeOperations.get(repoPath),
    repoPath,
    operationId,
    (ownedOperationId) => gitExecutor.cancelOperation(ownedOperationId)
  );
}

function emitOperationProgress(
  operation: TrackedOperation,
  phase: GitOperationProgressEvent['phase'],
  message?: string,
  stream?: GitOperationProgressEvent['stream']
): void {
  const event: GitOperationProgressEvent = {
    operationId: operation.operationId,
    repoPath: operation.repoPath,
    label: operation.label,
    phase,
    ...(stream ? { stream } : {}),
    ...(message ? { message } : {}),
    elapsedMs: Math.max(0, Date.now() - operation.startedAt),
    cancellable: operation.cancellable,
    happenedAt: new Date().toISOString()
  };

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('repo:operation-progress', event);
    }
  }
}

function assertTrustedIpcSender(event: IpcMainInvokeEvent): void {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Blocked IPC call from a non-main renderer frame.');
  }

  const senderUrl = event.senderFrame.url;

  if (isTrustedRendererUrl(senderUrl)) {
    return;
  }

  throw new Error('Blocked IPC call from an untrusted renderer.');
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
