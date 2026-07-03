import type { RecentRepository, RepoTab, RepositorySummary, WorkspaceState } from './types';

const MAX_RECENT_REPOS = 12;

export function createDefaultWorkspaceState(): WorkspaceState {
  return {
    tabs: [],
    recentRepos: [],
    sidebarCollapsed: false,
    sidebarWidth: 282,
    detailPanelWidth: 382
  };
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
      selectedCommit
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
