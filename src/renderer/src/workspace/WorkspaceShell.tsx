import type { ReactElement } from 'react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  FileClock,
  GitBranch,
  GitCompareArrows,
  Keyboard,
  PanelLeftClose,
  PanelRightClose,
  RefreshCw,
  Rows3,
  SearchCode,
  Settings,
  Tag,
  Terminal,
  Trash2,
  Workflow,
  X
} from 'lucide-react';
import { useIsMutating, useQueryClient } from '@tanstack/react-query';

import { CommitDetailPanel } from '@renderer/components/commit/CommitDetailPanel';
import type { DiffStyle, WipDiffScope } from '@renderer/components/commit/fileDetailUtils';
import { GraphView } from '@renderer/components/graph/GraphView';
import {
  RepositoryInspectorDialog,
  type RepositoryInspectorMode
} from '@renderer/components/inspection/RepositoryInspectorDialog';
import { CommandDialog, type CommandDialogConfig, type CommandDialogValues } from '@renderer/components/operations/CommandDialog';
import { ConflictBanner } from '@renderer/components/operations/ConflictBanner';
import { OperationLog, type OperationLogEntry } from '@renderer/components/operations/OperationLog';
import {
  applyOperationFailure,
  applyOperationProgress,
  createOptimisticOperationEntry
} from '@renderer/components/operations/operationProgress';
import { QuickJumpDialog, type PaletteAction } from '@renderer/components/operations/QuickJumpDialog';
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
import { resolveSelectedGraphRow } from '@renderer/workspace/selection';
import { COMMIT_GRAPH_LIMIT_STEP } from '@shared/graph';
import type {
  CommitGraphRow,
  GitConflictActionInput,
  GitFileChangeDetail,
  GitInteractiveRebaseInput,
  GitInteractiveRebasePlan,
  GitOperationResult,
  GitProfile,
  GitResetInput,
  GitStashRefInput,
  AppSettings
} from '@shared/types';
import { createDefaultAppSettings } from '@shared/settings';

const emptyGraphRows: CommitGraphRow[] = [];
const FileFocusView = lazy(async () => {
  const module = await import('@renderer/components/diff/FileFocusView');
  return { default: module.FileFocusView };
});

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
  onFocusSidebarFilter: () => void;
};

type RepositoryInspectorState = {
  mode: RepositoryInspectorMode;
  path?: string;
};

type RepositoryOperationOptions = {
  repoPath?: string;
  retryable?: boolean;
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
    setSidebarWidth,
    setDetailPanelCollapsed,
    setDetailPanelWidth,
    assignProfile,
    clearError
  } = useWorkspaceStore();
  const [graphLimitByTab, setGraphLimitByTab] = useState<Record<string, number>>({});
  const [diffStyleByTab, setDiffStyleByTab] = useState<Record<string, DiffStyle>>({});
  const [wipScopeByTab, setWipScopeByTab] = useState<Record<string, Record<string, WipDiffScope>>>({});
  const [commitComposerFocusByTab, setCommitComposerFocusByTab] = useState<Record<string, number>>({});
  const [fileFocusByTab, setFileFocusByTab] = useState<Record<string, number>>({});
  const [operationLogEntries, setOperationLogEntries] = useState<OperationLogEntry[]>([]);
  const [interactiveRebaseDialog, setInteractiveRebaseDialog] = useState<InteractiveRebaseDialogState>();
  const [commandDialog, setCommandDialog] = useState<CommandDialogConfig>();
  const [settings, setSettings] = useState<AppSettings>(createDefaultAppSettings());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSettingsSaving, setIsSettingsSaving] = useState(false);
  const [settingsErrorMessage, setSettingsErrorMessage] = useState<string>();
  const [isQuickJumpOpen, setIsQuickJumpOpen] = useState(false);
  const [repositoryInspector, setRepositoryInspector] = useState<RepositoryInspectorState>();
  const [sidebarWidth, setSidebarWidthDraft] = useState(workspace.sidebarWidth);
  const [detailPanelWidth, setDetailPanelWidthDraft] = useState(workspace.detailPanelWidth);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [compactSidebarOpen, setCompactSidebarOpen] = useState(false);
  const [compactDetailOpen, setCompactDetailOpen] = useState(false);
  const [sidebarFilterFocusSignal, setSidebarFilterFocusSignal] = useState(0);
  const operationRetryActionsRef = useRef(
    new Map<
      string,
      {
        label: string;
        action: (repoPath: string) => Promise<GitOperationResult>;
        repoPath: string;
        retryable: true;
      }
    >()
  );
  const operationStartGuardRef = useRef(false);
  const shortcutStateRef = useRef<ShortcutState>({
    isBlocked: false,
    onFetch: () => {},
    onPush: () => {},
    onToggleDiffStyle: () => {},
    onOpenQuickJump: () => {},
    onFocusSidebarFilter: () => {}
  });
  const queryClient = useQueryClient();
  const localMutationCount = useIsMutating();

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
  const graphRows = graphQuery.data?.rows ?? emptyGraphRows;
  const selectedSha = activeTab?.selectedCommit;
  const selectedRow = useMemo(
    () => resolveSelectedGraphRow(graphRows, selectedSha),
    [graphRows, selectedSha]
  );
  const parentSha = selectedRow?.parentShas[0];
  const activeDiffStyle = activeTab ? (diffStyleByTab[activeTab.id] ?? settings.defaultDiffStyle) : settings.defaultDiffStyle;
  const activeWipScopeByPath = activeTab ? (wipScopeByTab[activeTab.id] ?? {}) : {};
  const isOperationBusy =
    localMutationCount > 0 || operationLogEntries.some((entry) => entry.status === 'pending');
  const usesCompactDetail = viewportWidth < 900;
  const usesCompactSidebar = viewportWidth < 700;
  const sidebarWidthCap = viewportWidth < 900 ? 230 : viewportWidth < 1200 ? 280 : 560;
  const detailPanelWidthCap = viewportWidth < 1200 ? 320 : 620;
  const effectiveSidebarWidth = Math.min(sidebarWidth, sidebarWidthCap);
  const effectiveDetailPanelWidth = Math.min(detailPanelWidth, detailPanelWidthCap);
  const isDetailPanelCollapsed = workspace.detailPanelCollapsed || (usesCompactDetail && !compactDetailOpen);
  const isSidebarCollapsed =
    workspace.sidebarCollapsed ||
    (usesCompactSidebar && !compactSidebarOpen) ||
    (usesCompactDetail && compactDetailOpen);

  useRepositoryChangeInvalidation();

  useEffect(() => {
    void initialize();
  }, [initialize]);

  useEffect(() => {
    setSidebarWidthDraft(workspace.sidebarWidth);
  }, [workspace.sidebarWidth]);

  useEffect(() => {
    setDetailPanelWidthDraft(workspace.detailPanelWidth);
  }, [workspace.detailPanelWidth]);

  useEffect(() => {
    function handleResize(): void {
      setViewportWidth(window.innerWidth);
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    window.api
      .getSettings()
      .then(setSettings)
      .catch((error: unknown) => {
        setSettingsErrorMessage(error instanceof Error ? error.message : 'Unable to load settings.');
      });
  }, []);

  useEffect(() => {
    return window.api.onOperationProgress((event) => {
      setOperationLogEntries((entries) => applyOperationProgress(entries, event));
    });
  }, []);

  useEffect(() => {
    shortcutStateRef.current = {
      isBlocked: Boolean(
        commandDialog ||
          interactiveRebaseDialog ||
          isSettingsOpen ||
          isQuickJumpOpen ||
          repositoryInspector ||
          isOperationBusy
      ),
      onFetch: handleFetch,
      onPush: handlePush,
      onToggleDiffStyle: () => handleSetDiffStyle(activeDiffStyle === 'unified' ? 'split' : 'unified'),
      onOpenQuickJump: () => setIsQuickJumpOpen(true),
      onFocusSidebarFilter: handleFocusSidebarFilter
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

      if (event.altKey && !event.shiftKey && key === 'f') {
        event.preventDefault();
        shortcutState.onFocusSidebarFilter();
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

  const handleSidebarResize = useCallback(
    (width: number): void => {
      setSidebarWidthDraft(Math.min(width, sidebarWidthCap));
    },
    [sidebarWidthCap]
  );

  const handleSidebarResizeCommit = useCallback(
    (width: number): void => {
      void setSidebarWidth(Math.min(width, sidebarWidthCap));
    },
    [setSidebarWidth, sidebarWidthCap]
  );

  const handleDetailPanelResize = useCallback(
    (width: number): void => {
      setDetailPanelWidthDraft(Math.min(width, detailPanelWidthCap));
    },
    [detailPanelWidthCap]
  );

  const handleDetailPanelResizeCommit = useCallback(
    (width: number): void => {
      void setDetailPanelWidth(Math.min(width, detailPanelWidthCap));
    },
    [detailPanelWidthCap, setDetailPanelWidth]
  );

  function handleToggleSidebar(): void {
    if (usesCompactSidebar || compactDetailOpen) {
      if (workspace.sidebarCollapsed) {
        void setSidebarCollapsed(false);
      }

      setCompactSidebarOpen((value) => !value || compactDetailOpen);
      setCompactDetailOpen(false);
      return;
    }

    void setSidebarCollapsed(!workspace.sidebarCollapsed);
  }

  function handleFocusSidebarFilter(): void {
    if (workspace.sidebarCollapsed) {
      void setSidebarCollapsed(false);
    }

    setCompactDetailOpen(false);
    setCompactSidebarOpen(true);
    setSidebarFilterFocusSignal((value) => value + 1);
  }

  function handleToggleDetailPanel(): void {
    if (usesCompactDetail) {
      if (workspace.detailPanelCollapsed) {
        void setDetailPanelCollapsed(false);
      }

      setCompactDetailOpen((value) => !value);
      setCompactSidebarOpen(false);
      return;
    }

    void setDetailPanelCollapsed(!workspace.detailPanelCollapsed);
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

  function handleOpenConflictFile(path: string): void {
    if (!activeTab) {
      return;
    }

    const tabId = activeTab.id;
    setFileFocusByTab((value) => ({
      ...value,
      [tabId]: (value[tabId] ?? 0) + 1
    }));
    void (async () => {
      await selectCommit(tabId, 'wip');
      await selectFile(tabId, path);
    })();
  }

  function handleSelectFile(path: string | undefined): void {
    if (!activeTab) {
      return;
    }

    if (path) {
      setFileFocusByTab((value) => ({
        ...value,
        [activeTab.id]: (value[activeTab.id] ?? 0) + 1
      }));
    }

    void selectFile(activeTab.id, path);
  }

  async function runRepositoryOperation(
    label: string,
    action: (repoPath: string) => Promise<GitOperationResult>,
    options: RepositoryOperationOptions = {}
  ): Promise<boolean> {
    const requestedRepoPath = options.repoPath ?? activeTab?.path;
    const retryable = options.retryable ?? false;

    if (!requestedRepoPath || isOperationBusy || operationStartGuardRef.current) {
      return false;
    }

    operationStartGuardRef.current = true;
    const id = createLogId();
    const happenedAt = new Date().toISOString();
    if (retryable) {
      operationRetryActionsRef.current.set(id, { label, action, repoPath: requestedRepoPath, retryable: true });
    }
    setOperationLogEntries((entries) => [
      createOptimisticOperationEntry({
        id,
        repoPath: requestedRepoPath,
        label,
        happenedAt,
        retryable
      }),
      ...entries
    ]);

    try {
      const result = await action(requestedRepoPath);
      await invalidateRepositoryQueries(queryClient, result.repoPath, result.invalidates ?? []);

      const status = result.operation?.status === 'conflicted' || result.conflictState?.isActive ? 'conflict' : 'success';
      const detail = result.conflictState?.message ?? result.operation?.message;
      operationRetryActionsRef.current.delete(id);
      setOperationLogEntries((entries) =>
        entries.map((entry) =>
          entry.id === id
            ? {
                ...entry,
                label: result.operation?.label ?? label,
                status,
                canRetry: false,
                detail,
                happenedAt: result.happenedAt
              }
            : entry
        )
      );
      return true;
    } catch (error) {
      setOperationLogEntries((entries) =>
        applyOperationFailure(
          entries,
          id,
          error instanceof Error ? error.message : 'Git operation failed.',
          new Date().toISOString()
        )
      );
      return false;
    } finally {
      operationStartGuardRef.current = false;
    }
  }

  function handleDismissOperation(id: string): void {
    operationRetryActionsRef.current.delete(id);
    setOperationLogEntries((entries) => entries.filter((entry) => entry.id !== id));
  }

  async function handleCancelOperation(entry: OperationLogEntry): Promise<void> {
    if (!entry.operationId) {
      return;
    }

    const result = await window.api.cancelRepositoryOperation(entry.repoPath, entry.operationId);
    setOperationLogEntries((entries) =>
      entries.map((candidate) =>
        candidate.id === entry.id
          ? {
              ...candidate,
              detail: result.message,
              happenedAt: new Date().toISOString()
            }
          : candidate
      )
    );
  }

  function handleRetryOperation(entry: OperationLogEntry): void {
    const retry = operationRetryActionsRef.current.get(entry.id);
    operationRetryActionsRef.current.delete(entry.id);
    setOperationLogEntries((entries) => entries.filter((candidate) => candidate.id !== entry.id));

    if (retry) {
      void runRepositoryOperation(retry.label, retry.action, {
        repoPath: retry.repoPath,
        retryable: retry.retryable
      });
    }
  }

  function handleOpenTerminalFromLog(repoPath: string): void {
    void window.api.openTerminal(repoPath).catch((error: unknown) => {
      setOperationLogEntries((entries) => [
        {
          id: createLogId(),
          repoPath,
          label: 'Open Terminal',
          status: 'error',
          detail: error instanceof Error ? error.message : 'Unable to open Terminal.',
          startedAt: new Date().toISOString(),
          happenedAt: new Date().toISOString()
        },
        ...entries
      ]);
    });
  }

  function handleCopyOperationDetails(entry: OperationLogEntry): void {
    const detail = [entry.label, entry.status, entry.detail].filter(Boolean).join('\n');
    void navigator.clipboard.writeText(detail);
  }

  function openCommandDialog(dialog: Omit<CommandDialogConfig, 'id'>): void {
    setCommandDialog({
      ...dialog,
      id: createLogId()
    });
  }

  function handleFetch(): void {
    void runRepositoryOperation('Fetch', (repoPath) => window.api.fetchRepository(repoPath), {
      retryable: true
    });
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

  function handleDiscardAllWip(): void {
    openCommandDialog({
      title: 'Discard all changes',
      description: 'Permanently discard every staged and unstaged change in this repository.',
      detail: 'Tracked files will be restored to HEAD and untracked files and folders will be deleted. Ignored files are kept.',
      confirmLabel: 'Discard All',
      tone: 'danger',
      fields: [],
      onSubmit() {
        void runRepositoryOperation('Discard all changes', (repoPath) => window.api.discardAllChanges(repoPath));
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

  function handleStashApply(input: GitStashRefInput): void {
    const { selector } = input;
    openCommandDialog({
      title: `Apply ${selector}`,
      description: 'Apply this stash without removing it from the stash list.',
      confirmLabel: 'Apply Stash',
      fields: [],
      onSubmit() {
        void runRepositoryOperation(`Apply ${selector}`, (repoPath) => window.api.stashApply(repoPath, input));
      }
    });
  }

  function handleStashPop(input?: GitStashRefInput): void {
    const latestStash = repositoryQuery.data?.stashes[0];
    const stashInput = input ?? (latestStash ? { selector: latestStash.selector, expectedSha: latestStash.sha } : undefined);

    if (!stashInput) {
      return;
    }

    const { selector } = stashInput;

    openCommandDialog({
      title: `Pop ${selector}`,
      description: 'Apply this stash and remove it if the operation succeeds.',
      confirmLabel: 'Pop Stash',
      fields: [],
      onSubmit() {
        void runRepositoryOperation(`Pop ${selector}`, (repoPath) => window.api.stashPop(repoPath, stashInput));
      }
    });
  }

  function handleStashDrop(input: GitStashRefInput): void {
    const { selector } = input;
    openCommandDialog({
      title: `Drop ${selector}`,
      description: 'This removes the stash entry from Git.',
      detail: 'Dropped stashes are not recoverable from this app.',
      confirmLabel: 'Drop Stash',
      tone: 'danger',
      fields: [],
      onSubmit() {
        void runRepositoryOperation(`Drop ${selector}`, (repoPath) => window.api.stashDrop(repoPath, input));
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

  function handleMergeRef(ref: string, label: string): void {
    openCommandDialog({
      title: 'Merge into current branch',
      description: `Merge ${label} into the checked-out branch.`,
      confirmLabel: 'Merge',
      fields: [],
      onSubmit() {
        void runRepositoryOperation(`Merge ${label}`, (repoPath) => window.api.mergeRef(repoPath, { ref }));
      }
    });
  }

  function handleMergeCommit(sha: string): void {
    handleMergeRef(sha, sha.slice(0, 8));
  }

  function handleMergeBranch(name: string): void {
    handleMergeRef(name, name);
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

  function handleRebaseOntoRef(ref: string, label: string): void {
    openCommandDialog({
      title: 'Rebase current branch',
      description: `Replay the current branch onto ${label}.`,
      confirmLabel: 'Rebase',
      fields: [],
      onSubmit() {
        void runRepositoryOperation(`Rebase onto ${label}`, (repoPath) => window.api.rebaseOnto(repoPath, { target: ref }));
      }
    });
  }

  function handleRebaseOntoCommit(sha: string): void {
    handleRebaseOntoRef(sha, sha.slice(0, 8));
  }

  function handleRebaseOntoBranch(name: string): void {
    handleRebaseOntoRef(name, name);
  }

  function handleInteractiveRebase(base: string): void {
    if (!activeTab) {
      return;
    }

    setInteractiveRebaseDialog({
      base,
      isLoading: true,
      isRunning: false
    });

    window.api
      .getInteractiveRebasePlan(activeTab.path, base)
      .then((plan) => {
        setInteractiveRebaseDialog((state) =>
          state?.base === base
            ? {
                base,
                plan,
                isLoading: false,
                isRunning: false
              }
            : state
        );
      })
      .catch((error: unknown) => {
        setInteractiveRebaseDialog((state) =>
          state?.base === base
            ? {
                base,
                isLoading: false,
                isRunning: false,
                errorMessage: error instanceof Error ? error.message : 'Unable to prepare interactive rebase.'
              }
            : state
        );
      });
  }

  function handleInteractiveRebaseFromCommit(sha: string): void {
    handleInteractiveRebase(sha);
  }

  function handleInteractiveRebaseOntoBranch(name: string): void {
    handleInteractiveRebase(name);
  }

  async function handleRunInteractiveRebase(input: GitInteractiveRebaseInput): Promise<void> {
    setInteractiveRebaseDialog((state) => (state ? { ...state, isRunning: true, errorMessage: undefined } : state));
    const completed = await runRepositoryOperation(`Interactive rebase onto ${input.base.slice(0, 8)}`, (repoPath) =>
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
        description: undoEntry.warning ?? 'Restore the recorded local state for this operation.',
        detail: formatUndoScope(undoEntry.affectedRefs, undoEntry.affectedPaths),
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

  const paletteActions: PaletteAction[] = [
    {
      id: 'fetch',
      label: 'Fetch all remotes',
      category: 'Git',
      detail: 'Prune and refresh remote references',
      keywords: ['refresh', 'remote', 'network'],
      icon: <RefreshCw size={14} />,
      disabled: !activeTab || isOperationBusy,
      disabledReason: !activeTab ? 'Open a repository first' : isOperationBusy ? 'A Git operation is running' : undefined,
      onSelect: handleFetch
    },
    {
      id: 'pull',
      label: 'Pull fast-forward',
      category: 'Git',
      detail: 'Update the current branch without a merge commit',
      keywords: ['download', 'remote', 'sync'],
      icon: <ArrowDown size={14} />,
      disabled: !activeTab || isOperationBusy,
      disabledReason: !activeTab ? 'Open a repository first' : isOperationBusy ? 'A Git operation is running' : undefined,
      onSelect: handlePull
    },
    {
      id: 'push',
      label: 'Push current branch',
      category: 'Git',
      detail: 'Publish local commits to the configured remote',
      keywords: ['upload', 'remote', 'sync'],
      icon: <ArrowUp size={14} />,
      disabled: !activeTab || isOperationBusy,
      disabledReason: !activeTab ? 'Open a repository first' : isOperationBusy ? 'A Git operation is running' : undefined,
      onSelect: handlePush
    },
    {
      id: 'create-branch',
      label: 'Create branch',
      category: 'Git',
      keywords: ['checkout', 'new branch'],
      icon: <GitBranch size={14} />,
      disabled: !activeTab || isOperationBusy,
      disabledReason: !activeTab ? 'Open a repository first' : isOperationBusy ? 'A Git operation is running' : undefined,
      onSelect: () => handleCreateBranch()
    },
    {
      id: 'stash',
      label: 'Stash working changes',
      category: 'Git',
      keywords: ['save', 'working directory'],
      icon: <Archive size={14} />,
      disabled: !activeTab || isOperationBusy || !(repositoryQuery.data?.status.isDirty ?? false),
      disabledReason: !activeTab
        ? 'Open a repository first'
        : isOperationBusy
          ? 'A Git operation is running'
          : repositoryQuery.data?.status.isDirty
            ? undefined
            : 'The working directory is clean',
      onSelect: handleStashPush
    },
    {
      id: 'rebase-selected',
      label: 'Rebase current branch onto selected commit',
      category: 'Git',
      detail: selectedRow ? selectedRow.subject : 'Select a commit in the graph',
      keywords: ['rebase', 'branch', 'history'],
      icon: <Workflow size={14} />,
      disabled: !selectedRow || selectedRow.node.kind === 'wip' || selectedRow.node.kind === 'stash' || isOperationBusy,
      disabledReason: !selectedRow ? 'Select a commit first' : isOperationBusy ? 'A Git operation is running' : undefined,
      onSelect: () => selectedRow && handleRebaseOntoCommit(selectedRow.sha)
    },
    {
      id: 'interactive-rebase-selected',
      label: 'Interactive rebase from selected commit',
      category: 'Git',
      detail: 'Reorder, reword, squash, fixup, or drop commits',
      keywords: ['rebase', 'squash', 'fixup', 'reword', 'drop', 'history'],
      icon: <Workflow size={14} />,
      disabled: !selectedRow || selectedRow.node.kind === 'wip' || selectedRow.node.kind === 'stash' || isOperationBusy,
      disabledReason: !selectedRow ? 'Select a base commit first' : isOperationBusy ? 'A Git operation is running' : undefined,
      onSelect: () => selectedRow && handleInteractiveRebaseFromCommit(selectedRow.sha)
    },
    {
      id: 'tag-selected',
      label: 'Tag selected commit',
      category: 'Git',
      detail: selectedRow ? selectedRow.sha.slice(0, 8) : 'Select a commit in the graph',
      keywords: ['tag', 'release', 'annotated'],
      icon: <Tag size={14} />,
      disabled: !selectedRow || selectedRow.node.kind === 'wip' || selectedRow.node.kind === 'stash' || isOperationBusy,
      disabledReason: !selectedRow ? 'Select a commit first' : isOperationBusy ? 'A Git operation is running' : undefined,
      onSelect: () => selectedRow && handleCreateTagAtCommit(selectedRow.sha)
    },
    {
      id: 'file-history',
      label: 'Inspect file history',
      category: 'Inspect',
      detail: activeTab?.selectedFile ?? 'Enter a repository-relative path',
      keywords: ['log', 'commits', 'path'],
      icon: <FileClock size={14} />,
      disabled: !activeTab,
      disabledReason: activeTab ? undefined : 'Open a repository first',
      onSelect: () => setRepositoryInspector({ mode: 'history', path: activeTab?.selectedFile })
    },
    {
      id: 'blame',
      label: 'Blame file',
      category: 'Inspect',
      detail: activeTab?.selectedFile ?? 'Enter a repository-relative path',
      keywords: ['authors', 'lines', 'attribution'],
      icon: <SearchCode size={14} />,
      disabled: !activeTab,
      disabledReason: activeTab ? undefined : 'Open a repository first',
      onSelect: () => setRepositoryInspector({ mode: 'blame', path: activeTab?.selectedFile })
    },
    {
      id: 'compare',
      label: 'Compare references',
      category: 'Inspect',
      detail: 'Ahead, behind, stats, and changed files',
      keywords: ['branches', 'tags', 'diff'],
      icon: <GitCompareArrows size={14} />,
      disabled: !activeTab,
      disabledReason: activeTab ? undefined : 'Open a repository first',
      onSelect: () => setRepositoryInspector({ mode: 'compare' })
    },
    {
      id: 'terminal',
      label: 'Open Terminal here',
      category: 'Workspace',
      keywords: ['shell', 'command line'],
      icon: <Terminal size={14} />,
      disabled: !activeTab,
      disabledReason: activeTab ? undefined : 'Open a repository first',
      onSelect: handleOpenTerminal
    },
    {
      id: 'toggle-sidebar',
      label: isSidebarCollapsed ? 'Expand repository sidebar' : 'Collapse repository sidebar',
      category: 'View',
      icon: <PanelLeftClose size={14} />,
      onSelect: handleToggleSidebar
    },
    {
      id: 'toggle-details',
      label: isDetailPanelCollapsed ? 'Expand commit details' : 'Collapse commit details',
      category: 'View',
      icon: <PanelRightClose size={14} />,
      onSelect: handleToggleDetailPanel
    },
    {
      id: 'settings',
      label: 'Open settings',
      category: 'Workspace',
      keywords: ['preferences', 'graph columns', 'avatars'],
      icon: <Settings size={14} />,
      onSelect: () => setIsSettingsOpen(true)
    },
    {
      id: 'toggle-diff-style',
      label: `Use ${activeDiffStyle === 'unified' ? 'split' : 'unified'} diffs`,
      category: 'View',
      keywords: ['diff layout', 'unified', 'split'],
      icon: <Rows3 size={14} />,
      disabled: !activeTab,
      disabledReason: activeTab ? undefined : 'Open a repository first',
      onSelect: () => handleSetDiffStyle(activeDiffStyle === 'unified' ? 'split' : 'unified')
    },
    {
      id: 'keyboard-shortcuts',
      label: 'Keyboard shortcuts',
      category: 'Help',
      keywords: ['keys', 'commands', 'help'],
      icon: <Keyboard size={14} />,
      onSelect: () =>
        openCommandDialog({
          title: 'Keyboard shortcuts',
          description: 'Navigate and run common actions without leaving the graph.',
          detail: [
            '⌘P  Command palette',
            '⌘⇧F  Fetch all remotes',
            '⌘⇧U  Push current branch',
            '⌘\\  Toggle diff layout',
            '⌘⌥F  Focus sidebar filter',
            '↑ / ↓  Select graph rows or files',
            'Shift F10  Open the selected context menu',
            'Esc  Close the current dialog or file view'
          ].join('\n'),
          confirmLabel: 'Done',
          fields: [],
          onSubmit() {}
        })
    },
    {
      id: 'clear-operation-log',
      label: 'Clear operation log',
      category: 'Workspace',
      keywords: ['logs', 'history', 'notifications'],
      icon: <Trash2 size={14} />,
      disabled: operationLogEntries.length === 0 || isOperationBusy,
      disabledReason: isOperationBusy ? 'Wait for the running operation' : 'The operation log is empty',
      onSelect: () => {
        operationRetryActionsRef.current.clear();
        setOperationLogEntries([]);
      }
    }
  ];

  return (
    <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-[var(--bg-app)] text-[var(--text-1)]">
      <TabStrip
        tabs={workspace.tabs}
        activeTabId={workspace.activeTabId}
        activeRepoPath={activeTab?.path}
        recentRepos={workspace.recentRepos}
        profileState={repositoryQuery.data?.profileState}
        activeRepoDirty={(repositoryQuery.data?.status.dirtyCount ?? 0) > 0}
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
        hasSelectedCommit={Boolean(selectedRow && selectedRow.node.kind !== 'wip' && selectedRow.node.kind !== 'stash')}
        onMergeSelected={() => selectedRow && handleMergeCommit(selectedRow.sha)}
        onRebaseSelected={() => selectedRow && handleRebaseOntoCommit(selectedRow.sha)}
        onInteractiveRebaseSelected={() => selectedRow && handleInteractiveRebaseFromCommit(selectedRow.sha)}
        onTagSelected={() => selectedRow && handleCreateTagAtCommit(selectedRow.sha)}
      />

      {errorMessage || repositoryError ? (
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-1.5 text-xs text-[var(--danger-text)]" role="alert">
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
        onSelectFile={handleOpenConflictFile}
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
                isCollapsed={isSidebarCollapsed}
                width={effectiveSidebarWidth}
                filterFocusSignal={sidebarFilterFocusSignal}
                onToggleCollapsed={handleToggleSidebar}
                onResize={handleSidebarResize}
                onResizeCommit={handleSidebarResizeCommit}
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
                <Suspense
                  fallback={
                    <section className="grid min-w-0 flex-1 place-items-center bg-[var(--bg-app)] text-xs text-[var(--text-3)]">
                      Loading diff viewer…
                    </section>
                  }
                >
                  <FileFocusView
                    repoPath={activeTab.path}
                    row={selectedRow}
                    selectedFile={activeTab.selectedFile}
                    diffStyle={activeDiffStyle}
                    wipScopeByPath={activeWipScopeByPath}
                    focusSignal={fileFocusByTab[activeTab.id] ?? 0}
                    onSetDiffStyle={handleSetDiffStyle}
                    onChangeWipScope={handleChangeWipScope}
                    onSelectFile={handleSelectFile}
                    onClose={() => handleSelectFile(undefined)}
                  />
                </Suspense>
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
                  onCheckoutBranch={handleCheckoutBranch}
                  onMergeBranch={handleMergeBranch}
                  onRebaseOntoBranch={handleRebaseOntoBranch}
                  onInteractiveRebaseOntoBranch={handleInteractiveRebaseOntoBranch}
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
                  columns={settings.graphColumns}
                  remoteAvatars={settings.remoteAvatars}
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
                width={effectiveDetailPanelWidth}
                isCollapsed={isDetailPanelCollapsed}
                remoteAvatars={settings.remoteAvatars}
                onToggleCollapsed={handleToggleDetailPanel}
                onResize={handleDetailPanelResize}
                onResizeCommit={handleDetailPanelResizeCommit}
                onSelectFile={handleSelectFile}
                onOpenWipChanges={handleOpenWipChanges}
                onDiscardAllWip={handleDiscardAllWip}
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
      <OperationLog
        entries={operationLogEntries}
        onDismiss={handleDismissOperation}
        onCancel={(entry) => void handleCancelOperation(entry)}
        onRetry={handleRetryOperation}
        onOpenTerminal={handleOpenTerminalFromLog}
        onCopyDetails={handleCopyOperationDetails}
      />
      {isQuickJumpOpen ? (
        <QuickJumpDialog
          tabs={workspace.tabs}
          activeTabId={workspace.activeTabId}
          repositoryOverview={repositoryQuery.data}
          graphRows={graphRows}
          paletteActions={paletteActions}
          isOperationBusy={isOperationBusy}
          onClose={() => setIsQuickJumpOpen(false)}
          onActivateTab={(tabId) => void activateTab(tabId)}
          onCheckoutBranch={handleCheckoutBranch}
          onCheckoutRemoteBranch={handleCheckoutRemoteBranch}
          onSelectCommit={handleSelectRow}
          onOpenRepositoryPath={(repoPath) => void openRepositoryAtPath(repoPath)}
        />
      ) : null}
      {repositoryInspector && activeTab ? (
        <RepositoryInspectorDialog
          repoPath={activeTab.path}
          initialMode={repositoryInspector.mode}
          initialPath={repositoryInspector.path}
          refs={repositoryQuery.data?.refs}
          onSelectCommit={(sha) => {
            handleSelectRow(sha);
            setRepositoryInspector(undefined);
          }}
          onClose={() => setRepositoryInspector(undefined)}
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

function formatUndoScope(refs: string[] | undefined, paths: string[] | undefined): string | undefined {
  const lines: string[] = [];

  if (refs?.length) {
    lines.push(`References: ${refs.join(', ')}`);
  }

  if (paths?.length) {
    lines.push(`Files: ${paths.join(', ')}`);
  }

  return lines.length > 0 ? lines.join('\n') : undefined;
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
