import type { RecentRepository, RepoTab, RepositorySummary, WorkspaceState } from './types';

const MAX_RECENT_REPOS = 12;
const GIT_CONFIG_WORKSPACE_KEY = 'git-config';
export const DEFAULT_SIDEBAR_WIDTH = 382;
export const MIN_SIDEBAR_WIDTH = 220;
export const MAX_SIDEBAR_WIDTH = 560;
export const DEFAULT_DETAIL_PANEL_WIDTH = 382;
export const MIN_DETAIL_PANEL_WIDTH = 300;
export const MAX_DETAIL_PANEL_WIDTH = 620;

export type ProfileWorkspaceCollection = {
  activeProfileId?: string;
  workspacesByProfile: Record<string, WorkspaceState>;
};

export function createDefaultWorkspaceState(activeProfileId?: string): WorkspaceState {
  return {
    activeProfileId,
    tabs: [],
    recentRepos: [],
    sidebarCollapsed: false,
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    detailPanelCollapsed: false,
    detailPanelWidth: DEFAULT_DETAIL_PANEL_WIDTH
  };
}

export function normalizeWorkspaceState(value: unknown): WorkspaceState {
  const defaults = createDefaultWorkspaceState();

  if (!isRecord(value)) {
    return defaults;
  }

  const tabs = Array.isArray(value.tabs) ? value.tabs.filter(isRepoTab) : [];
  const activeTabId =
    typeof value.activeTabId === 'string' && tabs.some((tab) => tab.id === value.activeTabId)
      ? value.activeTabId
      : tabs[0]?.id;
  const recentRepos = Array.isArray(value.recentRepos)
    ? value.recentRepos.filter(isRecentRepository).slice(0, MAX_RECENT_REPOS)
    : [];

  return {
    activeProfileId: typeof value.activeProfileId === 'string' ? value.activeProfileId : undefined,
    tabs,
    activeTabId,
    recentRepos,
    sidebarCollapsed:
      typeof value.sidebarCollapsed === 'boolean' ? value.sidebarCollapsed : defaults.sidebarCollapsed,
    sidebarWidth: normalizeSidebarWidth(readOptionalNumber(value.sidebarWidth)),
    detailPanelCollapsed:
      typeof value.detailPanelCollapsed === 'boolean'
        ? value.detailPanelCollapsed
        : defaults.detailPanelCollapsed,
    detailPanelWidth: normalizeDetailPanelWidth(readOptionalNumber(value.detailPanelWidth))
  };
}

export function profileWorkspaceKey(profileId: string | undefined): string {
  return profileId ? `profile:${profileId}` : GIT_CONFIG_WORKSPACE_KEY;
}

export function partitionWorkspaceByProfile(
  value: unknown,
  resolveProfileId: (repoPath: string, assignedProfileId?: string) => string | undefined = (
    _repoPath,
    assignedProfileId
  ) => assignedProfileId
): ProfileWorkspaceCollection {
  const workspace = normalizeWorkspaceState(value);
  const profileIdByTab = new Map(
    workspace.tabs.map((tab) => [tab.id, resolveProfileId(tab.path, tab.assignedProfileId)] as const)
  );
  const activeProfileId = workspace.activeTabId
    ? profileIdByTab.get(workspace.activeTabId)
    : workspace.activeProfileId;
  const tabsByWorkspace = new Map<string, RepoTab[]>();

  for (const tab of workspace.tabs) {
    const profileId = profileIdByTab.get(tab.id);
    const key = profileWorkspaceKey(profileId);
    const tabs = tabsByWorkspace.get(key) ?? [];
    tabs.push({ ...tab, assignedProfileId: profileId });
    tabsByWorkspace.set(key, tabs);
  }

  if (tabsByWorkspace.size === 0) {
    tabsByWorkspace.set(profileWorkspaceKey(activeProfileId), []);
  }

  const activeWorkspaceKey = profileWorkspaceKey(activeProfileId);
  const recentReposByWorkspace = new Map<string, RecentRepository[]>();

  for (const recentRepo of workspace.recentRepos) {
    const profileId = resolveProfileId(recentRepo.path) ?? activeProfileId;
    const key = profileWorkspaceKey(profileId);
    const recentRepos = recentReposByWorkspace.get(key) ?? [];
    recentRepos.push(recentRepo);
    recentReposByWorkspace.set(key, recentRepos);

    if (!tabsByWorkspace.has(key)) {
      tabsByWorkspace.set(key, []);
    }
  }

  const workspacesByProfile = Object.fromEntries(
    [...tabsByWorkspace.entries()].map(([key, tabs]) => {
      const recentRepos = recentReposByWorkspace.get(key) ?? [];
      const activeTabId = tabs.some((tab) => tab.id === workspace.activeTabId)
        ? workspace.activeTabId
        : tabs[0]?.id;
      const profileId = tabs[0]?.assignedProfileId ?? (key === activeWorkspaceKey ? activeProfileId : undefined);

      return [
        key,
        {
          ...workspace,
          activeProfileId: profileId,
          tabs,
          activeTabId,
          recentRepos
        }
      ];
    })
  );

  return {
    activeProfileId,
    workspacesByProfile
  };
}

export function normalizeSidebarWidth(width: number | undefined): number {
  if (typeof width !== 'number' || !Number.isFinite(width)) {
    return DEFAULT_SIDEBAR_WIDTH;
  }

  return Math.round(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width)));
}

export function normalizeDetailPanelWidth(width: number | undefined): number {
  if (typeof width !== 'number' || !Number.isFinite(width)) {
    return DEFAULT_DETAIL_PANEL_WIDTH;
  }

  return Math.round(Math.min(MAX_DETAIL_PANEL_WIDTH, Math.max(MIN_DETAIL_PANEL_WIDTH, width)));
}

export function createRepoTabId(repoPath: string): string {
  return `repo:${repoPath}`;
}

export function upsertRepositoryTab(
  state: WorkspaceState,
  repository: RepositorySummary,
  now = new Date().toISOString()
): WorkspaceState {
  const id = createRepoTabId(repository.path);
  const existingTab = state.tabs.find((tab) => tab.id === id);
  const nextTab: RepoTab = existingTab
    ? {
        ...existingTab,
        ...repository,
        lastOpenedAt: now
      }
    : {
        ...repository,
        id,
        openedAt: now,
        lastOpenedAt: now,
        viewMode: 'graph'
      };

  const tabs = existingTab
    ? state.tabs.map((tab) => (tab.id === id ? nextTab : tab))
    : [...state.tabs, nextTab];

  return {
    ...state,
    tabs,
    activeTabId: id,
    recentRepos: upsertRecentRepository(state.recentRepos, repository, now)
  };
}

export function activateRepositoryTab(state: WorkspaceState, tabId: string): WorkspaceState {
  if (!state.tabs.some((tab) => tab.id === tabId)) {
    return state;
  }

  return {
    ...state,
    activeTabId: tabId
  };
}

export function closeRepositoryTab(state: WorkspaceState, tabId: string): WorkspaceState {
  const tabIndex = state.tabs.findIndex((tab) => tab.id === tabId);

  if (tabIndex === -1) {
    return state;
  }

  const tabs = state.tabs.filter((tab) => tab.id !== tabId);

  if (state.activeTabId !== tabId) {
    return {
      ...state,
      tabs
    };
  }

  const nextActiveTab = tabs[Math.max(0, tabIndex - 1)] ?? tabs[0];

  return {
    ...state,
    tabs,
    activeTabId: nextActiveTab?.id
  };
}

export function selectRepositoryCommit(
  state: WorkspaceState,
  tabId: string,
  selectedCommit: string | undefined
): WorkspaceState {
  const tabs = state.tabs.map((tab) => {
    if (tab.id !== tabId) {
      return tab;
    }

      return {
        ...tab,
        selectedCommit,
        selectedFile: undefined
      };
    });

  return {
    ...state,
    tabs
  };
}

export function selectRepositoryFile(
  state: WorkspaceState,
  tabId: string,
  selectedFile: string | undefined
): WorkspaceState {
  const tabs = state.tabs.map((tab) => {
    if (tab.id !== tabId) {
      return tab;
    }

    return {
      ...tab,
      selectedFile
    };
  });

  return {
    ...state,
    tabs
  };
}

export function setSidebarCollapsed(state: WorkspaceState, sidebarCollapsed: boolean): WorkspaceState {
  return {
    ...state,
    sidebarCollapsed
  };
}

export function setSidebarWidth(state: WorkspaceState, sidebarWidth: number): WorkspaceState {
  return {
    ...state,
    sidebarWidth: normalizeSidebarWidth(sidebarWidth)
  };
}

export function setDetailPanelCollapsed(
  state: WorkspaceState,
  detailPanelCollapsed: boolean
): WorkspaceState {
  return {
    ...state,
    detailPanelCollapsed
  };
}

export function setDetailPanelWidth(state: WorkspaceState, detailPanelWidth: number): WorkspaceState {
  return {
    ...state,
    detailPanelWidth: normalizeDetailPanelWidth(detailPanelWidth)
  };
}

export function assignRepositoryProfile(
  state: WorkspaceState,
  repoPath: string,
  assignedProfileId: string | undefined
): WorkspaceState {
  const tabs = state.tabs.map((tab) => {
    if (tab.path !== repoPath) {
      return tab;
    }

    return {
      ...tab,
      assignedProfileId
    };
  });

  return {
    ...state,
    tabs
  };
}

function upsertRecentRepository(
  recentRepos: RecentRepository[],
  repository: RepositorySummary,
  now: string
): RecentRepository[] {
  const nextRecentRepo: RecentRepository = {
    path: repository.path,
    name: repository.name,
    lastOpenedAt: now
  };

  return [
    nextRecentRepo,
    ...recentRepos.filter((recentRepo) => recentRepo.path !== repository.path)
  ].slice(0, MAX_RECENT_REPOS);
}

function isRepoTab(value: unknown): value is RepoTab {
  if (!isRecord(value)) {
    return false;
  }

  return (
    hasString(value, 'id') &&
    hasString(value, 'path') &&
    hasString(value, 'name') &&
    hasString(value, 'gitDir') &&
    hasString(value, 'commonDir') &&
    hasString(value, 'openedAt') &&
    hasString(value, 'lastOpenedAt') &&
    value.viewMode === 'graph' &&
    hasOptionalString(value, 'selectedCommit') &&
    hasOptionalString(value, 'selectedFile') &&
    hasOptionalString(value, 'assignedProfileId')
  );
}

function isRecentRepository(value: unknown): value is RecentRepository {
  return (
    isRecord(value) &&
    hasString(value, 'path') &&
    hasString(value, 'name') &&
    hasString(value, 'lastOpenedAt')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === 'string';
}

function hasOptionalString(value: Record<string, unknown>, key: string): boolean {
  return value[key] === undefined || typeof value[key] === 'string';
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
