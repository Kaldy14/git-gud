import type { ReactElement } from 'react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Beaker,
  FileClock,
  FolderOpen,
  FolderX,
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
  Trash2,
  Workflow,
  X
} from 'lucide-react';
import { useWorkerPool } from '@pierre/diffs/react';
import { useIsMutating, useQueryClient } from '@tanstack/react-query';

import { CommitDetailPanel } from '@renderer/components/commit/CommitDetailPanel';
import type { DiffStyle, WipDiffScope } from '@renderer/components/commit/fileDetailUtils';
import type { ReviewViewState } from '@renderer/components/review/reviewViewState';
import { DashboardView } from '@renderer/components/dashboard/DashboardView';
import { applyDiffSyntaxTheme } from '@renderer/components/diff/diffTheme';
import { GraphView } from '@renderer/components/graph/GraphView';
import { branchNameFromRemoteRef } from '@renderer/lib/gitRefs';
import { suggestNextTagName } from '@renderer/lib/tagSuggestion';
import { PullRequestInboxView } from '@renderer/components/github/PullRequestInboxView';
import { PullRequestReviewView } from '@renderer/components/github/PullRequestReviewView';
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
import { PushRejectedBanner } from '@renderer/components/operations/PushRejectedBanner';
import { QuickJumpDialog, type PaletteAction } from '@renderer/components/operations/QuickJumpDialog';
import { InteractiveRebaseDialog } from '@renderer/components/rebase/InteractiveRebaseDialog';
import { SettingsPanel } from '@renderer/components/settings/SettingsPanel';
import { Sidebar } from '@renderer/components/sidebar/Sidebar';
import { StartPage } from '@renderer/components/start/StartPage';
import { StatusBar } from '@renderer/components/statusbar/StatusBar';
import { TabStrip } from '@renderer/components/tabs/TabStrip';
import { Toolbar } from '@renderer/components/toolbar/Toolbar';
import {
  clearRepositoryQueries,
  invalidateRepositoryQueries,
  prepareRepositoryForProfileTransition,
  repositoryOverviewQueryKey,
  useCommitGraph,
  useRepositoryChangeInvalidation,
  useRepositoryOverview
} from '@renderer/queries/repository';
import {
  dashboardsQueryKey,
  gitHubPullRequestDetailQueryOptions,
  gitHubPullRequestInboxQueryOptions,
  useDashboards,
  useGitHubPullRequestInbox
} from '@renderer/queries/github';
import {
  markDashboardActionAlertsRead,
  useDashboardActionAlerts,
  useDashboardActionsMonitor
} from '@renderer/queries/dashboardAlerts';
import { useWorkspaceStore } from '@renderer/state/workspace';
import { remoteBranchDeleteTarget, resolveRemoteBranchForLocalBranch } from '@renderer/workspace/branchDeletion';
import {
  commitSubjectsForShas,
  resolveSelectedGraphRow,
  syncWipGraphRow
} from '@renderer/workspace/selection';
import {
  resolveLocalBranchActivation,
  resolveRemoteBranchActivation
} from '@renderer/workspace/branchActivation';
import type { CheckoutTransition } from '@renderer/workspace/checkoutTransition';
import {
  autoFetchIntervalMilliseconds,
  autoFetchRepository,
  createRepositoryAutoFetchCoordinator
} from '@renderer/workspace/autoFetch';
import {
  indexPullRequestsByBranch,
  repositoryMatchesGitHubRepository,
  repositoryMatchesPullRequest
} from '@renderer/workspace/pullRequestBranches';
import {
  createPushPlan,
  createPushRejectionPrompt,
  isNonFastForwardPushError,
  type PushRejectionPrompt
} from '@renderer/workspace/pushRejection';
import { COMMIT_GRAPH_LIMIT_STEP } from '@shared/graph';
import { dashboardProfileId } from '@shared/dashboard';
import type { RepositoryCloneInput, RepositoryInitializeInput } from '@shared/ipc';
import type { PullRequestDeepLinkTarget } from '@shared/pullRequestDeepLink';
import type {
  AppSettings,
  CommitGraphRow,
  Dashboard,
  DashboardState,
  GitConflictActionInput,
  GitDeleteBranchInput,
  GitFileChangeDetail,
  GitInteractiveRebaseInput,
  GitInteractiveRebasePlan,
  GitOperationResult,
  GitHubPullRequestSummary,
  GitProfile,
  GitRepositoryOverview,
  GitRemoteBranchRef,
  GitReviewTarget,
  RepoTab,
  RepoProfileState,
  GitResetInput,
  GitStashRefInput,
  GitTagDeleteInput
} from '@shared/types';
import { createDefaultAppSettings } from '@shared/settings';
import { isRepositoryUnavailableError } from '@shared/repositoryAvailability';
import {
  appendPullRequestDeepLinkTarget,
  findPullRequestForDeepLink,
  profilesForPullRequestDeepLink,
  pullRequestDeepLinkTargetKey
} from '@renderer/workspace/pullRequestDeepLinkNavigation';

const emptyGraphRows: CommitGraphRow[] = [];
const emptySelectedShas: string[] = [];
const FileFocusView = lazy(async () => {
  const module = await import('@renderer/components/diff/FileFocusView');
  return { default: module.FileFocusView };
});
const ConflictResolver = lazy(async () => {
  const module = await import('@renderer/components/conflicts/ConflictResolver');
  return { default: module.ConflictResolver };
});
const ReviewView = lazy(async () => {
  const module = await import('@renderer/components/review/ReviewView');
  return { default: module.ReviewView };
});
const ReviewBenchmarkExplorer = import.meta.env.DEV
  ? lazy(async () => {
      const module = await import('@renderer/components/review/ReviewBenchmarkExplorer');
      return { default: module.ReviewBenchmarkExplorer };
    })
  : undefined;

type InteractiveRebaseDialogState = {
  base: string;
  initialSquashShas?: string[];
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
  onOpenCommitSearch: () => void;
  onFocusSidebarFilter: () => void;
};

type RepositoryInspectorState = {
  mode: RepositoryInspectorMode;
  path?: string;
};

type RepositoryOperationOptions = {
  repoPath?: string;
  retryable?: boolean;
  checkout?: Omit<CheckoutTransition, 'phase'>;
  onFailure?: (failure: { repoPath: string; message: string }) => void;
};

type RepositoryOperationRunner = (
  label: string,
  action: (repoPath: string) => Promise<GitOperationResult>,
  options?: RepositoryOperationOptions
) => Promise<boolean>;

type ActiveRepositoryOperation = {
  id: string;
  repoPath: string;
  label: string;
  phase: 'running' | 'refreshing';
  checkout?: Omit<CheckoutTransition, 'phase'>;
};

type ProfileTransitionIdentity = {
  label: string;
  color: string;
};

type ProfileTransitionState = {
  from: ProfileTransitionIdentity;
  to: ProfileTransitionIdentity;
  phase: 'loading' | 'revealing';
};

type GitHubWorkspaceView =
  | { kind: 'dashboard'; dashboardId?: string }
  | { kind: 'inbox' }
  | { kind: 'review'; pullRequest: GitHubPullRequestSummary };

const PROFILE_TRANSITION_MIN_MS = 240;
const PROFILE_TRANSITION_EXIT_MS = 180;

function DashboardActionsMonitor({
  dashboards,
  isDashboardVisible,
  profileId
}: {
  dashboards: Dashboard[];
  isDashboardVisible: boolean;
  profileId: string | undefined;
}): null {
  useDashboardActionsMonitor(profileId, dashboards, isDashboardVisible);
  return null;
}

export function WorkspaceShell(): ReactElement {
  const {
    workspace,
    isLoading,
    errorMessage,
    initialize,
    openRepository,
    openRepositoryAtPath,
    chooseRepositoryParentDirectory,
    initializeRepository,
    cloneRepository,
    replaceRepositoryAtPath,
    recoverMissingWorktree,
    activateTab,
    reorderTab,
    closeTab,
    selectCommit,
    selectFile,
    setSidebarCollapsed,
    setSidebarWidth,
    setDetailPanelCollapsed,
    setDetailPanelWidth,
    activateProfile,
    clearError
  } = useWorkspaceStore();
  const diffWorkerPool = useWorkerPool();
  const [graphLimitByTab, setGraphLimitByTab] = useState<Record<string, number>>({});
  const [bulkSelectionByTab, setBulkSelectionByTab] = useState<Record<string, string[]>>({});
  const [diffStyleByTab, setDiffStyleByTab] = useState<Record<string, DiffStyle>>({});
  const [wipScopeByTab, setWipScopeByTab] = useState<Record<string, Record<string, WipDiffScope>>>({});
  const [commitComposerFocusByTab, setCommitComposerFocusByTab] = useState<Record<string, number>>({});
  const [fileFocusByTab, setFileFocusByTab] = useState<Record<string, number>>({});
  const [reviewTargetByTab, setReviewTargetByTab] = useState<Partial<Record<string, GitReviewTarget>>>({});
  const reviewViewStateByTabRef = useRef<Partial<Record<string, ReviewViewState>>>({});
  const [operationLogEntries, setOperationLogEntries] = useState<OperationLogEntry[]>([]);
  const [activeRepositoryOperations, setActiveRepositoryOperations] = useState<
    Record<string, ActiveRepositoryOperation>
  >({});
  const [interactiveRebaseDialog, setInteractiveRebaseDialog] = useState<InteractiveRebaseDialogState>();
  const [commandDialog, setCommandDialog] = useState<CommandDialogConfig>();
  const [pushRejectionPrompt, setPushRejectionPrompt] = useState<PushRejectionPrompt>();
  const [settings, setSettings] = useState<AppSettings>(createDefaultAppSettings());
  const [hasLoadedSettings, setHasLoadedSettings] = useState(false);
  const [profiles, setProfiles] = useState<GitProfile[]>([]);
  const [hasLoadedProfiles, setHasLoadedProfiles] = useState(false);
  const [pullRequestDeepLinkQueue, setPullRequestDeepLinkQueue] = useState<
    PullRequestDeepLinkTarget[]
  >([]);
  const [pullRequestDeepLinkError, setPullRequestDeepLinkError] = useState<string>();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSettingsSaving, setIsSettingsSaving] = useState(false);
  const [settingsErrorMessage, setSettingsErrorMessage] = useState<string>();
  const [isQuickJumpOpen, setIsQuickJumpOpen] = useState(false);
  const [isCommitSearchOpen, setIsCommitSearchOpen] = useState(false);
  const [commitSearchFocusSignal, setCommitSearchFocusSignal] = useState(0);
  const [repositoryInspector, setRepositoryInspector] = useState<RepositoryInspectorState>();
  const [sidebarWidthDraft, setSidebarWidthDraft] = useState<number>();
  const [detailPanelWidthDraft, setDetailPanelWidthDraft] = useState<number>();
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [compactSidebarOpen, setCompactSidebarOpen] = useState(false);
  const [compactDetailOpen, setCompactDetailOpen] = useState(false);
  const [sidebarFilterFocusSignal, setSidebarFilterFocusSignal] = useState(0);
  const [profileTransition, setProfileTransition] = useState<ProfileTransitionState>();
  const [gitHubWorkspaceView, setGitHubWorkspaceView] = useState<GitHubWorkspaceView>();
  const [isStartTabOpen, setIsStartTabOpen] = useState(true);
  const [isStartTabActive, setIsStartTabActive] = useState(true);
  const [isReviewBenchmarkOpen, setIsReviewBenchmarkOpen] = useState(false);
  const [reviewBenchmarkDiffStyle, setReviewBenchmarkDiffStyle] =
    useState<DiffStyle>('unified');
  const [recoveringRepoPath, setRecoveringRepoPath] = useState<string>();
  const initialSurfaceResolvedRef = useRef(false);
  const recoveryAttemptsRef = useRef(new Set<string>());
  const autoFetchCoordinatorRef = useRef(
    createRepositoryAutoFetchCoordinator<Pick<RepoTab, 'commonDir' | 'path'>>()
  );
  const runRepositoryOperationRef = useRef<RepositoryOperationRunner | undefined>(undefined);
  const openingPullRequestDeepLinkRef = useRef<string | undefined>(undefined);
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
  const operationStartGuardRef = useRef(new Set<string>());
  const shortcutStateRef = useRef<ShortcutState>({
    isBlocked: false,
    onFetch: () => {},
    onPush: () => {},
    onToggleDiffStyle: () => {},
    onOpenQuickJump: () => {},
    onOpenCommitSearch: () => {},
    onFocusSidebarFilter: () => {}
  });
  const queryClient = useQueryClient();

  const workspaceActiveTab = useMemo(
    () => workspace.tabs.find((tab) => tab.id === workspace.activeTabId),
    [workspace.activeTabId, workspace.tabs]
  );
  const activeTab = isStartTabActive ? undefined : workspaceActiveTab;
  const autoFetchRepositoryPath = activeTab?.path;
  const autoFetchRepositoryCommonDir = activeTab?.commonDir;
  const localMutationCount = useIsMutating({ mutationKey: ['repository-mutation', activeTab?.path] });
  const graphLimit = activeTab ? (graphLimitByTab[activeTab.id] ?? settings.graphPageSize) : settings.graphPageSize;
  const relatedRepoPaths = useMemo(
    () =>
      activeTab
        ? workspace.tabs
            .filter((tab) => tab.commonDir === activeTab.commonDir)
            .map((tab) => tab.path)
        : [],
    [activeTab, workspace.tabs]
  );
  const repositoryQuery = useRepositoryOverview(activeTab?.path);
  const graphQuery = useCommitGraph(
    gitHubWorkspaceView ? undefined : activeTab?.path,
    graphLimit,
    relatedRepoPaths
  );
  const activeWorkspaceProfile = useMemo(
    () => profiles.find((profile) => profile.id === workspace.activeProfileId),
    [profiles, workspace.activeProfileId]
  );
  const workspaceProfileState = useMemo<RepoProfileState>(() => {
    const repositoryProfileState = repositoryQuery.data?.profileState;
    const activeProfile = activeWorkspaceProfile ?? repositoryProfileState?.activeProfile;

    return {
      profiles,
      activeProfile,
      suggestedProfile: repositoryProfileState?.suggestedProfile,
      effectiveIdentity:
        repositoryProfileState?.effectiveIdentity ??
        (activeProfile
          ? {
              name: activeProfile.name,
              email: activeProfile.email,
              source: 'profile'
            }
          : { source: 'unknown' }),
      identityMatchesActiveProfile: repositoryProfileState?.identityMatchesActiveProfile
    };
  }, [activeWorkspaceProfile, profiles, repositoryQuery.data?.profileState]);
  const activeGitHubProfile = workspaceProfileState.activeProfile;
  const connectedGitHubProfileId =
    activeGitHubProfile?.ghConfigDir && activeGitHubProfile.githubLogin
      ? activeGitHubProfile.id
      : undefined;
  const activeDashboardProfileId = dashboardProfileId(activeGitHubProfile);
  const pullRequestInboxQuery = useGitHubPullRequestInbox(
    connectedGitHubProfileId,
    gitHubWorkspaceView?.kind === 'inbox' ? 'interactive' : 'background-monitor'
  );
  const pullRequestsByBranch = useMemo(
    () =>
      indexPullRequestsByBranch(
        pullRequestInboxQuery.data?.pullRequests ?? [],
        {
          localBranches: repositoryQuery.data?.refs.localBranches ?? [],
          remoteBranches: repositoryQuery.data?.refs.remoteBranches ?? [],
          remotes: repositoryQuery.data?.remotes ?? []
        }
      ),
    [
      pullRequestInboxQuery.data?.pullRequests,
      repositoryQuery.data?.refs.localBranches,
      repositoryQuery.data?.refs.remoteBranches,
      repositoryQuery.data?.remotes
    ]
  );
  const pullRequestCodexRepoPath = useMemo(() => {
    if (gitHubWorkspaceView?.kind !== 'review') {
      return undefined;
    }

    const activeWorkspaceTab = workspace.tabs.find((tab) => tab.id === workspace.activeTabId);
    const candidateTabs = activeWorkspaceTab
      ? [
          activeWorkspaceTab,
          ...workspace.tabs.filter((tab) => tab.id !== activeWorkspaceTab.id)
        ]
      : workspace.tabs;

    return candidateTabs.find((tab) => {
      const overview =
        tab.path === activeTab?.path
          ? repositoryQuery.data
          : queryClient.getQueryData<GitRepositoryOverview>(
              repositoryOverviewQueryKey(tab.path)
            );
      return repositoryMatchesPullRequest(
        gitHubWorkspaceView.pullRequest,
        overview?.remotes ?? []
      );
    })?.path;
  }, [
    activeTab?.path,
    gitHubWorkspaceView,
    queryClient,
    repositoryQuery.data,
    workspace.activeTabId,
    workspace.tabs
  ]);
  const resolveDashboardRepositoryPath = useCallback(
    (repository: { host: string; owner: string; name: string }) => {
      const activeWorkspaceTab = workspace.tabs.find(
        (tab) => tab.id === workspace.activeTabId
      );
      const candidateTabs = activeWorkspaceTab
        ? [
            activeWorkspaceTab,
            ...workspace.tabs.filter((tab) => tab.id !== activeWorkspaceTab.id)
          ]
        : workspace.tabs;

      return candidateTabs.find((tab) => {
        const overview =
          tab.path === activeTab?.path
            ? repositoryQuery.data
            : queryClient.getQueryData<GitRepositoryOverview>(
                repositoryOverviewQueryKey(tab.path)
              );
        return repositoryMatchesGitHubRepository(
          repository,
          overview?.remotes ?? []
        );
      })?.path;
    },
    [
      activeTab?.path,
      queryClient,
      repositoryQuery.data,
      workspace.activeTabId,
      workspace.tabs
    ]
  );
  const chooseDashboardRepositoryPathForCodex = useCallback(async (
    repository: { host: string; owner: string; name: string }
  ) => {
    const openedWorkspace = await openRepository();
    const selectedTab = openedWorkspace?.tabs.find(
      (tab) => tab.id === openedWorkspace.activeTabId
    );

    if (!selectedTab) {
      return undefined;
    }

    const overview = await window.api.getRepositoryOverview(selectedTab.path);

    if (!repositoryMatchesGitHubRepository(repository, overview.remotes)) {
      throw new Error(
        `The selected repository is not ${repository.owner}/${repository.name}.`
      );
    }

    return selectedTab.path;
  }, [openRepository]);
  const dashboardsQuery = useDashboards(activeDashboardProfileId);
  const dashboardActionAlertsQuery = useDashboardActionAlerts(
    activeDashboardProfileId
  );
  const repositoryError =
    repositoryQuery.error instanceof Error ? repositoryQuery.error.message : undefined;
  const graphError = graphQuery.error instanceof Error ? graphQuery.error.message : undefined;
  const repositoryUnavailable =
    isRepositoryUnavailableError(repositoryQuery.error) ||
    isRepositoryUnavailableError(graphQuery.error);
  const shouldRecoverRepository = Boolean(
    repositoryUnavailable &&
      activeTab &&
      !recoveryAttemptsRef.current.has(activeTab.path)
  );
  const isRecoveringRepository =
    recoveringRepoPath === activeTab?.path || shouldRecoverRepository;
  const graphRows = useMemo(
    () => syncWipGraphRow(graphQuery.data?.rows ?? emptyGraphRows, repositoryQuery.data?.status),
    [graphQuery.data?.rows, repositoryQuery.data?.status]
  );
  const linkedWorktreeBranches = useMemo(
    () =>
      new Set(
        repositoryQuery.data?.worktrees.flatMap((worktree) =>
          !worktree.current && worktree.branch ? [worktree.branch] : []
        ) ?? []
      ),
    [repositoryQuery.data?.worktrees]
  );
  const tagPushRemote =
    repositoryQuery.data?.remotes.find((remote) => remote.name === 'origin')?.name ??
    repositoryQuery.data?.remotes[0]?.name;
  const suggestedTagName = suggestNextTagName(repositoryQuery.data?.refs.tags ?? []);
  const selectedSha = activeTab?.selectedCommit;
  const conflictedPaths = useMemo(
    () => repositoryQuery.data?.conflictState.files.map((file) => file.path) ?? [],
    [repositoryQuery.data?.conflictState.files]
  );
  const isSelectedFileConflicted = Boolean(activeTab?.selectedFile && conflictedPaths.includes(activeTab.selectedFile));
  const selectedRow = useMemo(
    () => resolveSelectedGraphRow(graphRows, selectedSha),
    [graphRows, selectedSha]
  );
  const activeBulkSelectedShas = activeTab
    ? (bulkSelectionByTab[activeTab.id] ?? emptySelectedShas)
    : emptySelectedShas;
  const selectedCommitShas = useMemo(() => {
    if (activeBulkSelectedShas.length < 2) {
      return [];
    }

    const selection = new Set(activeBulkSelectedShas);
    return graphRows
      .filter((row) => selection.has(row.sha) && row.node.kind !== 'wip' && row.node.kind !== 'stash')
      .map((row) => row.sha);
  }, [activeBulkSelectedShas, graphRows]);
  const parentSha = selectedRow?.parentShas[0];
  const activeDiffStyle = activeTab ? (diffStyleByTab[activeTab.id] ?? settings.defaultDiffStyle) : settings.defaultDiffStyle;
  const activeWipScopeByPath = activeTab ? (wipScopeByTab[activeTab.id] ?? {}) : {};
  const activeReviewTarget = activeTab ? reviewTargetByTab[activeTab.id] : undefined;
  const isReviewOpen = Boolean(activeReviewTarget);
  const pendingOperationForActiveRepo = operationLogEntries.find(
    (entry) => entry.repoPath === activeTab?.path && entry.status === 'pending'
  );
  const visibleActiveOperation: ActiveRepositoryOperation | undefined =
    activeTab && activeRepositoryOperations[activeTab.path]
      ? activeRepositoryOperations[activeTab.path]
      : pendingOperationForActiveRepo
        ? {
            id: pendingOperationForActiveRepo.id,
            repoPath: pendingOperationForActiveRepo.repoPath,
            label: pendingOperationForActiveRepo.label,
            phase: pendingOperationForActiveRepo.phase === 'refreshing' ? 'refreshing' : 'running'
          }
        : undefined;
  const checkoutTransition: CheckoutTransition | undefined = visibleActiveOperation?.checkout
    ? { ...visibleActiveOperation.checkout, phase: visibleActiveOperation.phase }
    : undefined;
  const isOperationBusy =
    localMutationCount > 0 ||
    Boolean(activeTab && activeRepositoryOperations[activeTab.path]) ||
    Boolean(pendingOperationForActiveRepo);
  const usesCompactDetail = viewportWidth < 900;
  const usesCompactSidebar = viewportWidth < 700;
  const sidebarWidthCap = viewportWidth < 900 ? 230 : viewportWidth < 1200 ? 280 : 560;
  const detailPanelWidthCap = viewportWidth < 1200 ? 320 : 620;
  const sidebarWidth = sidebarWidthDraft ?? workspace.sidebarWidth;
  const detailPanelWidth = detailPanelWidthDraft ?? workspace.detailPanelWidth;
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
    if (!repositoryUnavailable || !activeTab || recoveryAttemptsRef.current.has(activeTab.path)) {
      return;
    }

    const missingRepoPath = activeTab.path;
    recoveryAttemptsRef.current.add(missingRepoPath);
    setRecoveringRepoPath(missingRepoPath);

    void recoverMissingWorktree(activeTab.id)
      .then((recoveredWorkspace) => {
        if (recoveredWorkspace) {
          clearRepositoryQueries(queryClient, missingRepoPath);
        }
      })
      .finally(() => {
        setRecoveringRepoPath((currentPath) =>
          currentPath === missingRepoPath ? undefined : currentPath
        );
      });
  }, [activeTab, queryClient, recoverMissingWorktree, repositoryUnavailable]);

  useEffect(() => {
    if (
      activeTab &&
      !repositoryUnavailable &&
      (repositoryQuery.isSuccess || graphQuery.isSuccess)
    ) {
      recoveryAttemptsRef.current.delete(activeTab.path);
    }
  }, [activeTab, graphQuery.isSuccess, repositoryQuery.isSuccess, repositoryUnavailable]);

  useEffect(() => {
    if (isLoading || initialSurfaceResolvedRef.current) {
      return;
    }

    initialSurfaceResolvedRef.current = true;
    const shouldShowStartTab = workspace.tabs.length === 0;
    setIsStartTabOpen(shouldShowStartTab);
    setIsStartTabActive(shouldShowStartTab);
  }, [isLoading, workspace.tabs.length]);

  useEffect(() => {
    if (isLoading || !initialSurfaceResolvedRef.current || workspace.tabs.length > 0) {
      return;
    }

    setIsStartTabOpen(true);
    setIsStartTabActive(true);
  }, [isLoading, workspace.tabs.length]);

  useEffect(() => {
    function handleResize(): void {
      setViewportWidth(window.innerWidth);
    }

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!diffWorkerPool) {
      return;
    }

    void applyDiffSyntaxTheme(diffWorkerPool, settings.diffSyntaxTheme)
      .catch((error: unknown) => {
        console.error('Unable to apply the selected diff syntax theme.', error);
      });
  }, [diffWorkerPool, settings.diffSyntaxTheme]);

  useEffect(() => {
    window.api
      .getSettings()
      .then(setSettings)
      .catch((error: unknown) => {
        setSettingsErrorMessage(error instanceof Error ? error.message : 'Unable to load settings.');
      })
      .finally(() => setHasLoadedSettings(true));
  }, []);

  useEffect(() => {
    window.api
      .listProfiles()
      .then(setProfiles)
      .catch(() => setProfiles([]))
      .finally(() => setHasLoadedProfiles(true));
  }, []);

  useEffect(() => {
    let isActive = true;
    const enqueue = (target: PullRequestDeepLinkTarget): void => {
      if (!isActive) {
        return;
      }

      setPullRequestDeepLinkQueue((targets) =>
        appendPullRequestDeepLinkTarget(targets, target)
      );
    };
    const unsubscribe = window.api.onOpenPullRequestDeepLink(enqueue);

    void window.api
      .readyForPullRequestDeepLinks()
      .then((targets) => targets.forEach(enqueue))
      .catch(() => {
        if (isActive) {
          setPullRequestDeepLinkError(
            'Git Gud could not start listening for pull request links.'
          );
        }
      });

    return () => {
      isActive = false;
      unsubscribe();
    };
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
      onOpenCommitSearch: handleOpenCommitSearch,
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

      if (!event.altKey && !event.shiftKey && key === 'f') {
        event.preventDefault();
        shortcutState.onOpenCommitSearch();
        return;
      }

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
    if (!activeTab) {
      return;
    }

    const row = graphRows.find((candidate) => candidate.sha === sha);
    const linkedWorktreePath = row?.node.kind === 'wip' && !row.worktree?.current
      ? row.worktree?.path
      : undefined;

    if (!linkedWorktreePath || linkedWorktreePath === activeTab.path) {
      void selectCommit(activeTab.id, sha);
      return;
    }

    void activateLinkedWorktreeWip(linkedWorktreePath);
  }

  async function activateLinkedWorktreeWip(worktreePath: string): Promise<void> {
    if (!activeTab) {
      return;
    }

    const previousTab = activeTab;
    const nextWorkspace = previousTab.path === worktreePath
      ? workspace
      : await replaceRepositoryAtPath(previousTab.id, worktreePath);

    const worktreeTab = nextWorkspace?.tabs.find((tab) => tab.path === worktreePath);

    if (!worktreeTab) {
      return;
    }

    if (previousTab.id !== worktreeTab.id) {
      clearRepositoryQueries(queryClient, previousTab.path);
      setGraphLimitByTab((value) => moveRecordKey(value, previousTab.id, worktreeTab.id));
      setBulkSelectionByTab((value) => moveRecordKey(value, previousTab.id, worktreeTab.id, []));
      setDiffStyleByTab((value) => moveRecordKey(value, previousTab.id, worktreeTab.id));
      setWipScopeByTab((value) => moveRecordKey(value, previousTab.id, worktreeTab.id));
      setCommitComposerFocusByTab((value) => moveRecordKey(value, previousTab.id, worktreeTab.id));
      setFileFocusByTab((value) => moveRecordKey(value, previousTab.id, worktreeTab.id));
      setReviewTargetByTab((value) => {
        const next = withoutRecordKey(withoutRecordKey(value, previousTab.id), worktreeTab.id);
        return value[previousTab.id]
          ? { ...next, [worktreeTab.id]: { kind: 'wip', scope: 'all' } }
          : next;
      });
      delete reviewViewStateByTabRef.current[previousTab.id];
      delete reviewViewStateByTabRef.current[worktreeTab.id];
    }

    setBulkSelectionByTab((value) => ({ ...value, [worktreeTab.id]: [] }));
    await selectCommit(worktreeTab.id, 'wip');
    await selectFile(worktreeTab.id, undefined);
  }

  const handleBulkSelectionChange = useCallback((shas: string[]): void => {
    const tabId = activeTab?.id;

    if (!tabId) {
      return;
    }

    const nextSelection = shas.length > 1 ? shas : [];
    setBulkSelectionByTab((current) => {
      const currentSelection = current[tabId] ?? [];

      if (
        currentSelection.length === nextSelection.length &&
        currentSelection.every((sha, index) => sha === nextSelection[index])
      ) {
        return current;
      }

      return { ...current, [tabId]: nextSelection };
    });
  }, [activeTab?.id]);

  function handleOpenCommitSearch(): void {
    if (!activeTab) {
      return;
    }

    if (activeTab.selectedFile) {
      void selectFile(activeTab.id, undefined);
    }

    setIsCommitSearchOpen(true);
    setCommitSearchFocusSignal((value) => value + 1);
  }

  const handleSidebarResize = useCallback(
    (width: number): void => {
      setSidebarWidthDraft(Math.min(width, sidebarWidthCap));
    },
    [sidebarWidthCap]
  );

  const handleSidebarResizeCommit = useCallback(
    (width: number): void => {
      setSidebarWidthDraft(undefined);
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
      setDetailPanelWidthDraft(undefined);
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

  function handleOpenPullRequestInbox(): void {
    setGitHubWorkspaceView({ kind: 'inbox' });
    setCompactDetailOpen(false);
    setCompactSidebarOpen(false);
  }

  function handleViewPullRequest(pullRequest: GitHubPullRequestSummary): void {
    setGitHubWorkspaceView({ kind: 'review', pullRequest });
    setCompactDetailOpen(false);
    setCompactSidebarOpen(false);
  }

  async function handleOpenPullRequestCommit(sha: string): Promise<void> {
    const tab = workspace.tabs.find((candidate) => candidate.path === pullRequestCodexRepoPath);

    if (!tab) {
      return;
    }

    setBulkSelectionByTab((value) => ({ ...value, [tab.id]: [] }));
    setReviewTargetByTab((value) => withoutRecordKey(value, tab.id));
    delete reviewViewStateByTabRef.current[tab.id];
    setGitHubWorkspaceView(undefined);
    setIsStartTabActive(false);
    setCompactDetailOpen(false);
    setCompactSidebarOpen(false);

    if (workspace.activeTabId !== tab.id) {
      await activateTab(tab.id);
    }

    await selectFile(tab.id, undefined);
    await selectCommit(tab.id, sha);
  }

  function handleClosePullRequestWorkspace(): void {
    setGitHubWorkspaceView(undefined);
    setCompactDetailOpen(false);
    setCompactSidebarOpen(false);

    if (!workspace.activeTabId) {
      setIsStartTabOpen(true);
      setIsStartTabActive(true);
    }
  }

  function openDashboardSurface(dashboardId?: string): void {
    setIsStartTabActive(false);
    setGitHubWorkspaceView({ kind: 'dashboard', dashboardId });
    setCompactDetailOpen(false);
    setCompactSidebarOpen(false);
  }

  function handleActivateDashboardsTab(): void {
    openDashboardSurface(dashboardsQuery.data?.selectedDashboardId);
  }

  function handleSelectDashboard(dashboardId: string | undefined): void {
    openDashboardSurface(dashboardId);

    if (!dashboardId) {
      return;
    }

    queryClient.setQueryData(
      dashboardsQueryKey(activeDashboardProfileId),
      (current: DashboardState | undefined) =>
        current
          ? {
              ...current,
              selectedDashboardId: dashboardId
            }
          : current
    );
    void window.api
      .selectDashboard(activeDashboardProfileId, dashboardId)
      .then((state) =>
        queryClient.setQueryData(dashboardsQueryKey(activeDashboardProfileId), state)
      )
      .catch(() => {
        void queryClient.invalidateQueries({
          queryKey: dashboardsQueryKey(activeDashboardProfileId)
        });
      });
  }

  function handleMarkDashboardActionAlertsRead(alertIds: string[]): void {
    void markDashboardActionAlertsRead(
      queryClient,
      activeDashboardProfileId,
      alertIds
    );
  }

  function handleOpenGitProfileMenu(): void {
    document.querySelector<HTMLButtonElement>('[aria-label="Git profile menu"]')?.click();
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

  const handleActivateProfile = useCallback(async (
    profileId: string | undefined,
    targetProfile?: GitProfile
  ): Promise<void> => {
    const startedAt = window.performance.now();
    const nextProfile = targetProfile ?? profiles.find((profile) => profile.id === profileId);
    setProfileTransition({
      from: profileTransitionIdentity(activeWorkspaceProfile),
      to: profileTransitionIdentity(nextProfile),
      phase: 'loading'
    });

    try {
      const nextWorkspace = await activateProfile(profileId);

      if (!nextWorkspace) {
        return;
      }

      const connectedProfileId =
        nextProfile?.ghConfigDir && nextProfile.githubLogin ? nextProfile.id : undefined;
      setGitHubWorkspaceView((view) =>
        view?.kind === 'review' && view.pullRequest.profileId !== connectedProfileId
          ? { kind: 'inbox' }
          : view
      );
      setGraphLimitByTab({});
      setDiffStyleByTab({});
      setWipScopeByTab({});
      setCommitComposerFocusByTab({});
      setFileFocusByTab({});
      setReviewTargetByTab({});
      reviewViewStateByTabRef.current = {};

      const nextTab = nextWorkspace.tabs.find((tab) => tab.id === nextWorkspace.activeTabId);

      if (nextTab) {
        await prepareRepositoryForProfileTransition(queryClient, nextTab.path, settings.graphPageSize).catch(() => undefined);
      }
    } finally {
      const remainingMs = PROFILE_TRANSITION_MIN_MS - (window.performance.now() - startedAt);

      if (remainingMs > 0) {
        await delay(remainingMs);
      }

      setProfileTransition((transition) =>
        transition ? { ...transition, phase: 'revealing' } : transition
      );
      await delay(PROFILE_TRANSITION_EXIT_MS);
      setProfileTransition(undefined);
    }
  }, [
    activeWorkspaceProfile,
    activateProfile,
    profiles,
    queryClient,
    settings.graphPageSize
  ]);

  useEffect(() => {
    const target = pullRequestDeepLinkQueue[0];

    if (!target || !hasLoadedProfiles) {
      return;
    }

    const targetKey = pullRequestDeepLinkTargetKey(target);

    if (openingPullRequestDeepLinkRef.current === targetKey) {
      return;
    }

    openingPullRequestDeepLinkRef.current = targetKey;
    setPullRequestDeepLinkError(undefined);

    void (async () => {
      const matchingProfiles = profilesForPullRequestDeepLink(
        target,
        profiles,
        workspace.activeProfileId
      );

      if (matchingProfiles.length === 0) {
        throw new Error(`Connect a GitHub profile for ${target.host} first.`);
      }

      let match:
        | { profile: GitProfile; pullRequest: GitHubPullRequestSummary }
        | undefined;
      let lastProfileError: unknown;

      for (const profile of matchingProfiles) {
        let pullRequest: GitHubPullRequestSummary | undefined;

        try {
          const inbox = await queryClient.fetchQuery(
            gitHubPullRequestInboxQueryOptions(profile.id, 'interactive')
          );
          pullRequest = findPullRequestForDeepLink(target, inbox);
        } catch (error: unknown) {
          lastProfileError = error;
        }

        if (!pullRequest) {
          try {
            pullRequest = await queryClient.fetchQuery(
              gitHubPullRequestDetailQueryOptions({
                profileId: profile.id,
                owner: target.owner,
                repository: target.repository,
                number: target.number
              })
            );
          } catch (error: unknown) {
            // A different connected profile for this host may still have access.
            lastProfileError = error;
          }
        }

        if (pullRequest) {
          match = { profile, pullRequest };
          break;
        }
      }

      if (!match) {
        if (lastProfileError) {
          throw lastProfileError;
        }

        throw new Error(
          'This pull request is not accessible from any connected GitHub account.'
        );
      }

      if (workspace.activeProfileId !== match.profile.id) {
        await handleActivateProfile(match.profile.id, match.profile);
      }

      setIsStartTabActive(false);
      setGitHubWorkspaceView({ kind: 'review', pullRequest: match.pullRequest });
      setCompactDetailOpen(false);
      setCompactSidebarOpen(false);
    })()
      .catch((error: unknown) => {
        const message = error instanceof Error
          ? error.message
          : 'The pull request could not be opened.';

        setPullRequestDeepLinkError(
          `Could not open ${target.owner}/${target.repository}#${target.number}: ${message}`
        );
      })
      .finally(() => {
        openingPullRequestDeepLinkRef.current = undefined;
        setPullRequestDeepLinkQueue((targets) =>
          targets.filter(
            (candidate) => pullRequestDeepLinkTargetKey(candidate) !== targetKey
          )
        );
      });
  }, [
    handleActivateProfile,
    hasLoadedProfiles,
    profiles,
    pullRequestDeepLinkQueue,
    queryClient,
    workspace.activeProfileId
  ]);

  async function handleSaveAndActivateProfile(profile: GitProfile): Promise<void> {
    const nextProfiles = await window.api.saveProfile(profile);
    setProfiles(nextProfiles);
    await handleActivateProfile(
      profile.id,
      nextProfiles.find((candidate) => candidate.id === profile.id)
    );
  }

  function handleCloseTab(tabId: string): void {
    const tab = workspace.tabs.find((candidate) => candidate.id === tabId);
    void closeTab(tabId);

    if (!tab) {
      return;
    }

    clearRepositoryQueries(queryClient, tab.path);
    setGraphLimitByTab((value) => withoutRecordKey(value, tabId));
    setBulkSelectionByTab((value) => withoutRecordKey(value, tabId));
    setDiffStyleByTab((value) => withoutRecordKey(value, tabId));
    setWipScopeByTab((value) => withoutRecordKey(value, tabId));
    setCommitComposerFocusByTab((value) => withoutRecordKey(value, tabId));
    setFileFocusByTab((value) => withoutRecordKey(value, tabId));
    setReviewTargetByTab((value) => withoutRecordKey(value, tabId));
    delete reviewViewStateByTabRef.current[tabId];
  }

  function handleOpenStartTab(): void {
    setGitHubWorkspaceView(undefined);
    setIsStartTabOpen(true);
    setIsStartTabActive(true);
  }

  function handleActivateStartTab(): void {
    setGitHubWorkspaceView(undefined);
    setIsStartTabActive(true);
  }

  function handleCloseStartTab(): void {
    if (workspace.tabs.length === 0) {
      return;
    }

    setIsStartTabOpen(false);
    setIsStartTabActive(false);
  }

  async function handleActivateRepositoryTab(tabId: string): Promise<void> {
    setGitHubWorkspaceView(undefined);
    setIsStartTabActive(false);
    await activateTab(tabId);
  }

  function completeStartPageAction(): void {
    setIsStartTabOpen(false);
    setIsStartTabActive(false);
  }

  async function handleOpenRepositoryFromStart(): Promise<boolean> {
    const openedWorkspace = await openRepository();

    if (!openedWorkspace) {
      return false;
    }

    completeStartPageAction();
    return true;
  }

  async function handleOpenRepositoryFromUnavailable(): Promise<void> {
    if (!activeTab) {
      return;
    }

    const unavailableTabId = activeTab.id;
    const openedWorkspace = await openRepository();

    if (!openedWorkspace) {
      return;
    }

    handleCloseTab(unavailableTabId);
  }

  async function handleOpenRecentRepositoryFromStart(repoPath: string): Promise<boolean> {
    const openedWorkspace = await openRepositoryAtPath(repoPath);

    if (!openedWorkspace) {
      return false;
    }

    completeStartPageAction();
    return true;
  }

  async function handleInitializeRepositoryFromStart(
    input: RepositoryInitializeInput
  ): Promise<boolean> {
    const initializedWorkspace = await initializeRepository(input);

    if (!initializedWorkspace) {
      return false;
    }

    completeStartPageAction();
    return true;
  }

  async function handleCloneRepositoryFromStart(input: RepositoryCloneInput): Promise<boolean> {
    const clonedWorkspace = await cloneRepository(input);

    if (!clonedWorkspace) {
      return false;
    }

    completeStartPageAction();
    return true;
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
      const remoteAvatarsChanged = nextSettings.remoteAvatars !== settings.remoteAvatars;
      const savedSettings = await window.api.updateSettings(nextSettings);
      setSettings(savedSettings);
      setGraphLimitByTab({});

      if (remoteAvatarsChanged) {
        await queryClient.invalidateQueries({ queryKey: ['commit-graph'] });
      }

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

  function handleSetReviewOpen(open: boolean): void {
    if (!activeTab) {
      return;
    }

    if (open) {
      if (!selectedRow || selectedRow.node.kind === 'stash') {
        return;
      }

      setIsCommitSearchOpen(false);
      void selectFile(activeTab.id, undefined);
      setReviewTargetByTab((value) => ({
        ...value,
        [activeTab.id]:
          selectedRow.node.kind === 'wip'
            ? { kind: 'wip', scope: 'all' }
            : { kind: 'commit', sha: selectedRow.sha }
      }));
      delete reviewViewStateByTabRef.current[activeTab.id];
      return;
    }

    setReviewTargetByTab((value) => withoutRecordKey(value, activeTab.id));
    delete reviewViewStateByTabRef.current[activeTab.id];
  }

  function handleOpenBranchReview(name: string, sha: string): void {
    if (!activeTab) {
      return;
    }

    setIsCommitSearchOpen(false);
    handleBulkSelectionChange([]);
    void selectCommit(activeTab.id, sha);
    void selectFile(activeTab.id, undefined);
    setReviewTargetByTab((value) => ({
      ...value,
      [activeTab.id]: { kind: 'branch', name, sha }
    }));
    delete reviewViewStateByTabRef.current[activeTab.id];
  }

  async function handleStageAllWip(): Promise<void> {
    await runRepositoryOperation('Stage all files', (repoPath) => window.api.stageAll(repoPath));
  }

  function handleOpenWipCommitComposer(): void {
    if (!activeTab) {
      return;
    }

    handleBulkSelectionChange([]);
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

    handleBulkSelectionChange([]);
    void selectFile(activeTab.id, undefined);
    void selectCommit(activeTab.id, 'wip');
  }

  function handleOpenConflictFile(path: string): void {
    if (!activeTab) {
      return;
    }

    const tabId = activeTab.id;
    handleBulkSelectionChange([]);
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
      setIsCommitSearchOpen(false);
      setReviewTargetByTab((value) => withoutRecordKey(value, activeTab.id));
      delete reviewViewStateByTabRef.current[activeTab.id];
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

    if (!requestedRepoPath) {
      return false;
    }

    const requestedRepoIsBusy =
      Boolean(activeRepositoryOperations[requestedRepoPath]) ||
      operationLogEntries.some((entry) => entry.repoPath === requestedRepoPath && entry.status === 'pending');

    if (requestedRepoIsBusy || operationStartGuardRef.current.has(requestedRepoPath)) {
      return false;
    }

    operationStartGuardRef.current.add(requestedRepoPath);
    const id = createLogId();
    const happenedAt = new Date().toISOString();
    setActiveRepositoryOperations((operations) => ({
      ...operations,
      [requestedRepoPath]: {
        id,
        repoPath: requestedRepoPath,
        label,
        phase: 'running',
        checkout: options.checkout
      }
    }));
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
      setActiveRepositoryOperations((operations) => {
        const operation = operations[requestedRepoPath];
        return operation?.id === id
          ? { ...operations, [requestedRepoPath]: { ...operation, phase: 'refreshing' } }
          : operations;
      });
      setOperationLogEntries((entries) =>
        entries.map((entry) =>
          entry.id === id
            ? {
                ...entry,
                status: 'pending',
                phase: 'refreshing',
                detail: 'Updating repository data…'
              }
            : entry
        )
      );
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
                phase: 'completed',
                canRetry: false,
                waitsForRefresh: false,
                detail,
                happenedAt: result.happenedAt
              }
            : entry
        )
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Git operation failed.';
      setOperationLogEntries((entries) =>
        applyOperationFailure(
          entries,
          id,
          message,
          new Date().toISOString()
        )
      );
      options.onFailure?.({ repoPath: requestedRepoPath, message });
      return false;
    } finally {
      operationStartGuardRef.current.delete(requestedRepoPath);
      setActiveRepositoryOperations((operations) => {
        if (operations[requestedRepoPath]?.id !== id) {
          return operations;
        }

        const nextOperations = { ...operations };
        delete nextOperations[requestedRepoPath];
        return nextOperations;
      });
    }
  }

  useEffect(() => {
    runRepositoryOperationRef.current = runRepositoryOperation;
  });

  useEffect(() => {
    if (
      isLoading ||
      !hasLoadedSettings ||
      isStartTabActive ||
      gitHubWorkspaceView ||
      !autoFetchRepositoryPath ||
      !autoFetchRepositoryCommonDir ||
      settings.autoFetchIntervalMinutes === 0
    ) {
      return;
    }

    const repository = {
      commonDir: autoFetchRepositoryCommonDir,
      path: autoFetchRepositoryPath
    };
    let active = true;
    let cancelQueuedAutoFetch = (): void => {};

    function scheduleAutoFetch(): void {
      cancelQueuedAutoFetch();
      cancelQueuedAutoFetch = autoFetchCoordinatorRef.current.schedule(
        repository,
        (scheduledRepository) => {
          if (!active) {
            return Promise.resolve('skipped');
          }

          return autoFetchRepository({
            intervalMinutes: settings.autoFetchIntervalMinutes,
            loadRepository: () =>
              queryClient.fetchQuery({
                queryKey: repositoryOverviewQueryKey(scheduledRepository.path),
                queryFn: () => window.api.getRepositoryOverview(scheduledRepository.path),
                staleTime: 1500,
                retry: false
              }),
            fetchRepository: async () => {
              const completed =
                (await runRepositoryOperationRef.current?.(
                  'Fetch',
                  (repoPath) => window.api.fetchRepository(repoPath),
                  {
                    repoPath: scheduledRepository.path,
                    retryable: true
                  }
                )) ?? false;

              if (completed) {
                await Promise.all(
                  useWorkspaceStore
                    .getState()
                    .workspace.tabs.filter(
                      (tab) =>
                        tab.commonDir === scheduledRepository.commonDir &&
                        tab.path !== scheduledRepository.path
                    )
                    .map((tab) =>
                      queryClient.invalidateQueries({
                        queryKey: repositoryOverviewQueryKey(tab.path)
                      })
                    )
                );
              }

              return completed;
            }
          });
        }
      );
    }

    scheduleAutoFetch();
    const intervalId = window.setInterval(
      scheduleAutoFetch,
      autoFetchIntervalMilliseconds(settings.autoFetchIntervalMinutes)
    );

    return () => {
      active = false;
      cancelQueuedAutoFetch();
      window.clearInterval(intervalId);
    };
  }, [
    autoFetchRepositoryCommonDir,
    autoFetchRepositoryPath,
    gitHubWorkspaceView,
    hasLoadedSettings,
    isLoading,
    isStartTabActive,
    queryClient,
    settings.autoFetchIntervalMinutes
  ]);

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
    const branch = repositoryQuery.data?.status.branch;
    const expectedBranch = branch && !branch.isDetached ? branch.head : undefined;
    void runRepositoryOperation('Pull fast-forward', (repoPath) =>
      window.api.pullRepository(repoPath, { mode: 'ff-only', expectedBranch })
    );
  }

  function handlePullBranch(name: string): void {
    void runRepositoryOperation(`Pull ${name}`, (repoPath) =>
      window.api.pullRepository(repoPath, { mode: 'ff-only', expectedBranch: name })
    );
  }

  function handleCopyBranchName(name: string): void {
    void navigator.clipboard.writeText(name);
  }

  function handleSetBranchUpstream(name: string): void {
    const remoteBranches = [...(repositoryQuery.data?.refs.remoteBranches ?? [])].sort(
      (left, right) => {
        const leftMatches = branchNameFromRemoteRef(left.name) === name ? 0 : 1;
        const rightMatches = branchNameFromRemoteRef(right.name) === name ? 0 : 1;
        return leftMatches - rightMatches || left.name.localeCompare(right.name);
      }
    );
    const firstRemoteBranch = remoteBranches[0];

    if (!firstRemoteBranch) {
      return;
    }

    openCommandDialog({
      title: `Set upstream for ${name}`,
      description: 'Choose the existing remote branch this local branch should track.',
      confirmLabel: 'Set Upstream',
      fields: [
        {
          id: 'upstream',
          kind: 'select',
          label: 'Remote branch',
          value: firstRemoteBranch.name,
          options: remoteBranches.map((branch) => ({
            value: branch.name,
            label: branch.name,
            description:
              branchNameFromRemoteRef(branch.name) === name
                ? 'Same branch name'
                : `Track ${branch.name}`
          }))
        }
      ],
      onSubmit(values) {
        const upstream = dialogText(values, 'upstream');

        if (!upstream) {
          return;
        }

        void runRepositoryOperation(`Set upstream for ${name}`, (repoPath) =>
          window.api.setBranchUpstream(repoPath, { branch: name, upstream })
        );
      }
    });
  }

  function handlePush(): void {
    const branch = repositoryQuery.data?.refs.localBranches.find((candidate) => candidate.current);
    const pushPlan = branch
      ? createPushPlan(branch, repositoryQuery.data?.remotes ?? [])
      : undefined;

    setPushRejectionPrompt(undefined);
    void runRepositoryOperation(
      'Push',
      (repoPath) =>
        window.api.pushRepository(
          repoPath,
          pushPlan
            ? {
                forceWithLease: false,
                branch: pushPlan.branchName,
                expectedLocalSha: pushPlan.expectedLocalSha,
                target: pushPlan.target
              }
            : { forceWithLease: false }
        ),
      {
        onFailure: ({ repoPath, message }) => {
          if (pushPlan && isNonFastForwardPushError(message)) {
            setPushRejectionPrompt(
              createPushRejectionPrompt(
                repoPath,
                pushPlan,
                repositoryQuery.data?.refs.remoteBranches ?? []
              )
            );
          }
        }
      }
    );
  }

  function handlePushBranch(name: string): void {
    const branch = repositoryQuery.data?.refs.localBranches.find((candidate) => candidate.name === name);
    const pushPlan = branch
      ? createPushPlan(branch, repositoryQuery.data?.remotes ?? [])
      : undefined;

    setPushRejectionPrompt(undefined);
    void runRepositoryOperation(
      `Push ${name}`,
      (repoPath) =>
        window.api.pushRepository(
          repoPath,
          pushPlan
            ? {
                forceWithLease: false,
                branch: pushPlan.branchName,
                expectedLocalSha: pushPlan.expectedLocalSha,
                target: pushPlan.target
              }
            : { forceWithLease: false, branch: name }
        ),
      {
        onFailure: ({ repoPath, message }) => {
          if (pushPlan && isNonFastForwardPushError(message)) {
            setPushRejectionPrompt(
              createPushRejectionPrompt(
                repoPath,
                pushPlan,
                repositoryQuery.data?.refs.remoteBranches ?? []
              )
            );
          }
        }
      }
    );
  }

  function handlePullRejectedBranch(prompt: PushRejectionPrompt): void {
    setPushRejectionPrompt(undefined);

    if (prompt.isCurrentBranch) {
      void runRepositoryOperation(
        `Pull ${prompt.branchName}`,
        (repoPath) =>
          window.api.pullRepository(repoPath, {
            mode: 'ff-only',
            expectedBranch: prompt.branchName
          }),
        { repoPath: prompt.repoPath }
      );
      return;
    }

    const activation = resolveLocalBranchActivation(
      prompt.branchName,
      repositoryQuery.data?.worktrees ?? []
    );

    if (activation.kind === 'activate-worktree') {
      void activateWorktreeAndPull(activation.branchName, activation.worktreePath);
      return;
    }

    void runRepositoryOperation(
      `Checkout and pull ${prompt.branchName}`,
      async (repoPath) => {
        await window.api.checkoutRef(repoPath, {
          kind: 'local',
          name: prompt.branchName
        });
        return window.api.pullRepository(repoPath, {
          mode: 'ff-only',
          expectedBranch: prompt.branchName
        });
      },
      {
        repoPath: prompt.repoPath,
        checkout: { targetRef: { kind: 'branch', name: prompt.branchName } }
      }
    );
  }

  function handleOfferForcePush(prompt: PushRejectionPrompt): void {
    if (!settings.confirmForcePush) {
      executeForcePush(prompt);
      return;
    }

    openCommandDialog({
      title: `Force push ${prompt.branchName}?`,
      description: 'Force push is a destructive action and cannot be undone. Are you sure?',
      detail: `This can discard commits from ${prompt.remoteBranchName}. Git Gud uses force-with-lease so the push is refused if the remote changed since your last fetch.`,
      confirmLabel: 'Force Push',
      tone: 'danger',
      fields: [
        {
          id: 'dontAskAgain',
          kind: 'checkbox',
          label: "Don't ask again",
          checked: false,
          helper: 'You can restore this confirmation in Settings → Safety.'
        }
      ],
      onSubmit(values) {
        if (dialogChecked(values, 'dontAskAgain')) {
          void updateForcePushConfirmation(false);
        }
        executeForcePush(prompt);
      }
    });
  }

  function executeForcePush(prompt: PushRejectionPrompt): void {
    setPushRejectionPrompt(undefined);
    void runRepositoryOperation(
      `Force push ${prompt.branchName}`,
      (repoPath) =>
        window.api.pushRepository(repoPath, {
          forceWithLease: true,
          branch: prompt.branchName,
          expectedLocalSha: prompt.expectedLocalSha,
          target: prompt.target
        }),
      { repoPath: prompt.repoPath }
    );
  }

  async function updateForcePushConfirmation(confirmForcePush: boolean): Promise<void> {
    try {
      const savedSettings = await window.api.updateSettings({ confirmForcePush });
      setSettings(savedSettings);
    } catch (error) {
      setSettingsErrorMessage(
        error instanceof Error ? error.message : 'Unable to save the force-push confirmation preference.'
      );
    }
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
    const activation = resolveLocalBranchActivation(name, repositoryQuery.data?.worktrees ?? []);

    if (activation.kind === 'activate-worktree') {
      void activateLinkedWorktreeWip(activation.worktreePath);
      return;
    }

    void runRepositoryOperation(
      `Checkout ${name}`,
      (repoPath) => window.api.checkoutRef(repoPath, { kind: 'local', name }),
      { checkout: { targetRef: { kind: 'branch', name } } }
    );
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
          value: branchNameFromRemoteRef(name),
          required: true,
          autoFocus: true
        }
      ],
      onSubmit(values) {
        const localName = dialogText(values, 'localName');

        if (!localName) {
          return;
        }

        void runRepositoryOperation(
          `Checkout ${localName}`,
          (repoPath) =>
            window.api.checkoutRef(repoPath, {
              kind: 'remote',
              name,
              localName
            }),
          { checkout: { targetRef: { kind: 'remote', name } } }
        );
      }
    });
  }

  function handleActivateRemoteBranch(name: string): void {
    const activation = resolveRemoteBranchActivation(name, repositoryQuery.data?.refs.localBranches ?? []);

    if (activation.kind === 'none') {
      return;
    }

    if (activation.kind === 'checkout-remote') {
      handleCheckoutRemoteBranch(name);
      return;
    }

    if (activation.kind === 'checkout-local') {
      void runRepositoryOperation(
        `Checkout ${activation.branchName}`,
        (repoPath) => window.api.checkoutRef(repoPath, { kind: 'local', name: activation.branchName }),
        { checkout: { targetRef: { kind: 'remote', name } } }
      );
      return;
    }

    if (activation.kind === 'reset-local') {
      handleResetLocalBranchToRemote(activation.branchName, name);
      return;
    }

    if (activation.kind === 'pull') {
      void runRepositoryOperation(
        `Pull ${activation.branchName}`,
        (repoPath) => window.api.pullRepository(repoPath, { mode: 'ff-only' }),
        { checkout: { targetRef: { kind: 'remote', name } } }
      );
      return;
    }

    const localActivation = resolveLocalBranchActivation(
      activation.branchName,
      repositoryQuery.data?.worktrees ?? []
    );

    if (localActivation.kind === 'activate-worktree') {
      void activateWorktreeAndPull(localActivation.branchName, localActivation.worktreePath);
      return;
    }

    void runRepositoryOperation(
      `Checkout and pull ${activation.branchName}`,
      async (repoPath) => {
        await window.api.checkoutRef(repoPath, { kind: 'local', name: activation.branchName });
        return window.api.pullRepository(repoPath, { mode: 'ff-only' });
      },
      { checkout: { targetRef: { kind: 'remote', name } } }
    );
  }

  async function activateWorktreeAndPull(branchName: string, worktreePath: string): Promise<void> {
    await activateLinkedWorktreeWip(worktreePath);
    await runRepositoryOperation(
      `Pull ${branchName}`,
      (repoPath) => window.api.pullRepository(repoPath, { mode: 'ff-only' }),
      { repoPath: worktreePath }
    );
  }

  function handleResetLocalBranchToRemote(localName: string, remoteName: string): void {
    const localBranch = repositoryQuery.data?.refs.localBranches.find((branch) => branch.name === localName);
    const localCommitLabel = localBranch?.ahead
      ? `${localBranch.ahead} local ${localBranch.ahead === 1 ? 'commit' : 'commits'} will no longer be on ${localName}.`
      : `The current tip of ${localName} will be replaced.`;

    openCommandDialog({
      title: `Reset ${localName} to ${remoteName}?`,
      description: `Check out ${localName} and move it to the selected remote branch.`,
      detail: `${localCommitLabel} Your working tree must be clean. You can undo the reset until the repository changes again.`,
      confirmLabel: 'Reset Local to Remote',
      tone: 'danger',
      fields: [],
      onSubmit() {
        void runRepositoryOperation(
          `Reset ${localName} to ${remoteName}`,
          (repoPath) => window.api.checkoutRef(repoPath, {
            kind: 'remote-reset',
            name: remoteName,
            localName
          }),
          { checkout: { targetRef: { kind: 'remote', name: remoteName } } }
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
    const localBranch = repositoryQuery.data?.refs.localBranches.find((branch) => branch.name === name);
    const remoteBranch = localBranch
      ? resolveRemoteBranchForLocalBranch(localBranch, repositoryQuery.data?.refs.remoteBranches ?? [])
      : undefined;
    const remote = remoteBranch ? remoteBranchDeleteTarget(remoteBranch) : undefined;
    const fields: CommandDialogConfig['fields'] = [
      ...(remote
        ? [
            {
              id: 'target',
              kind: 'select' as const,
              label: 'Delete',
              value: 'local',
              options: [
                {
                  value: 'local',
                  label: 'Local branch only',
                  description: `Delete ${name} from this repository.`
                },
                {
                  value: 'remote',
                  label: `${remote.name}/${remote.branch} only`,
                  description: 'Delete the shared remote branch and keep the local branch.'
                },
                {
                  value: 'both',
                  label: 'Local and remote branches',
                  description: `Delete both ${name} and ${remote.name}/${remote.branch}.`
                }
              ]
            }
          ]
        : []),
      {
        id: 'force',
        kind: 'checkbox',
        label: 'Force delete if not merged',
        checked: false,
        helper: remote ? 'Applies when the local branch is included.' : undefined
      }
    ];

    openCommandDialog({
      title: 'Delete branch',
      description: remote ? `Choose which copy of ${name} to delete.` : `Delete local branch ${name}.`,
      detail: remote
        ? `Deleting ${remote.name}/${remote.branch} changes the shared remote and cannot be undone. Local deletion can be undone from the operation log.`
        : 'Use force only when you intentionally want to delete an unmerged branch.',
      confirmLabel: 'Delete',
      tone: 'danger',
      fields,
      onSubmit(values) {
        const choice = normalizeBranchDeleteChoice(dialogText(values, 'target'));
        const force = dialogChecked(values, 'force');
        const input: GitDeleteBranchInput = choice === 'remote' && remote
          ? { remote, force: false }
          : choice === 'both' && remote
            ? { localName: name, remote, force }
            : { localName: name, force };

        void runRepositoryOperation(`Delete ${name}`, (repoPath) => window.api.deleteBranch(repoPath, input));
      }
    });
  }

  function handleDeleteRemoteBranch(branch: GitRemoteBranchRef): void {
    const remote = remoteBranchDeleteTarget(branch);

    openCommandDialog({
      title: 'Delete remote branch',
      description: `Delete ${branch.name} from ${branch.remote}.`,
      detail: 'This changes the shared remote and cannot be undone in Git Gud.',
      confirmLabel: 'Delete Remote Branch',
      tone: 'danger',
      fields: [],
      onSubmit() {
        void runRepositoryOperation(`Delete ${branch.name}`, (repoPath) =>
          window.api.deleteBranch(repoPath, { remote, force: false })
        );
      }
    });
  }

  async function handleCreateTagAtCommit(sha: string, name: string): Promise<boolean> {
    return runRepositoryOperation(`Create tag ${name}`, (repoPath) =>
      window.api.createTag(repoPath, {
        name,
        targetSha: sha
      })
    );
  }

  async function handleCreateAndPushTagAtCommit(sha: string, name: string): Promise<boolean> {
    return runRepositoryOperation(`Create tag ${name} and push to origin`, (repoPath) =>
      window.api.createTag(repoPath, {
        name,
        targetSha: sha,
        annotated: true,
        pushRemote: 'origin'
      })
    );
  }

  function handleOpenCreateTagDialog(sha: string): void {
    openCommandDialog({
      title: 'Create tag here',
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

        void handleCreateTagAtCommit(sha, name);
      }
    });
  }

  function handleOpenCreateAndPushTagDialog(sha: string): void {
    openCommandDialog({
      title: 'Create tag here and push',
      description: `Create an annotated tag at ${sha.slice(0, 8)} and push it to origin.`,
      confirmLabel: 'Create Tag and Push',
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

        void handleCreateAndPushTagAtCommit(sha, name);
      }
    });
  }

  function handleDeleteTag(input: GitTagDeleteInput): void {
    const { name, target } = input;
    const remote = target === 'local' ? undefined : input.remote;
    const description = target === 'local'
      ? `Delete ${name} from this repository.`
      : target === 'remote'
        ? `Delete ${name} from ${remote} and keep the local tag.`
        : `Delete ${name} from this repository and ${remote}.`;
    const detail = target === 'local'
      ? 'The local tag can be restored from the operation log.'
      : target === 'remote'
        ? 'This changes the shared remote and cannot be undone in Git Gud.'
        : 'Remote deletion cannot be undone. The local tag can be restored from the operation log.';

    openCommandDialog({
      title: 'Delete tag',
      description,
      detail,
      confirmLabel: 'Delete Tag',
      tone: 'danger',
      fields: [],
      onSubmit() {
        void runRepositoryOperation(`Delete tag ${name}`, (repoPath) => window.api.deleteTag(repoPath, input));
      }
    });
  }

  function handlePushTag(name: string, remote: string): void {
    void runRepositoryOperation(`Push tag ${name}`, (repoPath) =>
      window.api.pushTag(repoPath, { name, remote })
    );
  }

  function handleMergeRef(ref: string, label: string): void {
    const branch = repositoryQuery.data?.status.branch;
    const expectedCurrentBranch = branch && !branch.isDetached ? branch.head : undefined;

    openCommandDialog({
      title: 'Merge into current branch',
      description: `Merge ${label} into the checked-out branch.`,
      confirmLabel: 'Merge',
      fields: [],
      onSubmit() {
        void runRepositoryOperation(`Merge ${label}`, (repoPath) =>
          window.api.mergeRef(repoPath, { ref, expectedCurrentBranch })
        );
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
    handleCherryPickCommits([sha]);
  }

  function handleCherryPickCommits(shas: string[]): void {
    if (shas.length === 0) {
      return;
    }

    const isBulk = shas.length > 1;
    const subjects = commitSubjectsForShas(graphRows, shas);
    const label = isBulk ? `${shas.length} commits` : subjects[0] ?? 'commit';

    openCommandDialog({
      title: isBulk ? 'Cherry-pick selected commits' : 'Cherry-pick commit',
      description: isBulk
        ? `Apply ${shas.length} selected commits onto the current branch, oldest to newest.`
        : `Apply \u201c${label}\u201d onto the current branch.`,
      detailItems: isBulk ? subjects : undefined,
      confirmLabel: 'Cherry-pick',
      fields: [],
      onSubmit() {
        void runRepositoryOperation(`Cherry-pick ${label}`, (repoPath) => window.api.cherryPick(repoPath, shas));
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
    const branch = repositoryQuery.data?.status.branch;
    const targetLabel = branch?.isDetached ? 'HEAD' : branch?.head || 'current branch';

    openCommandDialog({
      title: `Reset ${targetLabel} to this commit`,
      description: `Move ${targetLabel} to ${sha.slice(0, 8)}.`,
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
            { value: 'soft', label: 'Soft — keep all changes', description: 'Move HEAD only; keep index and working tree.' },
            { value: 'mixed', label: 'Mixed — keep working copy but reset index', description: 'Move HEAD and reset index; keep working tree.' },
            { value: 'hard', label: 'Hard — discard all changes', description: 'Move HEAD, index, and tracked working tree files.' }
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
    const branch = repositoryQuery.data?.status.branch;
    const expectedCurrentBranch = branch && !branch.isDetached ? branch.head : undefined;

    openCommandDialog({
      title: 'Rebase current branch',
      description: `Replay the current branch onto ${label}.`,
      confirmLabel: 'Rebase',
      fields: [],
      onSubmit() {
        void runRepositoryOperation(`Rebase onto ${label}`, (repoPath) =>
          window.api.rebaseOnto(repoPath, { target: ref, expectedCurrentBranch })
        );
      }
    });
  }

  function handleRebaseOntoCommit(sha: string): void {
    handleRebaseOntoRef(sha, sha.slice(0, 8));
  }

  function handleRebaseOntoBranch(name: string): void {
    handleRebaseOntoRef(name, name);
  }

  function handleInteractiveRebase(base: string, initialSquashShas?: string[]): void {
    if (!activeTab) {
      return;
    }

    setInteractiveRebaseDialog({
      base,
      initialSquashShas,
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
                initialSquashShas,
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
                initialSquashShas,
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

  function handleSquashCommits(baseSha: string, squashShas: string[]): void {
    handleInteractiveRebase(baseSha, squashShas);
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
      onSelect: () => selectedRow && handleOpenCreateTagDialog(selectedRow.sha)
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
            '⌘F  Find commits by SHA or message',
            '⌘⇧F  Fetch all remotes',
            '⌘⇧U  Push current branch',
            '⌘\\  Toggle diff layout',
            '⌘⌥F  Focus sidebar filter',
            '↑ / ↓  Select graph rows or files',
            'J / K  Next / previous review block',
            '] / [  Next / previous file in a review block',
            'Page Down / Page Up  Read through long review files',
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
    <main
      className="relative flex h-screen min-h-0 flex-col overflow-hidden bg-[var(--bg-app)] text-[var(--text-1)]"
      aria-busy={Boolean(profileTransition)}
    >
      <DashboardActionsMonitor
        dashboards={dashboardsQuery.data?.dashboards ?? []}
        isDashboardVisible={gitHubWorkspaceView?.kind === 'dashboard'}
        profileId={connectedGitHubProfileId}
      />
      <TabStrip
        tabs={workspace.tabs}
        activeTabId={
          isStartTabActive || gitHubWorkspaceView?.kind === 'dashboard'
            ? undefined
            : workspace.activeTabId
        }
        isStartTabOpen={isStartTabOpen}
        isStartTabActive={isStartTabActive}
        isDashboardsTabActive={gitHubWorkspaceView?.kind === 'dashboard'}
        dashboardUnreadCount={dashboardActionAlertsQuery.data?.unreadCount ?? 0}
        profileState={workspaceProfileState}
        activeRepoDirty={(repositoryQuery.data?.status.dirtyCount ?? 0) > 0}
        onActivateTab={(tabId) => void handleActivateRepositoryTab(tabId)}
        onReorderTab={(tabId, targetIndex) => void reorderTab(tabId, targetIndex)}
        onCloseTab={handleCloseTab}
        onOpenStartTab={handleOpenStartTab}
        onActivateStartTab={handleActivateStartTab}
        onCloseStartTab={handleCloseStartTab}
        onActivateDashboardsTab={handleActivateDashboardsTab}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onActivateProfile={handleActivateProfile}
        onSaveAndActivateProfile={handleSaveAndActivateProfile}
      />

      {!gitHubWorkspaceView && !isStartTabActive && !repositoryUnavailable ? (
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
          onOpenQuickJump={() => setIsQuickJumpOpen(true)}
          hasSelectedCommit={Boolean(selectedRow && selectedRow.node.kind !== 'wip' && selectedRow.node.kind !== 'stash')}
          onMergeSelected={() => selectedRow && handleMergeCommit(selectedRow.sha)}
          onRebaseSelected={() => selectedRow && handleRebaseOntoCommit(selectedRow.sha)}
          onInteractiveRebaseSelected={() => selectedRow && handleInteractiveRebaseFromCommit(selectedRow.sha)}
          onTagSelected={() => selectedRow && handleOpenCreateTagDialog(selectedRow.sha)}
        />
      ) : null}

      {pullRequestDeepLinkError ? (
        <div
          className="flex shrink-0 items-center justify-between border-b border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-1.5 text-xs text-[var(--danger-text)]"
          role="alert"
        >
          <span>{pullRequestDeepLinkError}</span>
          <button
            className="icon-btn h-6 w-6"
            type="button"
            onClick={() => setPullRequestDeepLinkError(undefined)}
            aria-label="Dismiss pull request link error"
          >
            <X size={13} />
          </button>
        </div>
      ) : null}

      {!gitHubWorkspaceView && !repositoryUnavailable && (errorMessage || repositoryError) ? (
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-1.5 text-xs text-[var(--danger-text)]" role="alert">
          <span>{errorMessage ?? repositoryError}</span>
          <button className="icon-btn h-6 w-6" type="button" onClick={handleErrorAction} aria-label="Retry or dismiss error">
            <X size={13} />
          </button>
        </div>
      ) : null}

      {!gitHubWorkspaceView &&
      !isStartTabActive &&
      !repositoryUnavailable &&
      pushRejectionPrompt?.repoPath === activeTab?.path ? (
        <PushRejectedBanner
          prompt={pushRejectionPrompt}
          isBusy={isOperationBusy}
          onPull={handlePullRejectedBranch}
          onForcePush={handleOfferForcePush}
          onDismiss={() => setPushRejectionPrompt(undefined)}
        />
      ) : null}

      {!gitHubWorkspaceView && !isStartTabActive && !repositoryUnavailable ? (
        <ConflictBanner
          conflictState={repositoryQuery.data?.conflictState}
          isBusy={isOperationBusy}
          onResolve={handleResolveConflict}
          onSelectFile={handleOpenConflictFile}
        />
      ) : null}

      <section className="flex min-h-0 flex-1">
        {gitHubWorkspaceView?.kind === 'dashboard' ? (
          <DashboardView
            profile={activeGitHubProfile}
            requestedDashboardId={gitHubWorkspaceView.dashboardId}
            actionAlerts={dashboardActionAlertsQuery.data?.alerts ?? []}
            onMarkActionAlertsRead={handleMarkDashboardActionAlertsRead}
            onSelectDashboard={handleSelectDashboard}
            onOpenProfileSettings={handleOpenGitProfileMenu}
            onClose={handleClosePullRequestWorkspace}
            resolveRepositoryPath={resolveDashboardRepositoryPath}
            chooseRepositoryPathForCodex={chooseDashboardRepositoryPathForCodex}
          />
        ) : gitHubWorkspaceView ? (
          <>
            <Sidebar
              repositoryOverview={repositoryQuery.data}
              isLoading={repositoryQuery.isLoading}
              isRefreshing={repositoryQuery.isFetching && !repositoryQuery.isLoading}
              errorMessage={repositoryError}
              isCollapsed={isSidebarCollapsed}
              width={effectiveSidebarWidth}
              filterFocusSignal={sidebarFilterFocusSignal}
              onToggleCollapsed={handleToggleSidebar}
              pullRequestCount={pullRequestInboxQuery.data?.pullRequests.length ?? 0}
              isPullRequestLoading={pullRequestInboxQuery.isLoading}
              isPullRequestInboxActive
              onOpenPullRequestInbox={handleOpenPullRequestInbox}
              onResize={handleSidebarResize}
              onResizeCommit={handleSidebarResizeCommit}
              isOperationBusy={isOperationBusy}
              onCheckoutBranch={handleCheckoutBranch}
              onCheckoutRemoteBranch={handleActivateRemoteBranch}
              onCopyBranchName={handleCopyBranchName}
              onPullBranch={handlePullBranch}
              onPushBranch={handlePushBranch}
              onSetBranchUpstream={handleSetBranchUpstream}
              onRenameBranch={handleRenameBranch}
              onReviewBranch={handleOpenBranchReview}
              onViewPullRequest={handleViewPullRequest}
              localPullRequestsByBranch={pullRequestsByBranch.local}
              remotePullRequestsByBranch={pullRequestsByBranch.remote}
              onMergeBranch={handleMergeBranch}
              onRebaseOntoBranch={handleRebaseOntoBranch}
              onCreateTagAtCommit={handleOpenCreateAndPushTagDialog}
              onDeleteBranch={handleDeleteBranch}
              onDeleteRemoteBranch={handleDeleteRemoteBranch}
              tagPushRemote={tagPushRemote}
              onPushTag={handlePushTag}
              onDeleteTag={handleDeleteTag}
              onStashApply={handleStashApply}
              onStashPop={handleStashPop}
              onStashDrop={handleStashDrop}
            />
            {gitHubWorkspaceView.kind === 'review' ? (
              <PullRequestReviewView
                key={`${gitHubWorkspaceView.pullRequest.profileId}:${gitHubWorkspaceView.pullRequest.id}`}
                pullRequest={gitHubWorkspaceView.pullRequest}
                codexRepoPath={pullRequestCodexRepoPath}
                diffStyle={activeDiffStyle}
                diffSyntaxTheme={settings.diffSyntaxTheme}
                onSetDiffStyle={handleSetDiffStyle}
                onBackToInbox={handleOpenPullRequestInbox}
                onOpenCommit={
                  pullRequestCodexRepoPath
                    ? (sha) => void handleOpenPullRequestCommit(sha)
                    : undefined
                }
                onClose={handleClosePullRequestWorkspace}
                onMerged={handleOpenPullRequestInbox}
              />
            ) : (
              <PullRequestInboxView
                profile={activeGitHubProfile}
                inbox={pullRequestInboxQuery.data}
                isLoading={pullRequestInboxQuery.isLoading}
                isRefreshing={pullRequestInboxQuery.isFetching && !pullRequestInboxQuery.isLoading}
                errorMessage={
                  pullRequestInboxQuery.error instanceof Error
                    ? pullRequestInboxQuery.error.message
                    : undefined
                }
                onRefresh={() => void pullRequestInboxQuery.refetch()}
                onClose={handleClosePullRequestWorkspace}
                onOpenProfileSettings={handleOpenGitProfileMenu}
                onSelectPullRequest={(pullRequest) =>
                  setGitHubWorkspaceView({ kind: 'review', pullRequest })
                }
              />
            )}
          </>
        ) : isStartTabActive ? (
          <StartPage
            isLoading={isLoading}
            recentRepos={workspace.recentRepos}
            onOpenRepository={handleOpenRepositoryFromStart}
            onOpenRecentRepository={handleOpenRecentRepositoryFromStart}
            onChooseParentDirectory={chooseRepositoryParentDirectory}
            onInitializeRepository={handleInitializeRepositoryFromStart}
            onCloneRepository={handleCloneRepositoryFromStart}
          />
        ) : activeTab ? (
          isRecoveringRepository ? (
            <RepositoryRecoveryView repoPath={activeTab.path} />
          ) : repositoryUnavailable ? (
            <UnavailableRepositoryView
              repoPath={activeTab.path}
              isOpening={isLoading}
              onRetry={() => {
                void Promise.all([repositoryQuery.refetch(), graphQuery.refetch()]);
              }}
              onOpenAnother={() => void handleOpenRepositoryFromUnavailable()}
              onClose={() => handleCloseTab(activeTab.id)}
            />
          ) : interactiveRebaseDialog ? (
            <InteractiveRebaseDialog
              plan={interactiveRebaseDialog.plan}
              initialSquashShas={interactiveRebaseDialog.initialSquashShas}
              isLoading={interactiveRebaseDialog.isLoading}
              isRunning={interactiveRebaseDialog.isRunning}
              errorMessage={interactiveRebaseDialog.errorMessage}
              onClose={() => setInteractiveRebaseDialog(undefined)}
              onRun={handleRunInteractiveRebase}
            />
          ) : (
            <>
              <Sidebar
                repositoryOverview={repositoryQuery.data}
                isLoading={repositoryQuery.isLoading}
                isRefreshing={repositoryQuery.isFetching && !repositoryQuery.isLoading}
                errorMessage={repositoryError}
                isCollapsed={isSidebarCollapsed}
                width={effectiveSidebarWidth}
                filterFocusSignal={sidebarFilterFocusSignal}
                onToggleCollapsed={handleToggleSidebar}
                pullRequestCount={pullRequestInboxQuery.data?.pullRequests.length ?? 0}
                isPullRequestLoading={pullRequestInboxQuery.isLoading}
                isPullRequestInboxActive={false}
                onOpenPullRequestInbox={handleOpenPullRequestInbox}
                onResize={handleSidebarResize}
                onResizeCommit={handleSidebarResizeCommit}
                isOperationBusy={isOperationBusy}
                onCheckoutBranch={handleCheckoutBranch}
                onCheckoutRemoteBranch={handleActivateRemoteBranch}
                onCopyBranchName={handleCopyBranchName}
                onPullBranch={handlePullBranch}
                onPushBranch={handlePushBranch}
                onSetBranchUpstream={handleSetBranchUpstream}
                onRenameBranch={handleRenameBranch}
                onReviewBranch={handleOpenBranchReview}
                onViewPullRequest={handleViewPullRequest}
                localPullRequestsByBranch={pullRequestsByBranch.local}
                remotePullRequestsByBranch={pullRequestsByBranch.remote}
                onMergeBranch={handleMergeBranch}
                onRebaseOntoBranch={handleRebaseOntoBranch}
                onCreateTagAtCommit={handleOpenCreateAndPushTagDialog}
                onDeleteBranch={handleDeleteBranch}
                onDeleteRemoteBranch={handleDeleteRemoteBranch}
                tagPushRemote={tagPushRemote}
                onPushTag={handlePushTag}
                onDeleteTag={handleDeleteTag}
                onStashApply={handleStashApply}
                onStashPop={handleStashPop}
                onStashDrop={handleStashDrop}
              />
              {activeReviewTarget ? (
                <Suspense
                  fallback={
                    <section className="grid min-w-0 flex-1 place-items-center bg-[var(--bg-app)] text-xs text-[var(--text-3)]">
                      Loading context review…
                    </section>
                  }
                >
                  <ReviewView
                    key={`${activeTab.path}:${activeReviewTarget.kind}:${activeReviewTarget.kind === 'wip' ? activeReviewTarget.scope : activeReviewTarget.sha}`}
                    repoPath={activeTab.path}
                    target={activeReviewTarget}
                    initialViewState={reviewViewStateByTabRef.current[activeTab.id]}
                    onViewStateChange={(state) => {
                      reviewViewStateByTabRef.current[activeTab.id] = state;
                    }}
                    diffStyle={activeDiffStyle}
                    diffSyntaxTheme={settings.diffSyntaxTheme}
                    onSetDiffStyle={handleSetDiffStyle}
                    onClose={() => handleSetReviewOpen(false)}
                  />
                </Suspense>
              ) : activeTab.selectedFile && isSelectedFileConflicted ? (
                <Suspense
                  fallback={
                    <section className="grid min-w-0 flex-1 place-items-center bg-[var(--bg-app)] text-xs text-[var(--text-3)]">
                      Loading conflict resolver…
                    </section>
                  }
                >
                  <ConflictResolver
                    key={`conflict:${activeTab.selectedFile}`}
                    repoPath={activeTab.path}
                    path={activeTab.selectedFile}
                    unresolvedPaths={conflictedPaths}
                    operation={repositoryQuery.data?.conflictState.operation}
                    isOperationBusy={isOperationBusy}
                    onSelectFile={handleOpenConflictFile}
                    onClose={() => handleSelectFile(undefined)}
                  />
                </Suspense>
              ) : activeTab.selectedFile ? (
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
                    selectedShas={selectedCommitShas}
                    selectedFile={activeTab.selectedFile}
                    diffStyle={activeDiffStyle}
                    diffSyntaxTheme={settings.diffSyntaxTheme}
                    wipScopeByPath={activeWipScopeByPath}
                    focusSignal={fileFocusByTab[activeTab.id] ?? 0}
                    isOperationBusy={isOperationBusy}
                    onSetDiffStyle={handleSetDiffStyle}
                    onChangeWipScope={handleChangeWipScope}
                    onSelectFile={handleSelectFile}
                    onClose={() => handleSelectFile(undefined)}
                  />
                </Suspense>
              ) : (
                <GraphView
                  rows={graphRows}
                  linkedWorktreeBranches={linkedWorktreeBranches}
                  selectedSha={selectedRow?.sha}
                  bulkSelectedShas={activeBulkSelectedShas}
                  isLoading={graphQuery.isLoading}
                  isFetching={graphQuery.isFetching}
                  errorMessage={graphError}
                  hasMore={graphQuery.data?.hasMore ?? false}
                  onSelectRow={handleSelectRow}
                  onBulkSelectionChange={handleBulkSelectionChange}
                  onLoadMore={handleLoadMoreGraphRows}
                  onStageAllWip={handleStageAllWip}
                  onOpenWipCommitComposer={handleOpenWipCommitComposer}
                  onStashPush={handleStashPush}
                  onStashApply={handleStashApply}
                  onStashPop={handleStashPop}
                  onStashDrop={handleStashDrop}
                  onCheckoutBranch={handleCheckoutBranch}
                  localBranches={repositoryQuery.data?.refs.localBranches}
                  canSetBranchUpstream={Boolean(repositoryQuery.data?.refs.remoteBranches.length)}
                  pullRequestsByBranch={pullRequestsByBranch.local}
                  onCopyBranchName={handleCopyBranchName}
                  onPullBranch={handlePullBranch}
                  onPushBranch={handlePushBranch}
                  onSetBranchUpstream={handleSetBranchUpstream}
                  onRenameBranch={handleRenameBranch}
                  onViewPullRequest={handleViewPullRequest}
                  onActivateRemoteBranch={handleActivateRemoteBranch}
                  onMergeBranch={handleMergeBranch}
                  onRebaseOntoBranch={handleRebaseOntoBranch}
                  onInteractiveRebaseOntoBranch={handleInteractiveRebaseOntoBranch}
                  onReviewBranch={handleOpenBranchReview}
                  onDeleteBranch={handleDeleteBranch}
                  onCheckoutCommit={handleCheckoutCommit}
                  onCreateBranchAtCommit={handleCreateBranch}
                  onCreateTagAtCommit={handleCreateAndPushTagAtCommit}
                  suggestedTagName={suggestedTagName}
                  tagPushRemote={tagPushRemote}
                  onPushTag={handlePushTag}
                  onDeleteTag={handleDeleteTag}
                  onMergeCommit={handleMergeCommit}
                  onRebaseOntoCommit={handleRebaseOntoCommit}
                  onInteractiveRebaseFromCommit={handleInteractiveRebaseFromCommit}
                  onCherryPickCommit={handleCherryPickCommit}
                  onCherryPickCommits={handleCherryPickCommits}
                  onSquashCommits={handleSquashCommits}
                  onRevertCommit={handleRevertCommit}
                  onResetToCommit={handleResetToCommit}
                  isOperationBusy={isOperationBusy}
                  checkoutTransition={checkoutTransition}
                  largeRepoMode={settings.largeRepoMode}
                  columns={settings.graphColumns}
                  remoteAvatars={settings.remoteAvatars}
                  isSearchOpen={isCommitSearchOpen}
                  searchFocusSignal={commitSearchFocusSignal}
                  onCloseSearch={() => setIsCommitSearchOpen(false)}
                />
              )}
              {!activeReviewTarget ? (
                <CommitDetailPanel
                  repoPath={activeTab.path}
                  row={selectedRow}
                  selectedShas={selectedCommitShas}
                  parentSha={parentSha}
                  headSha={repositoryQuery.data?.status.branch.oid}
                  selectedFile={activeTab.selectedFile}
                  wipDirtyCount={repositoryQuery.data?.status.dirtyCount}
                  showWorkingDirectoryBanner={activeTab.gitDir !== activeTab.commonDir}
                  profileState={repositoryQuery.data?.profileState}
                  commitFocusSignal={commitComposerFocusByTab[activeTab.id] ?? 0}
                  isOperationBusy={isOperationBusy}
                  width={effectiveDetailPanelWidth}
                  isCollapsed={isDetailPanelCollapsed}
                  remoteAvatars={settings.remoteAvatars}
                  isReviewOpen={isReviewOpen}
                  onToggleCollapsed={handleToggleDetailPanel}
                  onResize={handleDetailPanelResize}
                  onResizeCommit={handleDetailPanelResizeCommit}
                  onSelectCommit={handleSelectRow}
                  onSelectFile={handleSelectFile}
                  onSetReviewOpen={handleSetReviewOpen}
                  onOpenWipChanges={handleOpenWipChanges}
                  onDiscardAllWip={handleDiscardAllWip}
                  onDiscardWipFile={handleDiscardWipFile}
                  onOpenWipFile={handleOpenWipFile}
                  onRevealWipFile={handleRevealWipFile}
                />
              ) : null}
            </>
          )
        ) : (
          <StartPage
            isLoading={isLoading}
            recentRepos={workspace.recentRepos}
            onOpenRepository={handleOpenRepositoryFromStart}
            onOpenRecentRepository={handleOpenRecentRepositoryFromStart}
            onChooseParentDirectory={chooseRepositoryParentDirectory}
            onInitializeRepository={handleInitializeRepositoryFromStart}
            onCloneRepository={handleCloneRepositoryFromStart}
          />
        )}
      </section>

      <StatusBar
        activeTab={isStartTabActive ? undefined : activeTab}
        repositoryOverview={isStartTabActive ? undefined : repositoryQuery.data}
        isRepositoryLoading={!isStartTabActive && repositoryQuery.isLoading}
        isRepositoryRefreshing={
          !isStartTabActive &&
          !gitHubWorkspaceView &&
          !checkoutTransition &&
          Boolean(repositoryQuery.data || graphQuery.data) &&
          (repositoryQuery.isFetching || graphQuery.isFetching)
        }
        activeOperation={
          isStartTabActive || gitHubWorkspaceView || checkoutTransition
            ? undefined
            : visibleActiveOperation
        }
      />
      {import.meta.env.DEV && !isReviewBenchmarkOpen ? (
        <button
          className="fixed bottom-10 right-3 z-40 flex h-8 items-center gap-1.5 rounded-md border border-[var(--select-border)] bg-[var(--bg-popover)] px-2.5 text-[10px] font-semibold text-[var(--accent-2)] shadow-lg shadow-black/50 hover:bg-[var(--bg-hover)]"
          type="button"
          onClick={() => setIsReviewBenchmarkOpen(true)}
          title="Inspect expected and current review grouping benchmark plans"
        >
          <Beaker size={13} />
          Review benchmarks
        </button>
      ) : null}
      {import.meta.env.DEV && isReviewBenchmarkOpen && ReviewBenchmarkExplorer ? (
        <Suspense
          fallback={
            <section className="fixed inset-x-0 bottom-0 top-9 z-50 grid place-items-center bg-[var(--bg-app)] text-xs text-[var(--text-3)]">
              Loading benchmark explorer…
            </section>
          }
        >
          <ReviewBenchmarkExplorer
            diffStyle={reviewBenchmarkDiffStyle}
            diffSyntaxTheme={settings.diffSyntaxTheme}
            onSetDiffStyle={setReviewBenchmarkDiffStyle}
            onClose={() => setIsReviewBenchmarkOpen(false)}
          />
        </Suspense>
      ) : null}
      <OperationLog
        entries={operationLogEntries}
        onDismiss={handleDismissOperation}
        onCancel={(entry) => void handleCancelOperation(entry)}
        onRetry={handleRetryOperation}
        onCopyDetails={handleCopyOperationDetails}
      />
      {profileTransition ? <ProfileTransition transition={profileTransition} /> : null}
      {isQuickJumpOpen ? (
        <QuickJumpDialog
          tabs={workspace.tabs}
          activeTabId={workspace.activeTabId}
          repositoryOverview={repositoryQuery.data}
          graphRows={graphRows}
          paletteActions={paletteActions}
          isOperationBusy={isOperationBusy}
          onClose={() => setIsQuickJumpOpen(false)}
          onActivateTab={(tabId) => void handleActivateRepositoryTab(tabId)}
          onCheckoutBranch={handleCheckoutBranch}
          onCheckoutRemoteBranch={handleActivateRemoteBranch}
          onSelectCommit={handleSelectRow}
          onOpenWorktree={(worktreePath) => void activateLinkedWorktreeWip(worktreePath)}
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

function ProfileTransition({ transition }: { transition: ProfileTransitionState }): ReactElement {
  return (
    <div
      className="profile-transition-overlay"
      data-phase={transition.phase}
      role="status"
      aria-live="polite"
      aria-label={`Switching workspace from ${transition.from.label} to ${transition.to.label}`}
    >
      <div className="profile-transition-card">
        <p className="profile-transition-kicker">Switching workspace</p>
        <div className="profile-transition-identities" aria-hidden="true">
          <ProfileTransitionAvatar identity={transition.from} />
          <ArrowRight size={16} className="profile-transition-arrow" />
          <ProfileTransitionAvatar identity={transition.to} isTarget />
        </div>
        <p className="profile-transition-labels">
          <span>{transition.from.label}</span>
          <span className="text-[var(--text-3)]">to</span>
          <span>{transition.to.label}</span>
        </p>
        <div className="profile-transition-progress" aria-hidden="true">
          <span />
        </div>
        <p className="profile-transition-detail">Restoring tabs and repository state…</p>
      </div>
    </div>
  );
}

function UnavailableRepositoryView({
  repoPath,
  isOpening,
  onRetry,
  onOpenAnother,
  onClose
}: {
  repoPath: string;
  isOpening: boolean;
  onRetry: () => void;
  onOpenAnother: () => void;
  onClose: () => void;
}): ReactElement {
  return (
    <section className="grid min-w-0 flex-1 place-items-center bg-[var(--bg-app)] px-8 py-12">
      <div className="w-full max-w-xl rounded-xl border border-[var(--border)] bg-[var(--bg-sidebar)] p-8 text-center shadow-2xl">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-text)]">
          <FolderX size={22} />
        </span>
        <h1 className="mt-5 text-base font-semibold text-[var(--text-1)]">
          Repository folder is unavailable
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--text-2)]">
          This worktree may have been removed or its drive may be disconnected.
        </p>
        <p className="mono mt-4 break-all rounded-md border border-[var(--border)] bg-[var(--bg-app)] px-3 py-2.5 text-left text-xs text-[var(--text-3)]">
          {repoPath}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <button
            className="btn-primary btn-regular"
            type="button"
            disabled={isOpening}
            onClick={onOpenAnother}
          >
            <FolderOpen size={14} />
            Open another repository
          </button>
          <button className="btn-subtle btn-regular" type="button" onClick={onRetry}>
            <RefreshCw size={14} />
            Retry
          </button>
          <button className="btn-subtle btn-regular" type="button" onClick={onClose}>
            <X size={14} />
            Close tab
          </button>
        </div>
      </div>
    </section>
  );
}

function RepositoryRecoveryView({ repoPath }: { repoPath: string }): ReactElement {
  return (
    <section className="grid min-w-0 flex-1 place-items-center bg-[var(--bg-app)] px-8 py-12">
      <div className="text-center" role="status">
        <RefreshCw className="mx-auto animate-spin text-[var(--accent)]" size={22} />
        <p className="mt-3 text-sm font-medium text-[var(--text-1)]">Opening the base repository…</p>
        <p className="mono mt-1 max-w-xl break-all text-xs text-[var(--text-3)]">{repoPath}</p>
      </div>
    </section>
  );
}

function ProfileTransitionAvatar({
  identity,
  isTarget = false
}: {
  identity: ProfileTransitionIdentity;
  isTarget?: boolean;
}): ReactElement {
  return (
    <span
      className="profile-transition-avatar"
      data-target={isTarget ? 'true' : undefined}
      style={{ background: identity.color }}
    >
      {profileInitials(identity.label)}
    </span>
  );
}

function profileTransitionIdentity(profile: GitProfile | undefined): ProfileTransitionIdentity {
  return profile
    ? { label: profile.name, color: profile.avatarColor }
    : { label: 'Git config', color: 'var(--accent-2)' };
}

function profileInitials(value: string): string {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'P'
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function createLogId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function withoutRecordKey<TValue>(record: Record<string, TValue>, key: string): Record<string, TValue> {
  return Object.fromEntries(Object.entries(record).filter(([candidate]) => candidate !== key));
}

function moveRecordKey<TValue>(
  record: Record<string, TValue>,
  sourceKey: string,
  targetKey: string,
  fallback?: TValue
): Record<string, TValue> {
  const value = record[sourceKey] ?? fallback;
  const withoutSourceOrTarget = withoutRecordKey(withoutRecordKey(record, sourceKey), targetKey);

  return value === undefined
    ? withoutSourceOrTarget
    : { ...withoutSourceOrTarget, [targetKey]: value };
}

function dialogText(values: CommandDialogValues, id: string): string {
  return values.text[id]?.trim() ?? '';
}

function dialogChecked(values: CommandDialogValues, id: string): boolean {
  return values.checked[id] ?? false;
}

function normalizeBranchDeleteChoice(value: string): 'local' | 'remote' | 'both' {
  return value === 'remote' || value === 'both' ? value : 'local';
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
