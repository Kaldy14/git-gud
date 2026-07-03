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

export type GraphNodeKind = 'commit' | 'merge' | 'wip' | 'stash';

export type RefChipKind = 'branch' | 'remote' | 'tag' | 'stash' | 'wip';

export type GraphRefChip = {
  label: string;
  kind: RefChipKind;
};

export type GraphRailSegment =
  | { type: 'through'; lane: number }
  | { type: 'stopTop'; lane: number }
  | { type: 'startBottom'; lane: number }
  | { type: 'curveIn'; from: number; to: number }
  | { type: 'curveOut'; from: number; to: number };

export type GraphFileStatus = 'modified' | 'added' | 'deleted';

export type GraphFile = {
  path: string;
  status: GraphFileStatus;
};

export type GraphAuthor = {
  name: string;
  email?: string;
  initials: string;
  color: string;
};

export type CommitGraphRow = {
  sha: string;
  parentShas: string[];
  subject: string;
  body?: string;
  author: GraphAuthor;
  authoredAt?: string;
  committedAt?: string;
  dateLabel: string;
  node: { lane: number; kind: GraphNodeKind };
  colorOverride?: string;
  rails: GraphRailSegment[];
  refs?: GraphRefChip[];
  dateMarker?: string;
  files: GraphFile[];
};

export type CommitGraphPage = {
  repoPath: string;
  loadedAt: string;
  rows: CommitGraphRow[];
  limit: number;
  loadedCommitCount: number;
  hasMore: boolean;
  nextLimit: number;
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
  reasons: Array<'git-dir' | 'common-dir' | 'worktree'>;
  path?: string;
  paths: string[];
  happenedAt: string;
};
