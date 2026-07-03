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

export type GitStatusCode =
  | 'unmodified'
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'ignored'
  | 'conflicted';

export type GitBranchState = {
  head: string;
  oid?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  isDetached: boolean;
};

export type GitFileChange = {
  path: string;
  originalPath?: string;
  indexStatus: GitStatusCode;
  worktreeStatus: GitStatusCode;
  status: GitStatusCode;
  staged: boolean;
  unstaged: boolean;
  conflicted: boolean;
};

export type GitStatusSummary = {
  branch: GitBranchState;
  files: GitFileChange[];
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictedCount: number;
  dirtyCount: number;
  isDirty: boolean;
};

export type GitBranchRef = {
  name: string;
  fullName: string;
  sha: string;
  current: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
};

export type GitRemoteBranchRef = {
  name: string;
  fullName: string;
  sha: string;
  remote: string;
};

export type GitTagRef = {
  name: string;
  fullName: string;
  sha: string;
  date?: string;
};

export type GitRefsSummary = {
  localBranches: GitBranchRef[];
  remoteBranches: GitRemoteBranchRef[];
  tags: GitTagRef[];
};

export type GitRemote = {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
};

export type GitWorktree = {
  path: string;
  head?: string;
  branch?: string;
  detached: boolean;
  bare: boolean;
  current: boolean;
};

export type GitStashEntry = {
  selector: string;
  sha: string;
  parentShas: string[];
  date?: string;
  subject: string;
};

export type GitProfile = {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  sshKeyPath?: string;
  ghConfigDir?: string;
  signingKey?: string;
  remoteUrlPatterns?: string[];
};

export type GitIdentitySource = 'profile' | 'repo-config' | 'global-config' | 'unknown';

export type GitIdentity = {
  name?: string;
  email?: string;
  source: GitIdentitySource;
};

export type RepoProfileState = {
  profiles: GitProfile[];
  activeProfile?: GitProfile;
  effectiveIdentity: GitIdentity;
};

export type GitRepositoryOverview = {
  repoPath: string;
  loadedAt: string;
  status: GitStatusSummary;
  refs: GitRefsSummary;
  remotes: GitRemote[];
  worktrees: GitWorktree[];
  stashes: GitStashEntry[];
  profileState: RepoProfileState;
};

export type RepoChangedEvent = {
  repoPath: string;
  reason: 'git-dir' | 'common-dir' | 'worktree';
  path?: string;
  happenedAt: string;
};
