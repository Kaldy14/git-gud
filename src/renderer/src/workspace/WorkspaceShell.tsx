import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { CommitDetailPanel } from '@renderer/components/commit/CommitDetailPanel';
import type { DiffStyle, WipDiffScope } from '@renderer/components/commit/fileDetailUtils';
import { FileFocusView } from '@renderer/components/diff/FileFocusView';
import { GraphView } from '@renderer/components/graph/GraphView';
import { CommandDialog, type CommandDialogConfig, type CommandDialogValues } from '@renderer/components/operations/CommandDialog';
import { ConflictBanner } from '@renderer/components/operations/ConflictBanner';
import { OperationLog, type OperationLogEntry } from '@renderer/components/operations/OperationLog';
import { QuickJumpDialog } from '@renderer/components/operations/QuickJumpDialog';
import { InteractiveRebaseDialog } from '@renderer/components/rebase/InteractiveRebaseDialog';
import { SettingsPanel } from '@renderer/components/settings/SettingsPanel';
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
import { COMMIT_GRAPH_LIMIT_STEP } from '@shared/graph';
import type {
  GitConflictActionInput,
  GitFileChangeDetail,
  GitInteractiveRebaseInput,
  GitInteractiveRebasePlan,
  GitOperationResult,
  GitProfile,
  GitResetInput,
  AppSettings
} from '@shared/types';
import { createDefaultAppSettings } from '@shared/settings';

type InteractiveRebaseDialogState = {
  base: string;
  plan?: GitInteractiveRebasePlan;
  isLoading: boolean;
  isRunning: boolean;
  errorMessage?: string;
};

type ShortcutState = {
  isBlocked: boolean;
  onFetch: () => void;
  onPush: () => void;
  onToggleDiffStyle: () => void;
  onOpenQuickJump: () => void;
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
  const [commandDialog, setCommandDialog] = useState<CommandDialogConfig>();
  const [settings, setSettings] = useState<AppSettings>(createDefaultAppSettings());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSettingsSaving, setIsSettingsSaving] = useState(false);
  const [settingsErrorMessage, setSettingsErrorMessage] = useState<string>();
  const [isQuickJumpOpen, setIsQuickJumpOpen] = useState(false);
  const shortcutStateRef = useRef<ShortcutState>({
    isBlocked: false,
    onFetch: () => {},
    onPush: () => {},
    onToggleDiffStyle: () => {},
    onOpenQuickJump: () => {}
  });
  const queryClient = useQueryClient();

  const activeTab = useMemo(
    () => workspace.tabs.find((tab) => tab.id === workspace.activeTabId),
    [workspace.activeTabId, workspace.tabs]
  );
  const graphLimit = activeTab ? (graphLimitByTab[activeTab.id] ?? settings.graphPageSize) : settings.graphPageSize;
  const repositoryQuery = useRepositoryOverview(activeTab?.path);
  const graphQuery = useCommitGraph(activeTab?.path, graphLimit);
  const repositoryError =
    repositoryQuery.error instanceof Error ? repositoryQuery.error.message : undefined;
  const graphError = graphQuery.error instanceof Error ? graphQuery.error.message : undefined;
  const graphRows = graphQuery.data?.rows ?? [];
  const selectedSha = activeTab?.selectedCommit;
  const selectedRow = graphRows.find((row) => row.sha === selectedSha) ?? graphRows[0];
  const parentSha = selectedRow?.parentShas[0];
  const activeDiffStyle = activeTab ? (diffStyleByTab[activeTab.id] ?? settings.defaultDiffStyle) : settings.defaultDiffStyle;
  const activeWipScopeByPath = activeTab ? (wipScopeByTab[activeTab.id] ?? {}) : {};
  const isOperationBusy = operationLogEntries.some((entry) => entry.status === 'pending');

  useRepositoryChangeInvalidation();

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    window.api
      .getSettings()
      .then(setSettings)
      .catch((error: unknown) => {
        setSettingsErrorMessage(error instanceof Error ? error.message : 'Unable to load settings.');
      });
  }, []);

  useEffect(() => {
    shortcutStateRef.current = {
      isBlocked: Boolean(commandDialog || interactiveRebaseDialog || isSettingsOpen || isQuickJumpOpen),
      onFetch: handleFetch,
      onPush: handlePush,
      onToggleDiffStyle: () => handleSetDiffStyle(activeDiffStyle === 'unified' ? 'split' : 'unified'),
      onOpenQuickJump: () => setIsQuickJumpOpen(true)
    };
  });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const shortcutState = shortcutStateRef.current;

      if (shortcutState.isBlocked || !(event.metaKey || event.ctrlKey) || isEditableTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();

      if (!event.shiftKey && key === 'p') {
        event.preventDefault();
        shortcutState.onOpenQuickJump();
        return;
      }

      if (event.shiftKey && key === 'f') {
        event.preventDefault();
        shortcutState.onFetch();
        return;
      }

      if (event.shiftKey && key === 'u') {
        event.preventDefault();
        shortcutState.onPush();
        return;
      }

      if (!event.shiftKey && event.key === '\\') {
        event.preventDefault();
        shortcutState.onToggleDiffStyle();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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

  async function handleSaveSettings(nextSettings: AppSettings): Promise<void> {
    setIsSettingsSaving(true);
    setSettingsErrorMessage(undefined);

    try {
      const savedSettings = await window.api.updateSettings(nextSettings);
      setSettings(savedSettings);
      setGraphLimitByTab({});
      setIsSettingsOpen(false);
    } catch (error) {
      setSettingsErrorMessage(error instanceof Error ? error.message : 'Unable to save settings.');
    } finally {
      setIsSettingsSaving(false);
    }
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

  function handleOpenWipChanges(): void {
    if (!activeTab) {
      return;
    }

    void selectFile(activeTab.id, undefined);
    void selectCommit(activeTab.id, 'wip');
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

  function openCommandDialog(dialog: Omit<CommandDialogConfig, 'id'>): void {
    setCommandDialog({
      ...dialog,
      id: createLogId()
    });
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

  function handleOpenTerminal(): void {
    void runRepositoryOperation('Open Terminal', (repoPath) => window.api.openTerminal(repoPath));
  }

  function handleDiscardWipFile(file: GitFileChangeDetail): void {
    openCommandDialog({
      title: 'Discard file changes',
      description: `Discard all staged and unstaged changes for ${file.path}.`,
      detail: file.status === 'untracked'
        ? 'This deletes the untracked file from disk.'
        : 'This restores the path from HEAD and removes any new worktree file left by an add, copy, or rename.',
      confirmLabel: 'Discard',
      tone: 'danger',
      fields: [],
      onSubmit() {
        void runRepositoryOperation(`Discard ${file.path}`, (repoPath) => window.api.discardFile(repoPath, file.path));
      }
    });
  }

  function handleOpenWipFile(file: GitFileChangeDetail): void {
    void runRepositoryOperation(`Open ${file.path}`, (repoPath) => window.api.openFile(repoPath, file.path));
  }

  function handleRevealWipFile(file: GitFileChangeDetail): void {
    void runRepositoryOperation(`Reveal ${file.path}`, (repoPath) => window.api.revealFile(repoPath, file.path));
  }

  function handleCreateBranch(startPoint?: string): void {
    openCommandDialog({
      title: startPoint ? 'Create branch here' : 'Create branch',
      description: startPoint
        ? `Create a local branch at ${startPoint.slice(0, 8)}.`
        : 'Create a local branch from the current HEAD.',
      confirmLabel: 'Create Branch',
      fields: [
        {
          id: 'name',
          kind: 'text',
          label: 'Branch name',
          value: '',
          placeholder: 'feature/my-branch',
          required: true,
          autoFocus: true
        },
        {
          id: 'checkout',
          kind: 'checkbox',
          label: 'Check out after creating',
          checked: true
        }
      ],
      onSubmit(values) {
        const name = dialogText(values, 'name');

        if (!name) {
          return;
        }

        void runRepositoryOperation(`Create branch ${name}`, (repoPath) =>
          window.api.createBranch(repoPath, {
            name,
            startPoint,
            checkout: dialogChecked(values, 'checkout')
          })
        );
      }
    });
  }

  function handleStashPush(): void {
    openCommandDialog({
      title: 'Stash changes',
      description: 'Save the current working tree as a stash node in the graph.',
      confirmLabel: 'Stash',
      fields: [
        {
          id: 'message',
          kind: 'text',
          label: 'Stash message',
          value: repositoryQuery.data?.status.branch.head ?? 'WIP',
          autoFocus: true
        },
        {
          id: 'includeUntracked',
          kind: 'checkbox',
          label: 'Include untracked files',
          checked: false
        }
      ],
      onSubmit(values) {
        void runRepositoryOperation('Stash changes', (repoPath) =>
          window.api.stashPush(repoPath, {
            message: values.text.message,
            includeUntracked: dialogChecked(values, 'includeUntracked')
          })
        );
      }
    });
  }

  function handleStashApply(selector: string): void {
    openCommandDialog({
      title: `Apply ${selector}`,
      description: 'Apply this stash without removing it from the stash list.',
      confirmLabel: 'Apply Stash',
      fields: [],
      onSubmit() {
        void runRepositoryOperation(`Apply ${selector}`, (repoPath) => window.api.stashApply(repoPath, { selector }));
      }
    });
  }

  function handleStashPop(selector?: string): void {
    const stashSelector = selector ?? repositoryQuery.data?.stashes[0]?.selector;

    if (!stashSelector) {
      return;
    }

    openCommandDialog({
      title: `Pop ${stashSelector}`,
      description: 'Apply this stash and remove it if the operation succeeds.',
      confirmLabel: 'Pop Stash',
      fields: [],
      onSubmit() {
        void runRepositoryOperation(`Pop ${stashSelector}`, (repoPath) => window.api.stashPop(repoPath, { selector: stashSelector }));
      }
    });
  }

  function handleStashDrop(selector: string): void {
    openCommandDialog({
      title: `Drop ${selector}`,
      description: 'This removes the stash entry from Git.',
      detail: 'Dropped stashes are not recoverable from this app.',
      confirmLabel: 'Drop Stash',
      tone: 'danger',
      fields: [],
      onSubmit() {
        void runRepositoryOperation(`Drop ${selector}`, (repoPath) => window.api.stashDrop(repoPath, { selector }));
      }
    });
  }

  function handleCheckoutBranch(name: string): void {
    void runRepositoryOperation(`Checkout ${name}`, (repoPath) => window.api.checkoutRef(repoPath, { kind: 'local', name }));
  }

  function handleCheckoutRemoteBranch(name: string): void {
    openCommandDialog({
      title: 'Checkout remote branch',
      description: `Create a local tracking branch from ${name}.`,
      confirmLabel: 'Checkout',
      fields: [
        {
          id: 'localName',
          kind: 'text',
          label: 'Local branch name',
          value: defaultLocalNameForRemoteBranch(name),
          required: true,
          autoFocus: true
        }
      ],
      onSubmit(values) {
        const localName = dialogText(values, 'localName');

        if (!localName) {
          return;
        }

        void runRepositoryOperation(`Checkout ${localName}`, (repoPath) =>
          window.api.checkoutRef(repoPath, {
            kind: 'remote',
            name,
            localName
          })
        );
      }
    });
  }

  function handleCheckoutCommit(sha: string): void {
    openCommandDialog({
      title: 'Checkout commit',
      description: `Checkout ${sha.slice(0, 8)} in detached HEAD.`,
      confirmLabel: 'Checkout',
      fields: [],
      onSubmit() {
        void runRepositoryOperation(`Checkout ${sha.slice(0, 8)}`, (repoPath) => window.api.checkoutRef(repoPath, { kind: 'commit', sha }));
      }
    });
  }

  function handleRenameBranch(name: string): void {
    openCommandDialog({
      title: 'Rename branch',
      description: `Rename ${name}.`,
      confirmLabel: 'Rename',
      fields: [
        {
          id: 'newName',
          kind: 'text',
          label: 'New branch name',
          value: name,
          required: true,
          autoFocus: true
        }
      ],
      onSubmit(values) {
        const newName = dialogText(values, 'newName');

        if (!newName || newName === name) {
          return;
        }

        void runRepositoryOperation(`Rename ${name}`, (repoPath) => window.api.renameBranch(repoPath, { oldName: name, newName }));
      }
    });
  }

  function handleDeleteBranch(name: string): void {
    openCommandDialog({
      title: 'Delete branch',
      description: `Delete ${name}.`,
      detail: 'Use force only when you intentionally want to delete an unmerged branch.',
      confirmLabel: 'Delete Branch',
      tone: 'danger',
      fields: [
        {
          id: 'force',
          kind: 'checkbox',
          label: 'Force delete if not merged',
          checked: false
        }
      ],
      onSubmit(values) {
        void runRepositoryOperation(`Delete ${name}`, (repoPath) => window.api.deleteBranch(repoPath, { name, force: dialogChecked(values, 'force') }));
      }
    });
  }

  function handleCreateTagAtCommit(sha: string): void {
    openCommandDialog({
      title: 'Create tag',
      description: `Create a tag at ${sha.slice(0, 8)}.`,
      confirmLabel: 'Create Tag',
      fields: [
        {
          id: 'name',
          kind: 'text',
          label: 'Tag name',
          value: '',
          placeholder: 'v1.0.0',
          required: true,
          autoFocus: true
        }
      ],
      onSubmit(values) {
        const name = dialogText(values, 'name');

        if (!name) {
          return;
        }

        void runRepositoryOperation(`Create tag ${name}`, (repoPath) =>
          window.api.createTag(repoPath, {
            name,
            targetSha: sha
          })
        );
      }
    });
  }

  function handleDeleteTag(name: string): void {
    openCommandDialog({
      title: 'Delete tag',
      description: `Delete tag ${name}.`,
      confirmLabel: 'Delete Tag',
      tone: 'danger',
      fields: [],
      onSubmit() {
        void runRepositoryOperation(`Delete tag ${name}`, (repoPath) => window.api.deleteTag(repoPath, { name }));
      }
    });
  }

  function handleMergeCommit(sha: string): void {
    openCommandDialog({
      title: 'Merge into current branch',
      description: `Merge ${sha.slice(0, 8)} into the checked-out branch.`,
      confirmLabel: 'Merge',
      fields: [],
      onSubmit() {
        void runRepositoryOperation(`Merge ${sha.slice(0, 8)}`, (repoPath) => window.api.mergeRef(repoPath, { ref: sha }));
      }
    });
  }

  function handleCherryPickCommit(sha: string): void {
    openCommandDialog({
      title: 'Cherry-pick commit',
      description: `Apply ${sha.slice(0, 8)} onto the current branch.`,
      confirmLabel: 'Cherry-pick',
      fields: [],
      onSubmit() {
        void runRepositoryOperation(`Cherry-pick ${sha.slice(0, 8)}`, (repoPath) => window.api.cherryPick(repoPath, sha));
      }
    });
  }

  function handleRevertCommit(sha: string): void {
    openCommandDialog({
      title: 'Revert commit',
      description: `Create a new commit that reverts ${sha.slice(0, 8)}.`,
      confirmLabel: 'Revert',
      fields: [],
      onSubmit() {
        void runRepositoryOperation(`Revert ${sha.slice(0, 8)}`, (repoPath) => window.api.revertCommit(repoPath, sha));
      }
    });
  }

  function handleResetToCommit(sha: string): void {
    openCommandDialog({
      title: 'Reset current branch',
      description: `Move the current branch to ${sha.slice(0, 8)}.`,
      detail: 'Hard reset overwrites tracked working tree changes. Use it only when you intend to discard local file contents.',
      confirmLabel: 'Reset',
      tone: 'danger',
      fields: [
        {
          id: 'mode',
          kind: 'select',
          label: 'Reset mode',
          value: 'mixed',
          options: [
            { value: 'soft', label: 'Soft', description: 'Move HEAD only; keep index and working tree.' },
            { value: 'mixed', label: 'Mixed', description: 'Move HEAD and reset index; keep working tree.' },
            { value: 'hard', label: 'Hard', description: 'Move HEAD, index, and tracked working tree files.' }
          ]
        }
      ],
      onSubmit(values) {
        const resetMode = normalizeResetMode(values.text.mode);

        if (!resetMode) {
          return;
        }

        void runRepositoryOperation(`Reset ${resetMode} to ${sha.slice(0, 8)}`, (repoPath) =>
          window.api.resetToCommit(repoPath, {
            target: sha,
            mode: resetMode
          })
        );
      }
    });
  }

  function handleRebaseOntoCommit(sha: string): void {
    openCommandDialog({
      title: 'Rebase current branch',
      description: `Replay the current branch onto ${sha.slice(0, 8)}.`,
      confirmLabel: 'Rebase',
      fields: [],
      onSubmit() {
        void runRepositoryOperation(`Rebase onto ${sha.slice(0, 8)}`, (repoPath) => window.api.rebaseOnto(repoPath, { target: sha }));
      }
    });
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

    if (undoEntry.requiresConfirmation) {
      openCommandDialog({
        title: undoEntry.label,
        description: 'Restore the recorded local state for this operation.',
        confirmLabel: 'Undo',
        tone: 'danger',
        fields: [],
        onSubmit() {
          void runRepositoryOperation(undoEntry.label, (repoPath) => window.api.undoOperation(repoPath, undoEntry.id));
        }
      });
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
        onOpenSettings={() => setIsSettingsOpen(true)}
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
        onOpenTerminal={handleOpenTerminal}
        onOpenQuickJump={() => setIsQuickJumpOpen(true)}
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
          interactiveRebaseDialog ? (
            <InteractiveRebaseDialog
              plan={interactiveRebaseDialog.plan}
              isLoading={interactiveRebaseDialog.isLoading}
              isRunning={interactiveRebaseDialog.isRunning}
              errorMessage={interactiveRebaseDialog.errorMessage}
              onClose={() => setInteractiveRebaseDialog(undefined)}
              onRun={handleRunInteractiveRebase}
            />
          ) : (
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
                onStashApply={handleStashApply}
                onStashPop={handleStashPop}
                onStashDrop={handleStashDrop}
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
                  largeRepoMode={settings.largeRepoMode}
                />
              )}
              <CommitDetailPanel
                repoPath={activeTab.path}
                row={selectedRow}
                parentSha={parentSha}
                selectedFile={activeTab.selectedFile}
                wipDirtyCount={repositoryQuery.data?.status.dirtyCount}
                profileState={repositoryQuery.data?.profileState}
                commitFocusSignal={commitComposerFocusByTab[activeTab.id] ?? 0}
                isOperationBusy={isOperationBusy}
                onSelectFile={(path) => void selectFile(activeTab.id, path)}
                onOpenWipChanges={handleOpenWipChanges}
                onDiscardWipFile={handleDiscardWipFile}
                onOpenWipFile={handleOpenWipFile}
                onRevealWipFile={handleRevealWipFile}
              />
            </>
          )
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
      {isQuickJumpOpen ? (
        <QuickJumpDialog
          tabs={workspace.tabs}
          activeTabId={workspace.activeTabId}
          repositoryOverview={repositoryQuery.data}
          onClose={() => setIsQuickJumpOpen(false)}
          onActivateTab={(tabId) => void activateTab(tabId)}
          onCheckoutBranch={handleCheckoutBranch}
          onCheckoutRemoteBranch={handleCheckoutRemoteBranch}
        />
      ) : null}
      {isSettingsOpen ? (
        <SettingsPanel
          settings={settings}
          isSaving={isSettingsSaving}
          errorMessage={settingsErrorMessage}
          onClose={() => setIsSettingsOpen(false)}
          onSave={handleSaveSettings}
        />
      ) : null}
      {commandDialog ? <CommandDialog key={commandDialog.id} dialog={commandDialog} onClose={() => setCommandDialog(undefined)} /> : null}
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

function dialogText(values: CommandDialogValues, id: string): string {
  return values.text[id]?.trim() ?? '';
}

function dialogChecked(values: CommandDialogValues, id: string): boolean {
  return values.checked[id] ?? false;
}

function normalizeResetMode(value: string | null | undefined): GitResetInput['mode'] | undefined {
  const normalized = value?.trim().toLowerCase();

  if (normalized === 'soft' || normalized === 'mixed' || normalized === 'hard') {
    return normalized;
  }

  return undefined;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
