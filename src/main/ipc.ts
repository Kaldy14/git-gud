import { randomUUID } from 'node:crypto';

import {
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  shell,
  type IpcMainInvokeEvent,
  type OpenDialogOptions
} from 'electron';

import type { IpcChannelMap, IpcChannelName } from '@shared/ipc';
import type {
  DashboardActionAlertState,
  DashboardActionFailureAlert,
  GitOperationProgressEvent,
  GitReviewPlan,
  WorkspaceState
} from '@shared/types';

import { loadAgentNotes } from './agentNotes';
import {
  getCodexAgentNotesSkillState,
  installCodexAgentNotesSkill,
  removeCodexAgentNotesSkill
} from './codexAgentNotes';
import { loadCommitGraph } from './git/commitGraph';
import { generateCommitMessage } from './commitMessage';
import { prepareInteractiveRebasePlan, rebaseOnto, runInteractiveRebase } from './git/commands/rebase';
import { loadConflictFile, resolveConflictFile } from './git/conflicts';
import { gitExecutor } from './git/exec';
import { loadPullRequestConflictDetails } from './git/pullRequestConflicts';
import { cloneRepository, initializeRepository } from './git/repositoryCreation';
import {
  addRemote,
  checkoutRef,
  cherryPickCommits,
  createBranch,
  createTag,
  deleteBranch,
  deleteTag,
  fetchRepository,
  fetchRemote,
  mergeRef,
  pullRepository,
  publishBranchWithTag,
  pushTag,
  pushRepository,
  renameBranch,
  removeRemote,
  setBranchUpstream,
  resetToCommit,
  resolveConflict,
  revertCommit,
  stashApply,
  stashDrop,
  stashPop,
  stashPush,
  undoOperation,
  updateRemote
} from './git/operations';
import {
  applyWipPatch,
  commitChanges,
  discardAllChanges,
  discardFile,
  ignorePath,
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
import { loadRepositoryIconDataUrl } from './git/repositoryIcon';
import { loadComparison, loadFileBlame, loadFileHistory } from './git/repositoryInspection';
import { findBaseRepositoryForMissingWorktree } from './git/repositoryRecovery';
import { listExternalApplications } from './externalApplications';
import {
  loadGitHubActionsRuns,
  loadGitHubWorkflowRunDetail,
  loadGitHubWorkflowRunFailedLog,
  loadGitHubPullRequestDetail,
  loadGitHubPullRequestInbox,
  loadGitHubPullRequestReviewerCandidates,
  loadGitHubPullRequestReviewPlan,
  loadGitHubRepositories,
  mergeGitHubPullRequest,
  submitGitHubPullRequestReview,
  updateGitHubPullRequestReviewer,
  updateGitHubPullRequestReviewComment
} from './github';
import { githubPullRequestReviewPlans } from './githubReviewPlans';
import { validateRepository } from './git/repoInspector';
import { clearReviewSyntaxCache, clearReviewSyntaxCacheForRepository } from './git/reviewSyntax';
import { resolveReviewTypeDefinition } from './git/reviewTypeDefinition';
import type { RepoWatcherRegistry } from './git/watcher';
import { validateIpcArgs } from './ipcValidation';
import { isTrustedRendererUrl } from './ipcSecurity';
import { requestOperationCancellation } from './operationCancellation';
import { openPullRequestInApplication } from './managedPullRequestWorktrees';
import { pullRequestDeepLinkQueue } from './pullRequestDeepLinks';
import {
  loadPortainerStackCatalog,
  loadPortainerStackImages,
  loadPortainerStackRuntime,
  testPortainerConnection
} from './portainer';
import {
  deletePortainerConnection,
  listPortainerConnections,
  savePortainerConnection
} from './portainerConnections';
import {
  assignProfileToRepository,
  createProfileCommandEnv,
  listGitHubAccounts,
  listProfiles,
  saveProfile
} from './profiles';
import { loadReviewedChunks, updateReviewProgress } from './reviewProgress';
import { reviewGuideManager } from './reviewGuide';
import type { ApplicationUpdater } from './updater';
import {
  activateWorkspaceTab,
  activateWorkspaceProfile,
  closeWorkspaceTab,
  deleteDashboard,
  getAppSettings,
  getDashboardActionAlerts,
  getDashboards,
  getRepositoryLastFetchedAt,
  getWorkspace,
  openWorkspaceRepository,
  reorderWorkspaceTab,
  replaceWorkspaceRepository,
  recordRepositoryFetch,
  recordDashboardActionRuns,
  selectWorkspaceCommit,
  selectWorkspaceFile,
  selectDashboard,
  saveDashboard,
  markDashboardActionAlertsRead,
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
const localReviewPlans = new Map<string, GitReviewPlan>();
const MAX_CACHED_LOCAL_REVIEW_PLANS = 8;
const trackedOperationDescriptors: Partial<Record<IpcChannelName, { label: string; cancellable?: boolean }>> = {
  'repo:apply-patch': { label: 'Apply patch' },
  'repo:stage-file': { label: 'Stage file' },
  'repo:unstage-file': { label: 'Unstage file' },
  'repo:discard-file': { label: 'Discard file changes' },
  'repo:ignore-path': { label: 'Ignore file' },
  'repo:discard-all': { label: 'Discard all changes' },
  'repo:stage-all': { label: 'Stage all files' },
  'repo:unstage-all': { label: 'Unstage all files' },
  'repo:commit': { label: 'Commit changes' },
  'repo:fetch': { label: 'Fetch', cancellable: true },
  'repo:pull': { label: 'Pull' },
  'repo:push': { label: 'Push' },
  'repo:publish-branch-with-tag': { label: 'Push branch and tag', cancellable: true },
  'repo:create-branch': { label: 'Create branch' },
  'repo:rename-branch': { label: 'Rename branch' },
  'repo:set-branch-upstream': { label: 'Set upstream' },
  'repo:delete-branch': { label: 'Delete branch' },
  'repo:checkout': { label: 'Checkout' },
  'repo:merge': { label: 'Merge' },
  'repo:create-tag': { label: 'Create tag', cancellable: true },
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
  'repo:assign-profile': { label: 'Apply Git profile' },
  'github:open-pull-request-in-application': {
    label: 'Prepare pull request checkout'
  }
};

export function registerIpcHandlers(
  repoWatchers: RepoWatcherRegistry,
  applicationUpdater: Pick<ApplicationUpdater, 'applyUpdate' | 'getState'>,
  isDevelopment = false
): void {
  handle('app:pull-request-deep-links-ready', () =>
    pullRequestDeepLinkQueue.markRendererReady()
  );

  function broadcastDashboardActionAlerts(state: DashboardActionAlertState): void {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('dashboards:alerts-changed', state);
    }
  }

  function showDashboardActionFailureNotification(
    alerts: DashboardActionFailureAlert[]
  ): void {
    const firstAlert = alerts[0];

    if (!firstAlert || !Notification.isSupported()) {
      return;
    }

    const notification =
      alerts.length === 1
        ? new Notification({
            title: `${firstAlert.owner}/${firstAlert.repository} workflow failed`,
            body: `${firstAlert.displayTitle} · ${firstAlert.workflowName} #${firstAlert.runNumber}`
          })
        : new Notification({
            title: `${alerts.length} GitHub Actions runs failed`,
            body: `${firstAlert.owner}/${firstAlert.repository} and ${alerts.length - 1} more`
          });

    notification.on('click', () => {
      const state = markDashboardActionAlertsRead(
        firstAlert.profileId,
        alerts.map((alert) => alert.id)
      );
      broadcastDashboardActionAlerts(state);
      if (isSafeExternalUrl(firstAlert.url)) {
        void shell.openExternal(firstAlert.url);
      }
    });
    notification.show();
  }

  reviewGuideManager.setOnReady(async ({ repoPath, plan, guide }) => {
    try {
      const isCurrent = repoPath.startsWith('github://')
        ? githubPullRequestReviewPlans.has(plan)
        : (await loadReviewPlan(getOpenRepositoryTab(repoPath), plan.target)).sourceFingerprint ===
          guide.sourceFingerprint;

      if (
        !isCurrent ||
        BrowserWindow.getFocusedWindow() ||
        !Notification.isSupported()
      ) {
        return;
      }

      new Notification({
        title: 'AI review guide ready',
        body: 'The ranked walkthrough is ready in your open review.'
      }).show();
    } catch {
      // The repository or review may have been closed while the guide was running.
    }
  });

  function inRepositoryTransaction<T>(
    repoPath: string,
    operation: (tab: WorkspaceState['tabs'][number]) => Promise<T>
  ): Promise<T> {
    const tab = getOpenRepositoryTab(repoPath);
    return gitExecutor.transaction(tab.commonDir, () =>
      repoWatchers.runDuringMutation(repoPath, () => operation(tab))
    );
  }

  async function recoverMissingWorktree(tabId: string): Promise<WorkspaceState | null> {
    const tab = getWorkspace().tabs.find((candidate) => candidate.id === tabId);

    if (!tab) {
      return null;
    }

    const repository = await findBaseRepositoryForMissingWorktree(tab);

    if (!repository) {
      return null;
    }

    clearReviewSyntaxCacheForRepository(tab.path);
    return syncWorkspaceWatchers(replaceWorkspaceRepository(tab.id, repository), repoWatchers);
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

  handle('updates:get-state', () => applicationUpdater.getState());
  handle('updates:apply', () => applicationUpdater.applyUpdate());
  handle('workspace:get', async () => {
    const workspace = getWorkspace();
    const recoveredWorkspace = workspace.activeTabId
      ? await recoverMissingWorktree(workspace.activeTabId)
      : null;

    return syncWorkspaceWatchers(recoveredWorkspace ?? workspace, repoWatchers);
  });

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

  handle('repo:choose-parent-directory', async (event) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions: OpenDialogOptions = {
      title: 'Choose Repository Location',
      buttonLabel: 'Choose',
      properties: ['openDirectory', 'createDirectory']
    };
    const result = browserWindow
      ? await dialog.showOpenDialog(browserWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  handle('repo:initialize', async (_event, input) => {
    const repository = await initializeRepository(input);
    return syncWorkspaceWatchers(openWorkspaceRepository(repository), repoWatchers);
  });

  handle('repo:clone', async (_event, input) => {
    const repository = await cloneRepository(input);
    return syncWorkspaceWatchers(openWorkspaceRepository(repository), repoWatchers);
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

  handle('repo:recover-missing-worktree', async (_event, tabId) => recoverMissingWorktree(tabId));

  handle('tabs:activate', (_event, tabId) => activateWorkspaceTab(tabId));
  handle('tabs:reorder', (_event, tabId, targetIndex) =>
    reorderWorkspaceTab(tabId, targetIndex)
  );
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

    const overview = {
      ...(await loadRepositoryOverview(tab)),
      lastFetchedAt: getRepositoryLastFetchedAt(tab.commonDir)
    };
    repoWatchers.syncWorktrees(
      repoPath,
      overview.worktrees.filter((worktree) => !worktree.bare).map((worktree) => worktree.path)
    );
    return overview;
  });
  handle('repo:icon', async (_event, repoPath) =>
    loadRepositoryIconDataUrl(getOpenRepositoryTab(repoPath).path)
  );
  handle('repo:graph', async (_event, repoPath, limit) => {
    const tab = getWorkspace().tabs.find((candidate) => candidate.path === repoPath);

    if (!tab) {
      throw new Error('Repository is not open in this workspace.');
    }

    return loadCommitGraph(tab, limit, getAppSettings().remoteAvatars);
  });
  handle('repo:commit-detail', async (_event, repoPath, sha) => loadCommitDetail(getOpenRepositoryTab(repoPath), sha));
  handle('repo:commit-selection-detail', async (_event, repoPath, shas) =>
    loadCommitSelectionDetail(getOpenRepositoryTab(repoPath), shas)
  );
  handle('repo:wip-detail', async (_event, repoPath) => loadWipDetail(getOpenRepositoryTab(repoPath)));
  handle('repo:generate-commit-message', async (_event, repoPath) =>
    generateCommitMessage(getOpenRepositoryTab(repoPath))
  );
  handle('repo:file-diff', async (_event, repoPath, request) => loadFileDiff(getOpenRepositoryTab(repoPath), request));
  handle('repo:review-plan', async (_event, repoPath, target) => {
    const plan = await loadReviewPlan(getOpenRepositoryTab(repoPath), target);
    rememberLocalReviewPlan(plan);
    const validChunkIds = new Set(plan.units.flatMap((unit) => unit.chunks.map((chunk) => chunk.id)));
    return {
      ...plan,
      reviewedChunkIds: loadReviewedChunks(repoPath, plan.targetKey, validChunkIds)
    };
  });
  handle('repo:agent-notes', (_event, repoPath) =>
    loadAgentNotes(getOpenRepositoryTab(repoPath))
  );
  handle('repo:review-type-definition', (_event, repoPath, input) => {
    const plan = repoPath.startsWith('github://')
      ? githubPullRequestReviewPlans.getByReview(repoPath, input.sourceFingerprint)
      : getCachedLocalReviewPlan(repoPath, input.sourceFingerprint);

    if (JSON.stringify(plan.target) !== JSON.stringify(input.target)) {
      throw new Error('The review target changed. Reload the review and try again.');
    }

    const tab = repoPath.startsWith('github://') ? undefined : getOpenRepositoryTab(repoPath);

    return resolveReviewTypeDefinition({
      repoPath: repoPath.startsWith('github://') ? undefined : repoPath,
      gitEnv: tab ? createProfileCommandEnv(tab.assignedProfileId) : undefined,
      target: input.target,
      baseSha: plan.baseSha,
      source: input.source,
      filePath: input.filePath,
      side: input.side,
      line: input.line,
      character: input.character,
      files: plan.fileContexts
    });
  });
  if (import.meta.env.DEV && isDevelopment) {
    handle('dev:review-grouping-benchmarks', async () => {
      const { listReviewGroupingBenchmarks } = await import(
        '../../benchmarks/review-grouping/devPreview'
      );
      return listReviewGroupingBenchmarks();
    });
    handle('dev:review-grouping-preview', async (_event, datasetId) => {
      const { loadReviewGroupingBenchmarkPreview } = await import(
        '../../benchmarks/review-grouping/devPreview'
      );
      return loadReviewGroupingBenchmarkPreview(datasetId);
    });
  }
  handle('repo:review-guide-state', (_event, repoPath, sourceFingerprint) => {
    getOpenRepositoryTab(repoPath);
    return reviewGuideManager.getState(repoPath, sourceFingerprint);
  });
  handle('repo:start-review-guide', async (_event, repoPath, target, sourceFingerprint) => {
    const plan = await loadReviewPlan(getOpenRepositoryTab(repoPath), target);

    if (plan.sourceFingerprint !== sourceFingerprint) {
      throw new Error('The changes moved while the AI guide was starting. Reload the review and try again.');
    }

    return reviewGuideManager.start(plan);
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
  handle('repo:ignore-path', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => ignorePath(tab, input))
  );
  handle('repo:discard-all', async (_event, repoPath) =>
    inRepositoryTransaction(repoPath, discardAllChanges)
  );
  handle('repo:open-file', async (_event, repoPath, path) => openRepositoryFileInEditor(getOpenRepositoryTab(repoPath), path));
  handle('repo:reveal-file', async (_event, repoPath, path) => revealRepositoryFileInFinder(getOpenRepositoryTab(repoPath), path));
  handle('system:open-codex-task', async (_event, repoPath, prompt) =>
    openCodexTaskForRepository(getOpenRepositoryTab(repoPath), prompt)
  );
  handle('system:external-applications', () => listExternalApplications());
  handle('repo:stage-all', async (_event, repoPath) => inRepositoryTransaction(repoPath, stageAll));
  handle('repo:unstage-all', async (_event, repoPath) => inRepositoryTransaction(repoPath, unstageAll));
  handle('repo:commit', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => commitChanges(tab, input))
  );
  handle('repo:fetch', async (_event, repoPath) =>
    inRepositoryTransaction(repoPath, async (tab) => {
      const result = await fetchRepository(tab);
      recordRepositoryFetch(tab.commonDir, result.happenedAt);
      return result;
    })
  );
  handle('repo:fetch-remote', async (_event, repoPath, remote) =>
    inRepositoryTransaction(repoPath, async (tab) => {
      const result = await fetchRemote(tab, remote);
      recordRepositoryFetch(tab.commonDir, result.happenedAt);
      return result;
    })
  );
  handle('repo:add-remote', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => addRemote(tab, input))
  );
  handle('repo:update-remote', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => updateRemote(tab, input))
  );
  handle('repo:remove-remote', async (_event, repoPath, remote) =>
    inRepositoryTransaction(repoPath, (tab) => removeRemote(tab, remote))
  );
  handle('repo:pull', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) =>
      pullRepository(tab, input, (fetchedAt) => recordRepositoryFetch(tab.commonDir, fetchedAt))
    )
  );
  handle('repo:push', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => pushRepository(tab, input))
  );
  handle('repo:publish-branch-with-tag', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => publishBranchWithTag(tab, input))
  );
  handle('repo:create-branch', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => createBranch(tab, input))
  );
  handle('repo:rename-branch', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => renameBranch(tab, input))
  );
  handle('repo:set-branch-upstream', async (_event, repoPath, input) =>
    inRepositoryTransaction(repoPath, (tab) => setBranchUpstream(tab, input))
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
  handle('codex:agent-notes-skill-state', () => getCodexAgentNotesSkillState());
  handle('codex:install-agent-notes-skill', () => installCodexAgentNotesSkill());
  handle('codex:remove-agent-notes-skill', () => removeCodexAgentNotesSkill());
  handle('profiles:list', () => listProfiles());
  handle('profiles:list-github-accounts', () => listGitHubAccounts());
  handle('dashboards:get', (_event, profileId) => getDashboards(profileId));
  handle('dashboards:save', (_event, dashboard) => saveDashboard(dashboard));
  handle('dashboards:delete', (_event, profileId, dashboardId) =>
    deleteDashboard(profileId, dashboardId)
  );
  handle('dashboards:select', (_event, profileId, dashboardId) =>
    selectDashboard(profileId, dashboardId)
  );
  handle('dashboards:alerts', (_event, profileId) =>
    getDashboardActionAlerts(profileId)
  );
  handle('dashboards:alerts-mark-read', (_event, profileId, alertIds) => {
    const state = markDashboardActionAlertsRead(profileId, alertIds);
    broadcastDashboardActionAlerts(state);
    return state;
  });
  handle('portainer:connections', () => listPortainerConnections());
  handle('portainer:connection-save', (_event, connection) =>
    savePortainerConnection(connection)
  );
  handle('portainer:connection-delete', (_event, connectionId) =>
    deletePortainerConnection(connectionId)
  );
  handle('portainer:connection-test', (_event, connection) =>
    testPortainerConnection(connection)
  );
  handle('portainer:stack-catalog', (_event, connectionId) =>
    loadPortainerStackCatalog(connectionId)
  );
  handle('portainer:stack-runtime', (_event, input) =>
    loadPortainerStackRuntime(input)
  );
  handle('portainer:stack-images', (_event, input) =>
    loadPortainerStackImages(input)
  );
  handle('github:repositories', (_event, profileId) => loadGitHubRepositories(profileId));
  handle('github:actions-runs', async (_event, input) => {
    const runs = await loadGitHubActionsRuns(input);
    const observation = recordDashboardActionRuns(input, runs);

    if (observation.newAlerts.length > 0) {
      broadcastDashboardActionAlerts(observation.state);
    }
    if (observation.notify) {
      showDashboardActionFailureNotification(observation.newAlerts);
    }

    return runs;
  });
  handle('github:workflow-run-detail', (_event, input) =>
    loadGitHubWorkflowRunDetail(input)
  );
  handle('github:workflow-run-failed-log', (_event, input) =>
    loadGitHubWorkflowRunFailedLog(input)
  );
  handle('github:pull-request-inbox', (_event, profileId) => loadGitHubPullRequestInbox(profileId));
  handle('github:pull-request-detail', (_event, locator) => loadGitHubPullRequestDetail(locator));
  handle('github:pull-request-reviewer-candidates', (_event, locator) =>
    loadGitHubPullRequestReviewerCandidates(locator)
  );
  handle('github:update-pull-request-reviewer', (_event, input) =>
    updateGitHubPullRequestReviewer(input)
  );
  handle('github:pull-request-review-plan', (_event, locator, headSha) =>
    loadGitHubPullRequestReviewPlan(locator, headSha)
  );
  handle('github:pull-request-conflicts', (_event, repoPath, input) =>
    loadPullRequestConflictDetails(getOpenRepositoryTab(repoPath), input)
  );
  handle('github:open-pull-request-in-application', (_event, repoPath, input) =>
    openPullRequestInApplication(getOpenRepositoryTab(repoPath), input)
  );
  handle('github:pull-request-review-guide-state', (_event, locator, sourceFingerprint) => {
    const plan = githubPullRequestReviewPlans.get(locator, sourceFingerprint);
    return reviewGuideManager.getState(plan.repoPath, sourceFingerprint);
  });
  handle('github:start-pull-request-review-guide', (_event, locator, sourceFingerprint) => {
    const plan = githubPullRequestReviewPlans.get(locator, sourceFingerprint);
    return reviewGuideManager.start(plan);
  });
  handle('github:submit-pull-request-review', (_event, input) => submitGitHubPullRequestReview(input));
  handle('github:update-pull-request-review-comment', (_event, input) =>
    updateGitHubPullRequestReviewComment(input)
  );
  handle('github:merge-pull-request', (_event, input) => mergeGitHubPullRequest(input));
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

function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
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

function rememberLocalReviewPlan(plan: GitReviewPlan): void {
  const key = `${plan.repoPath}\0${plan.sourceFingerprint}`;
  localReviewPlans.delete(key);
  localReviewPlans.set(key, plan);

  while (localReviewPlans.size > MAX_CACHED_LOCAL_REVIEW_PLANS) {
    const oldestKey = localReviewPlans.keys().next().value;
    if (typeof oldestKey !== 'string') return;
    localReviewPlans.delete(oldestKey);
  }
}

function getCachedLocalReviewPlan(repoPath: string, sourceFingerprint: string): GitReviewPlan {
  getOpenRepositoryTab(repoPath);
  const plan = localReviewPlans.get(`${repoPath}\0${sourceFingerprint}`);

  if (!plan) {
    throw new Error('Reload the review before opening a TypeScript definition.');
  }

  return plan;
}

function getOpenRepositoryTab(repoPath: string): WorkspaceState['tabs'][number] {
  const tab = getWorkspace().tabs.find((candidate) => candidate.path === repoPath);

  if (!tab) {
    throw new Error('Repository is not open in this workspace.');
  }

  return tab;
}
