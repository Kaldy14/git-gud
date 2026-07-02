export type RepositorySummary = {
  path: string;
  name: string;
  gitDir: string;
  commonDir: string;
};

export type RepoViewMode = 'graph';

export type RepoTab = RepositorySummary & {
  id: string;
  openedAt: string;
  lastOpenedAt: string;
  selectedCommit?: string;
  selectedFile?: string;
  assignedProfileId?: string;
  viewMode: RepoViewMode;
};

export type RecentRepository = {
  path: string;
  name: string;
  lastOpenedAt: string;
};

export type WorkspaceState = {
  tabs: RepoTab[];
  activeTabId?: string;
  recentRepos: RecentRepository[];
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  detailPanelWidth: number;
};
