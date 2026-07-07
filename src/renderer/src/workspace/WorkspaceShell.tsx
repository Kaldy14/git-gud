import type { ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { CommitDetailPanel } from '@renderer/components/commit/CommitDetailPanel';
import type { DiffStyle, WipDiffScope } from '@renderer/components/commit/fileDetailUtils';
import { FileFocusView } from '@renderer/components/diff/FileFocusView';
import { GraphView } from '@renderer/components/graph/GraphView';
import { ConflictBanner } from '@renderer/components/operations/ConflictBanner';
import { OperationLog, type OperationLogEntry } from '@renderer/components/operations/OperationLog';
import { InteractiveRebaseDialog } from '@renderer/components/rebase/InteractiveRebaseDialog';
import { Sidebar } from '@renderer/components/sidebar/Sidebar';
import { StartPage } from '@renderer/components/start/StartPage';
import { StatusBar } from '@renderer/components/statusbar/StatusBar';
import { TabStrip } from '@renderer/components/tabs/TabStrip';
import { Toolbar } from '@renderer/components/toolbar/Toolbar';
import {
  invalidateRepositoryQueries,
  useCommitGraph,
  useRepositoryChangeInvalidation,
  useRepositoryOverview
} from '@renderer/queries/repository';
import { useWorkspaceStore } from '@renderer/state/workspace';
import { COMMIT_GRAPH_LIMIT_STEP, DEFAULT_COMMIT_GRAPH_LIMIT } from '@shared/graph';
import type {
  GitConflictActionInput,
  GitInteractiveRebaseInput,
  GitInteractiveRebasePlan,
  GitOperationResult,
  GitProfile,
  GitResetInput
} from '@shared/types';

type InteractiveRebaseDialogState = {
  base: string;
  plan?: GitInteractiveRebasePlan;
  isLoading: boolean;
  isRunning: boolean;
  errorMessage?: string;
};

export function WorkspaceShell(): ReactElement {
  const {
    workspace,
    isLoading,
    errorMessage,
    initialize,
    openRepository,
    openRepositoryAtPath,
    activateTab,
    closeTab,
    selectCommit,
    selectFile,
    setSidebarCollapsed,
    assignProfile,
    clearError
  } = useWorkspaceStore();
  const [graphLimitByTab, setGraphLimitByTab] = useState<Record<string, number>>({});
  const [diffStyleByTab, setDiffStyleByTab] = useState<Record<string, DiffStyle>>({});
  const [wipScopeByTab, setWipScopeByTab] = useState<Record<string, Record<string, WipDiffScope>>>({});
  const [commitComposerFocusByTab, setCommitComposerFocusByTab] = useState<Record<string, number>>({});
  const [operationLogEntries, setOperationLogEntries] = useState<OperationLogEntry[]>([]);
  const [interactiveRebaseDialog, setInteractiveRebaseDialog] = useState<InteractiveRebaseDialogState>();
  const queryClient = useQueryClient();

  const activeTab = useMemo(
    () => workspace.tabs.find((tab) => tab.id === workspace.activeTabId),
    [workspace.activeTabId, workspace.tabs]
  );
  const graphLimit = activeTab ? (graphLimitByTab[activeTab.id] ?? DEFAULT_COMMIT_GRAPH_LIMIT) : DEFAULT_COMMIT_GRAPH_LIMIT;
  const repositoryQuery = useRepositoryOverview(activeTab?.path);
  const graphQuery = useCommitGraph(activeTab?.path, graphLimit);
  const repositoryError =
    repositoryQuery.error instanceof Error ? repositoryQuery.error.message : undefined;
  const graphError = graphQuery.error instanceof Error ? graphQuery.error.message : undefined;
  const graphRows = graphQuery.data?.rows ?? [];
  const selectedSha = activeTab?.selectedCommit;
  const selectedRow = graphRows.find((row) => row.sha === selectedSha) ?? graphRows[0];
  const parentSha = selectedRow?.parentShas[0];
  const activeDiffStyle = activeTab ? (diffStyleByTab[activeTab.id] ?? 'unified') : 'unified';
  const activeWipScopeByPath = activeTab ? (wipScopeByTab[activeTab.id] ?? {}) : {};
  const isOperationBusy = operationLogEntries.some((entry) => entry.status === 'pending');

  useRepositoryChangeInvalidation();

  useEffect(() => {
    void initialize();
  }, [initialize]);

  function handleSelectRow(sha: string): void {
    if (activeTab) {
      void selectCommit(activeTab.id, sha);
    }
  }

  function handleLoadMoreGraphRows(): void {
    if (!activeTab) {
      return;
    }

    const nextLimit = graphQuery.data?.nextLimit ?? graphLimit + COMMIT_GRAPH_LIMIT_STEP;
    setGraphLimitByTab((value) => ({ ...value, [activeTab.id]: nextLimit }));
  }

  function handleErrorAction(): void {
    if (errorMessage) {
      clearError();
      return;
    }

    void repositoryQuery.refetch();
  }

  async function handleAssignProfile(profileId: string | undefined): Promise<void> {
    if (!activeTab) {
      return;
    }

    await assignProfile(activeTab.path, profileId);
    await repositoryQuery.refetch();
  }

  async function handleSaveAndAssignProfile(profile: GitProfile): Promise<void> {
    await window.api.saveProfile(profile);
    await handleAssignProfile(profile.id);
  }

  function handleSetDiffStyle(style: DiffStyle): void {
    if (!activeTab) {
      return;
    }

    setDiffStyleByTab((value) => ({ ...value, [activeTab.id]: style }));
  }

  function handleChangeWipScope(path: string, scope: WipDiffScope): void {
    if (!activeTab) {
      return;
    }

    setWipScopeByTab((value) => ({
      ...value,
      [activeTab.id]: {
        ...(value[activeTab.id] ?? {}),
        [path]: scope
      }
    }));
  }

  async function handleStageAllWip(): Promise<void> {
    await runRepositoryOperation('Stage all files', (repoPath) => window.api.stageAll(repoPath));
  }

  function handleOpenWipCommitComposer(): void {
    if (!activeTab) {
      return;
    }

    void selectCommit(activeTab.id, 'wip');
    setCommitComposerFocusByTab((value) => ({
      ...value,
      [activeTab.id]: (value[activeTab.id] ?? 0) + 1
    }));
  }

  async function runRepositoryOperation(
    label: string,
    action: (repoPath: string) => Promise<GitOperationResult>
  ): Promise<boolean> {
    if (!activeTab) {
      return false;
    }

    const id = createLogId();
    const happenedAt = new Date().toISOString();
    setOperationLogEntries((entries) => [
      {
        id,
        label,
        status: 'pending',
        happenedAt
      },
      ...entries
    ]);

    try {
      const result = await action(activeTab.path);
      await invalidateRepositoryQueries(queryClient, result.repoPath, activeTab.selectedCommit);

      const status = result.operation?.status === 'conflicted' || result.conflictState?.isActive ? 'conflict' : 'success';
      const detail = result.conflictState?.message ?? result.operation?.message;
      setOperationLogEntries((entries) =>
        entries.map((entry) =>
          entry.id === id
            ? {
                ...entry,
                label: result.operation?.label ?? label,
                status,
                detail,
                happenedAt: result.happenedAt
              }
            : entry
        )
      );
      return true;
    } catch (error) {
      setOperationLogEntries((entries) =>
        entries.map((entry) =>
          entry.id === id
            ? {
                ...entry,
                status: 'error',
                detail: error instanceof Error ? error.message : 'Git operation failed.',
                happenedAt: new Date().toISOString()
              }
          : entry
        )
      );
      return false;
    }
  }

  function handleDismissOperation(id: string): void {
    setOperationLogEntries((entries) => entries.filter((entry) => entry.id !== id));
  }

  function handleFetch(): void {
    void runRepositoryOperation('Fetch', (repoPath) => window.api.fetchRepository(repoPath));
  }

  function handlePull(): void {
    void runRepositoryOperation('Pull fast-forward', (repoPath) => window.api.pullRepository(repoPath, { mode: 'ff-only' }));
  }

  function handlePush(): void {
    void runRepositoryOperation('Push', (repoPath) => window.api.pushRepository(repoPath, { forceWithLease: false }));
  }

  function handleCreateBranch(startPoint?: string): void {
    const name = window.prompt('Branch name');

    if (!name?.trim()) {
      return;
    }

    const checkout = window.confirm('Checkout the new branch now?');
    void runRepositoryOperation(`Create branch ${name.trim()}`, (repoPath) =>
      window.api.createBranch(repoPath, {
        name,
        startPoint,
        checkout
      })
    );
  }

  function handleStashPush(): void {
    const message = window.prompt('Stash message', repositoryQuery.data?.status.branch.head ?? 'WIP');

    if (message === null) {
      return;
    }

    const includeUntracked = window.confirm('Include untracked files in this stash?');
    void runRepositoryOperation('Stash changes', (repoPath) =>
      window.api.stashPush(repoPath, {
        message,
        includeUntracked
      })
    );
  }

  function handleStashApply(selector: string): void {
    if (!window.confirm(`Apply ${selector}?`)) {
      return;
    }

    void runRepositoryOperation(`Apply ${selector}`, (repoPath) => window.api.stashApply(repoPath, { selector }));
  }

  function handleStashPop(selector?: string): void {
    const stashSelector = selector ?? repositoryQuery.data?.stashes[0]?.selector;

    if (!stashSelector || !window.confirm(`Pop ${stashSelector}?`)) {
      return;
    }

    void runRepositoryOperation(`Pop ${stashSelector}`, (repoPath) => window.api.stashPop(repoPath, { selector: stashSelector }));
  }

  function handleStashDrop(selector: string): void {
    if (!window.confirm(`Drop ${selector}? This cannot be undone.`)) {
      return;
    }

    void runRepositoryOperation(`Drop ${selector}`, (repoPath) => window.api.stashDrop(repoPath, { selector }));
  }

  function handleCheckoutBranch(name: string): void {
    void runRepositoryOperation(`Checkout ${name}`, (repoPath) => window.api.checkoutRef(repoPath, { kind: 'local', name }));
  }

  function handleCheckoutRemoteBranch(name: string): void {
    const localName = window.prompt('Local branch name', defaultLocalNameForRemoteBranch(name));

    if (!localName?.trim()) {
      return;
    }

    void runRepositoryOperation(`Checkout ${localName.trim()}`, (repoPath) =>
      window.api.checkoutRef(repoPath, {
        kind: 'remote',
        name,
        localName
      })
    );
  }

  function handleCheckoutCommit(sha: string): void {
    if (!window.confirm(`Checkout ${sha.slice(0, 8)} in detached HEAD?`)) {
      return;
    }

    void runRepositoryOperation(`Checkout ${sha.slice(0, 8)}`, (repoPath) => window.api.checkoutRef(repoPath, { kind: 'commit', sha }));
  }

  function handleRenameBranch(name: string): void {
    const newName = window.prompt('New branch name', name);

    if (!newName?.trim() || newName.trim() === name) {
      return;
    }

    void runRepositoryOperation(`Rename ${name}`, (repoPath) => window.api.renameBranch(repoPath, { oldName: name, newName }));
  }

  function handleDeleteBranch(name: string): void {
    if (!window.confirm(`Delete branch ${name}?`)) {
      return;
    }

    const force = window.confirm('Force delete if the branch is not merged?');
    void runRepositoryOperation(`Delete ${name}`, (repoPath) => window.api.deleteBranch(repoPath, { name, force }));
  }

  function handleCreateTagAtCommit(sha: string): void {
    const name = window.prompt('Tag name');

    if (!name?.trim()) {
      return;
    }

    void runRepositoryOperation(`Create tag ${name.trim()}`, (repoPath) =>
      window.api.createTag(repoPath, {
        name,
        targetSha: sha
      })
    );
  }

  function handleDeleteTag(name: string): void {
    if (!window.confirm(`Delete tag ${name}?`)) {
      return;
    }

    void runRepositoryOperation(`Delete tag ${name}`, (repoPath) => window.api.deleteTag(repoPath, { name }));
  }

  function handleMergeCommit(sha: string): void {
    if (!window.confirm(`Merge ${sha.slice(0, 8)} into the current branch?`)) {
      return;
    }

    void runRepositoryOperation(`Merge ${sha.slice(0, 8)}`, (repoPath) => window.api.mergeRef(repoPath, { ref: sha }));
  }

  function handleCherryPickCommit(sha: string): void {
    if (!window.confirm(`Cherry-pick ${sha.slice(0, 8)} onto the current branch?`)) {
      return;
    }

    void runRepositoryOperation(`Cherry-pick ${sha.slice(0, 8)}`, (repoPath) => window.api.cherryPick(repoPath, sha));
  }

  function handleRevertCommit(sha: string): void {
    if (!window.confirm(`Revert ${sha.slice(0, 8)} on the current branch?`)) {
      return;
    }

    void runRepositoryOperation(`Revert ${sha.slice(0, 8)}`, (repoPath) => window.api.revertCommit(repoPath, sha));
  }

  function handleResetToCommit(sha: string): void {
    const mode = window.prompt('Reset mode: soft, mixed, or hard', 'mixed');
    const resetMode = normalizeResetMode(mode);

    if (!resetMode) {
      return;
    }

    if (resetMode === 'hard' && !window.confirm('Hard reset will overwrite tracked working tree changes. Continue?')) {
      return;
    }

    void runRepositoryOperation(`Reset ${resetMode} to ${sha.slice(0, 8)}`, (repoPath) =>
      window.api.resetToCommit(repoPath, {
        target: sha,
        mode: resetMode
      })
    );
  }

  function handleRebaseOntoCommit(sha: string): void {
    if (!window.confirm(`Rebase the current branch onto ${sha.slice(0, 8)}?`)) {
      return;
    }

    void runRepositoryOperation(`Rebase onto ${sha.slice(0, 8)}`, (repoPath) => window.api.rebaseOnto(repoPath, { target: sha }));
  }

  function handleInteractiveRebaseFromCommit(sha: string): void {
    if (!activeTab) {
      return;
    }

    setInteractiveRebaseDialog({
      base: sha,
      isLoading: true,
      isRunning: false
    });

    window.api
      .getInteractiveRebasePlan(activeTab.path, sha)
      .then((plan) => {
        setInteractiveRebaseDialog((state) =>
          state?.base === sha
            ? {
                base: sha,
                plan,
                isLoading: false,
                isRunning: false
              }
            : state
        );
      })
      .catch((error: unknown) => {
        setInteractiveRebaseDialog((state) =>
          state?.base === sha
            ? {
                base: sha,
                isLoading: false,
                isRunning: false,
                errorMessage: error instanceof Error ? error.message : 'Unable to prepare interactive rebase.'
              }
            : state
        );
      });
  }

  async function handleRunInteractiveRebase(input: GitInteractiveRebaseInput): Promise<void> {
    setInteractiveRebaseDialog((state) => (state ? { ...state, isRunning: true, errorMessage: undefined } : state));
    const completed = await runRepositoryOperation(`Interactive rebase from ${input.base.slice(0, 8)}`, (repoPath) =>
      window.api.runInteractiveRebase(repoPath, input)
    );

    if (completed) {
      setInteractiveRebaseDialog(undefined);
      return;
    }

    setInteractiveRebaseDialog((state) => (state ? { ...state, isRunning: false } : state));
  }

  function handleResolveConflict(action: GitConflictActionInput['action']): void {
    void runRepositoryOperation(`${action} conflict`, (repoPath) => window.api.resolveConflict(repoPath, { action }));
  }

  function handleUndo(): void {
    const undoEntry = repositoryQuery.data?.latestUndo;

    if (!undoEntry || undoEntry.staleReason) {
      return;
    }

    if (undoEntry.requiresConfirmation && !window.confirm(`${undoEntry.label}?`)) {
      return;
    }

    void runRepositoryOperation(undoEntry.label, (repoPath) => window.api.undoOperation(repoPath, undoEntry.id));
  }

  return (
    <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-[var(--bg-app)] text-[var(--text-1)]">
      <TabStrip
        tabs={workspace.tabs}
        activeTabId={workspace.activeTabId}
        activeRepoPath={activeTab?.path}
        recentRepos={workspace.recentRepos}
        profileState={repositoryQuery.data?.profileState}
        onActivateTab={(tabId) => void activateTab(tabId)}
        onCloseTab={(tabId) => void closeTab(tabId)}
        onOpenRepository={() => void openRepository()}
        onOpenRecentRepository={(repoPath) => void openRepositoryAtPath(repoPath)}
        onAssignProfile={handleAssignProfile}
        onSaveAndAssignProfile={handleSaveAndAssignProfile}
      />

      <Toolbar
        activeTab={activeTab}
        repositoryOverview={repositoryQuery.data}
        isBusy={isOperationBusy}
        latestUndo={repositoryQuery.data?.latestUndo}
        onFetch={handleFetch}
        onPull={handlePull}
        onPush={handlePush}
        onCreateBranch={() => handleCreateBranch()}
        onStashPush={handleStashPush}
        onStashPop={() => handleStashPop()}
        onUndo={handleUndo}
      />

      {errorMessage || repositoryError ? (
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-1.5 text-xs text-[var(--danger-text)]">
          <span>{errorMessage ?? repositoryError}</span>
          <button className="icon-btn h-6 w-6" type="button" onClick={handleErrorAction} aria-label="Retry or dismiss error">
            <X size={13} />
          </button>
        </div>
      ) : null}

      <ConflictBanner
        conflictState={repositoryQuery.data?.conflictState}
        isBusy={isOperationBusy}
        onResolve={handleResolveConflict}
      />

      <section className="flex min-h-0 flex-1">
        {activeTab ? (
          <>
            <Sidebar
              activeTab={activeTab}
              repositoryOverview={repositoryQuery.data}
              isLoading={repositoryQuery.isLoading}
              errorMessage={repositoryError}
              isCollapsed={workspace.sidebarCollapsed}
              onToggleCollapsed={() => void setSidebarCollapsed(!workspace.sidebarCollapsed)}
              isOperationBusy={isOperationBusy}
              onCheckoutBranch={handleCheckoutBranch}
              onCheckoutRemoteBranch={handleCheckoutRemoteBranch}
              onRenameBranch={handleRenameBranch}
              onDeleteBranch={handleDeleteBranch}
              onDeleteTag={handleDeleteTag}
            />
            {activeTab.selectedFile ? (
              <FileFocusView
                repoPath={activeTab.path}
                row={selectedRow}
                selectedFile={activeTab.selectedFile}
                diffStyle={activeDiffStyle}
                wipScopeByPath={activeWipScopeByPath}
                onSetDiffStyle={handleSetDiffStyle}
                onChangeWipScope={handleChangeWipScope}
                onClose={() => void selectFile(activeTab.id, undefined)}
              />
            ) : (
              <GraphView
                rows={graphRows}
                selectedSha={selectedRow?.sha}
                isLoading={graphQuery.isLoading}
                isFetching={graphQuery.isFetching}
                errorMessage={graphError}
                hasMore={graphQuery.data?.hasMore ?? false}
                onSelectRow={handleSelectRow}
                onLoadMore={handleLoadMoreGraphRows}
                onStageAllWip={handleStageAllWip}
                onOpenWipCommitComposer={handleOpenWipCommitComposer}
                onStashPush={handleStashPush}
                onStashApply={handleStashApply}
                onStashPop={handleStashPop}
                onStashDrop={handleStashDrop}
                onCheckoutCommit={handleCheckoutCommit}
                onCreateBranchAtCommit={handleCreateBranch}
                onCreateTagAtCommit={handleCreateTagAtCommit}
                onMergeCommit={handleMergeCommit}
                onRebaseOntoCommit={handleRebaseOntoCommit}
                onInteractiveRebaseFromCommit={handleInteractiveRebaseFromCommit}
                onCherryPickCommit={handleCherryPickCommit}
                onRevertCommit={handleRevertCommit}
                onResetToCommit={handleResetToCommit}
                isOperationBusy={isOperationBusy}
              />
            )}
            <CommitDetailPanel
              repoPath={activeTab.path}
              row={selectedRow}
              parentSha={parentSha}
              selectedFile={activeTab.selectedFile}
              profileState={repositoryQuery.data?.profileState}
              commitFocusSignal={commitComposerFocusByTab[activeTab.id] ?? 0}
              onSelectFile={(path) => void selectFile(activeTab.id, path)}
            />
          </>
        ) : (
          <StartPage
            isLoading={isLoading}
            recentRepos={workspace.recentRepos}
            onOpenRepository={() => void openRepository()}
            onOpenRecentRepository={(repoPath) => void openRepositoryAtPath(repoPath)}
          />
        )}
      </section>

      <StatusBar
        activeTab={activeTab}
        repositoryOverview={repositoryQuery.data}
        isRepositoryLoading={repositoryQuery.isLoading}
      />
      <OperationLog entries={operationLogEntries} onDismiss={handleDismissOperation} />
      {interactiveRebaseDialog ? (
        <InteractiveRebaseDialog
          plan={interactiveRebaseDialog.plan}
          isLoading={interactiveRebaseDialog.isLoading}
          isRunning={interactiveRebaseDialog.isRunning}
          errorMessage={interactiveRebaseDialog.errorMessage}
          onClose={() => setInteractiveRebaseDialog(undefined)}
          onRun={handleRunInteractiveRebase}
        />
      ) : null}
    </main>
  );
}

function createLogId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function defaultLocalNameForRemoteBranch(remoteBranchName: string): string {
  const separatorIndex = remoteBranchName.indexOf('/');
  return separatorIndex === -1 ? remoteBranchName : remoteBranchName.slice(separatorIndex + 1);
}

function normalizeResetMode(value: string | null): GitResetInput['mode'] | undefined {
  const normalized = value?.trim().toLowerCase();

  if (normalized === 'soft' || normalized === 'mixed' || normalized === 'hard') {
    return normalized;
  }

  return undefined;
}
