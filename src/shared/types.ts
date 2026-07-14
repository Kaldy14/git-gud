export type RepositorySummary = {
  path: string;
  name: string;
  gitDir: string;
  commonDir: string;
};

type RepoViewMode = 'graph';

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
  activeProfileId?: string;
  tabs: RepoTab[];
  activeTabId?: string;
  recentRepos: RecentRepository[];
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  detailPanelCollapsed: boolean;
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

export type GitFileChangeDetail = {
  path: string;
  originalPath?: string;
  status: GitStatusCode;
  staged: boolean;
  unstaged: boolean;
  conflicted: boolean;
};

export type GitCommitPerson = {
  name: string;
  email?: string;
  date?: string;
  avatarUrl?: string;
};

export type GitCommitStats = {
  filesChanged: number;
  additions: number;
  deletions: number;
};

export type GitCommitDetail = {
  kind: 'commit';
  repoPath: string;
  sha: string;
  shortSha: string;
  parentShas: string[];
  subject: string;
  body: string;
  message: string;
  author: GitCommitPerson;
  committer: GitCommitPerson;
  stats: GitCommitStats;
  files: GitFileChangeDetail[];
  loadedAt: string;
};

export type GitCommitSelectionItem = Pick<
  GitCommitDetail,
  'sha' | 'shortSha' | 'subject' | 'author' | 'committer'
>;

export type GitCommitSelectionDetail = {
  kind: 'selection';
  repoPath: string;
  shas: string[];
  commits: GitCommitSelectionItem[];
  isContiguous: boolean;
  stats: GitCommitStats;
  files: GitFileChangeDetail[];
  loadedAt: string;
};

export type GitWipDetail = {
  kind: 'wip';
  repoPath: string;
  branch: GitBranchState;
  files: GitFileChangeDetail[];
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictedCount: number;
  dirtyCount: number;
  loadedAt: string;
};

export type GitRepositoryDetail = GitCommitDetail | GitCommitSelectionDetail | GitWipDetail;

type GitFileDiffMode = 'commit' | 'selection' | 'wip-staged' | 'wip-unstaged';

export type GitFileDiffRequest =
  | {
      kind: 'commit';
      sha: string;
      path: string;
      originalPath?: string;
    }
  | {
      kind: 'selection';
      shas: string[];
      path: string;
      originalPath?: string;
    }
  | {
      kind: 'wip';
      path: string;
      staged: boolean;
    };

export type GitFileDiffSegment = {
  sha: string;
  shortSha: string;
  subject: string;
  patch: string;
  isBinary: boolean;
  omittedReason?: 'binary' | 'too-large';
};

export type GitFileDiff = {
  repoPath: string;
  path: string;
  originalPath?: string;
  mode: GitFileDiffMode;
  patch: string;
  segments?: GitFileDiffSegment[];
  stageablePatch?: string;
  isBinary: boolean;
  omittedReason?: 'binary' | 'too-large';
  loadedAt: string;
};

export type GitFileHistoryCommit = {
  sha: string;
  shortSha: string;
  subject: string;
  author: GitCommitPerson;
  authoredAt?: string;
};

export type GitFileHistory = {
  repoPath: string;
  path: string;
  commits: GitFileHistoryCommit[];
  loadedAt: string;
};

export type GitFileBlameLine = {
  lineNumber: number;
  originalLineNumber: number;
  sha: string;
  shortSha: string;
  author: GitCommitPerson;
  summary?: string;
  content: string;
};

export type GitFileBlame = {
  repoPath: string;
  path: string;
  revision: string;
  lines: GitFileBlameLine[];
  loadedAt: string;
};

export type GitComparison = {
  repoPath: string;
  base: string;
  head: string;
  ahead: number;
  behind: number;
  stats: GitCommitStats;
  files: GitFileChangeDetail[];
  loadedAt: string;
};

export type GitPatchApplyInput = {
  path: string;
  mode: 'stage' | 'unstage';
  patch: string;
};

export type GitCommitInput = {
  message: string;
  amend: boolean;
};

export type GitPullInput = {
  mode: 'ff-only' | 'rebase';
};

export type GitPushInput = {
  forceWithLease: boolean;
};

export type GitCreateBranchInput = {
  name: string;
  startPoint?: string;
  checkout: boolean;
};

export type GitRenameBranchInput = {
  oldName: string;
  newName: string;
};

export type GitDeleteBranchInput = {
  localName?: string;
  remote?: {
    name: string;
    branch: string;
  };
  force: boolean;
};

export type GitCheckoutTarget =
  | {
      kind: 'local';
      name: string;
    }
  | {
      kind: 'remote';
      name: string;
      localName?: string;
    }
  | {
      kind: 'commit';
      sha: string;
    };

export type GitMergeInput = {
  ref: string;
};

export type GitTagCreateInput = {
  name: string;
  targetSha?: string;
};

export type GitTagDeleteInput = {
  name: string;
};

export type GitStashPushInput = {
  message?: string;
  includeUntracked: boolean;
};

export type GitStashRefInput = {
  selector: string;
  expectedSha: string;
};

export type GitResetInput = {
  target: string;
  mode: 'soft' | 'mixed' | 'hard';
};

export type GitRebaseInput = {
  target: string;
};

export type GitInteractiveRebaseAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop';

export type GitInteractiveRebaseCommit = {
  sha: string;
  shortSha: string;
  subject: string;
  message: string;
};

export type GitInteractiveRebasePlan = {
  repoPath: string;
  base: string;
  baseLabel: string;
  baseShortSha: string;
  branchName: string;
  headSha: string;
  commits: GitInteractiveRebaseCommit[];
  loadedAt: string;
};

export type GitInteractiveRebaseTodoItem = {
  sha: string;
  action: GitInteractiveRebaseAction;
  message?: string;
};

export type GitInteractiveRebaseInput = {
  base: string;
  commits: GitInteractiveRebaseTodoItem[];
};

export type GitConflictActionInput = {
  action: 'continue' | 'skip' | 'abort';
};

export type GitConflictOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'unknown';

export type GitConflictState = {
  isActive: boolean;
  operation?: GitConflictOperation;
  files: GitFileChangeDetail[];
  canContinue: boolean;
  canSkip: boolean;
  canAbort: boolean;
  message?: string;
};

type GitOperationSummary = {
  id: string;
  label: string;
  status: 'completed' | 'conflicted';
  message?: string;
};

export type GitQueryInvalidation =
  | 'overview'
  | 'graph'
  | 'wip-detail'
  | 'file-diff';

export type GitUndoOperation =
  | 'commit'
  | 'amend'
  | 'branch-create'
  | 'branch-delete'
  | 'branch-rename'
  | 'checkout'
  | 'merge'
  | 'reset'
  | 'tag-create'
  | 'tag-delete';

export type GitUndoEntry = {
  id: string;
  repoPath: string;
  operation: GitUndoOperation;
  label: string;
  createdAt: string;
  requiresConfirmation: boolean;
  staleReason?: string;
  refName?: string;
  refNameAfter?: string;
  upstream?: string;
  targetSha?: string;
  headBefore?: string;
  headAfter?: string;
  branchBefore?: string;
  branchAfter?: string;
  resetMode?: GitResetInput['mode'];
  affectedRefs?: string[];
  affectedPaths?: string[];
  warning?: string;
};

export type GitOperationResult = {
  repoPath: string;
  happenedAt: string;
  operation?: GitOperationSummary;
  undoEntry?: GitUndoEntry;
  conflictState?: GitConflictState;
  invalidates?: GitQueryInvalidation[];
};

export type GitOperationProgressEvent = {
  operationId: string;
  repoPath: string;
  label: string;
  phase: 'queued' | 'running' | 'output' | 'completed' | 'failed' | 'cancelled';
  stream?: 'stdout' | 'stderr';
  message?: string;
  elapsedMs: number;
  cancellable: boolean;
  happenedAt: string;
};

export type GitOperationCancellationResult = {
  repoPath: string;
  cancelled: boolean;
  message: string;
};

export type AppSettings = {
  defaultDiffStyle: 'unified' | 'split';
  graphPageSize: number;
  largeRepoMode: boolean;
  graphColumns: {
    author: boolean;
    date: boolean;
    sha: boolean;
  };
  remoteAvatars: boolean;
};

export type AppSettingsInput = Partial<Omit<AppSettings, 'graphColumns'>> & {
  graphColumns?: Partial<AppSettings['graphColumns']>;
};

export type GraphNodeKind = 'commit' | 'merge' | 'wip' | 'stash';

type RefChipKind = 'branch' | 'remote' | 'tag' | 'stash' | 'wip';

export type GraphRefChip = {
  label: string;
  kind: RefChipKind;
  current?: boolean;
};

export type GraphRailStyle = {
  color?: string;
  dashed?: boolean;
};

export type GraphRailSegment = GraphRailStyle &
  (
    | { type: 'through'; lane: number }
    | { type: 'stopTop'; lane: number }
    | { type: 'startBottom'; lane: number }
    | { type: 'curveIn'; from: number; to: number }
    | { type: 'curveOut'; from: number; to: number }
  );

export type GraphFileStatus = 'modified' | 'added' | 'deleted';

export type GraphFile = {
  path: string;
  status: GraphFileStatus;
};

type GraphAuthor = {
  name: string;
  email?: string;
  initials: string;
  color: string;
  avatarUrl?: string;
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
  githubLogin?: string;
  githubHost?: string;
  signingKey?: string;
  remoteUrlPatterns?: string[];
};

export type GitHubCliAccount = {
  login: string;
  host: string;
  configDir: string;
  gitProtocol: string;
};

type GitIdentitySource = 'profile' | 'repo-config' | 'global-config' | 'unknown';

export type GitIdentity = {
  name?: string;
  email?: string;
  source: GitIdentitySource;
};

export type RepoProfileState = {
  profiles: GitProfile[];
  activeProfile?: GitProfile;
  suggestedProfile?: GitProfile;
  effectiveIdentity: GitIdentity;
  identityMatchesActiveProfile?: boolean;
};

export type GitRepositoryOverview = {
  repoPath: string;
  loadedAt: string;
  status: GitStatusSummary;
  conflictState: GitConflictState;
  refs: GitRefsSummary;
  remotes: GitRemote[];
  worktrees: GitWorktree[];
  stashes: GitStashEntry[];
  profileState: RepoProfileState;
  latestUndo?: GitUndoEntry;
};

export type RepoChangedEvent = {
  repoPath: string;
  reason: 'git-dir' | 'common-dir' | 'worktree';
  reasons: Array<'git-dir' | 'common-dir' | 'worktree'>;
  path?: string;
  paths: string[];
  happenedAt: string;
};
