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

export type ApplicationUpdateState =
  | {
      status: 'idle';
    }
  | {
      status: 'checking';
    }
  | {
      status: 'downloading';
      releaseName: string;
    }
  | {
      status: 'downloaded';
      releaseName: string;
    }
  | {
      status: 'up-to-date';
      message: string;
    }
  | {
      status: 'error';
      message: string;
    }
  | {
      status: 'manual-update-required';
      message: string;
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

export type GitReviewTarget =
  | {
      kind: 'commit';
      sha: string;
    }
  | {
      kind: 'branch';
      name: string;
      sha: string;
    }
  | {
      kind: 'wip';
      scope: 'all' | 'staged' | 'unstaged';
    };

export type GitReviewChunk = {
  id: string;
  path: string;
  originalPath?: string;
  fileStatus?: GitStatusCode;
  fileContextId?: string;
  patch: string;
  header: string;
  startLine: number;
  additions: number;
  deletions: number;
  role: 'anchor' | 'usage' | 'related';
  relationship: string;
  reviewContext?: string;
  reviewSection: 'storage' | 'definition' | 'api' | 'generated' | 'implementation' | 'tests' | 'translations' | 'other';
  category: 'source' | 'test' | 'spec';
  changeType: 'added' | 'deleted' | 'modified';
  contentKind: 'code' | 'imports';
  source: 'commit' | 'staged' | 'unstaged';
  omittedReason?: 'binary' | 'too-large' | 'no-text';
};

export type GitReviewFileContext = {
  id: string;
  path: string;
  originalPath?: string;
  source: GitReviewChunk['source'];
  oldContents: string;
  newContents: string;
  syntax?: GitReviewSyntaxContext;
};

export type GitReviewTypeDefinitionInput = {
  target: GitReviewTarget;
  sourceFingerprint: string;
  source: GitReviewChunk['source'];
  filePath: string;
  side: 'old' | 'new';
  line: number;
  character: number;
};

export type GitReviewTypeDefinitionResult = {
  name: string;
  path: string;
  kind: 'definition' | 'type-definition';
  declarationKind: string;
  start: number;
  end: number;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  snippetStartLine: number;
  snippetEndLine: number;
  snippet: string;
};

export type GitReviewSyntaxNode = {
  kind: 'declaration' | 'block' | 'member' | 'graphql';
  startLine: number;
  endLine: number;
};

export type GitReviewSyntaxContext = {
  language: 'javascript' | 'jsx' | 'typescript' | 'tsx' | 'graphql';
  oldNodes: GitReviewSyntaxNode[];
  newNodes: GitReviewSyntaxNode[];
  hasErrors: boolean;
};

export type GitReviewUnit = {
  id: string;
  title: string;
  reason: string;
  explanation: string;
  confidence: 'exact' | 'strong' | 'context';
  symbol?: string;
  chunks: GitReviewChunk[];
};

export type GitReviewPlan = {
  repoPath: string;
  target: GitReviewTarget;
  baseSha?: string;
  targetKey: string;
  sourceFingerprint: string;
  units: GitReviewUnit[];
  fileContexts: GitReviewFileContext[];
  reviewedChunkIds: string[];
  loadedAt: string;
};

export type ReviewGroupingBenchmarkSummary = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  expectedUnitCount: number;
  chunkCount: number;
};

export type ReviewGroupingBenchmarkPreview = {
  benchmark: ReviewGroupingBenchmarkSummary;
  expectedPlan: GitReviewPlan;
  actualPlan: GitReviewPlan;
  score: number;
  wronglyMerged: Array<readonly [string, string]>;
  wronglySplit: Array<readonly [string, string]>;
};

export type GitReviewGuidePriority = 'critical' | 'review' | 'skim';

export type GitReviewGuideIssue = {
  summary: string;
  path: string;
  line: number;
  evidence: string;
};

export type GitReviewGuideUnit = {
  unitId: string;
  priority: GitReviewGuidePriority;
  why: string;
  what: string;
  confirmedIssues: GitReviewGuideIssue[];
};

export type GitReviewGuide = {
  sourceFingerprint: string;
  targetKey: string;
  summary: string;
  units: GitReviewGuideUnit[];
  generatedAt: string;
};

export type GitReviewGuideState =
  | {
      status: 'idle';
      sourceFingerprint: string;
    }
  | {
      status: 'running';
      sourceFingerprint: string;
      startedAt: string;
    }
  | {
      status: 'ready';
      sourceFingerprint: string;
      guide: GitReviewGuide;
    }
  | {
      status: 'failed';
      sourceFingerprint: string;
      errorMessage: string;
    };

export type GitReviewProgressUpdate = {
  targetKey: string;
  chunkIds: string[];
  viewed: boolean;
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
  expectedHead?: string;
  messageOnly?: boolean;
};

export type GitPullInput = {
  mode: 'ff-only' | 'rebase';
  expectedBranch?: string;
};

export type GitRemoteCreateInput = {
  name: string;
  fetchUrl: string;
  pushUrl?: string;
};

export type GitRemoteUpdateInput = GitRemoteCreateInput & {
  oldName: string;
};

export type GitPushTarget = {
  remote: string;
  branch: string;
  setUpstream: boolean;
};

export type GitPushInput =
  | {
      forceWithLease: false;
      branch?: string;
      expectedLocalSha?: never;
      target?: never;
    }
  | {
      forceWithLease: false;
      branch: string;
      expectedLocalSha: string;
      target: GitPushTarget;
    }
  | {
      forceWithLease: true;
      branch: string;
      expectedLocalSha: string;
      target: GitPushTarget & {
        expectedSha: string;
      };
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

export type GitSetBranchUpstreamInput = {
  branch: string;
  upstream: string;
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
      kind: 'remote-reset';
      name: string;
      localName: string;
    }
  | {
      kind: 'commit';
      sha: string;
    };

export type GitMergeInput = {
  ref: string;
  expectedCurrentBranch?: string;
};

export type GitTagCreateInput = {
  name: string;
  targetSha?: string;
  annotated?: boolean;
  pushRemote?: string;
};

export type GitTagPushInput = {
  name: string;
  remote: string;
};

export type GitTagDeleteInput =
  | {
      name: string;
      target: 'local';
    }
  | {
      name: string;
      target: 'remote' | 'both';
      remote: string;
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
  expectedCurrentBranch?: string;
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

export type GitConflictFileKind =
  | 'both-modified'
  | 'both-added'
  | 'deleted-by-us'
  | 'deleted-by-them'
  | 'other';

export type GitConflictFileVersion = {
  oid: string;
  shortOid: string;
  mode: string;
  content?: string;
};

export type GitConflictFile = {
  repoPath: string;
  path: string;
  operation?: GitConflictOperation;
  kind: GitConflictFileKind;
  oursLabel: string;
  theirsLabel: string;
  base?: GitConflictFileVersion;
  ours?: GitConflictFileVersion;
  theirs?: GitConflictFileVersion;
  result?: string;
  isBinary: boolean;
  omittedReason?: 'binary' | 'too-large' | 'unsupported-type';
  loadedAt: string;
};

export type GitConflictFileResolutionInput = {
  path: string;
  resolution: 'content' | 'ours' | 'theirs' | 'delete';
  content?: string;
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
  | 'file-diff'
  | 'conflict-file'
  | 'review-plan';

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

export type DiffSyntaxTheme = 'git-gud-dark' | 'tokyo-night-storm';

export type AppSettings = {
  defaultDiffStyle: 'unified' | 'split';
  diffSyntaxTheme: DiffSyntaxTheme;
  autoFetchIntervalMinutes: number;
  graphPageSize: number;
  largeRepoMode: boolean;
  confirmForcePush: boolean;
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

export type GraphWorktree = {
  path: string;
  branch?: string;
  current: boolean;
};

type GraphAuthor = {
  name: string;
  email?: string;
  initials: string;
  color: string;
  avatarUrl?: string;
  fallbackAvatarUrl?: string;
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
  worktree?: GraphWorktree;
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
  pushUrlExplicit?: boolean;
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

export type GitHubRepositorySummary = {
  owner: string;
  name: string;
  fullName: string;
  url: string;
  isPrivate: boolean;
  defaultBranch: string;
};

export type GitHubWorkflowRunStatus =
  | 'queued'
  | 'in-progress'
  | 'completed'
  | 'waiting'
  | 'requested'
  | 'pending'
  | 'unknown';

export type GitHubWorkflowRunConclusion =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'skipped'
  | 'timed-out'
  | 'action-required'
  | 'neutral'
  | 'stale'
  | 'startup-failure'
  | 'unknown';

export type GitHubWorkflowRun = {
  id: number;
  name: string;
  displayTitle: string;
  runNumber: number;
  event: string;
  branch?: string;
  sha: string;
  status: GitHubWorkflowRunStatus;
  conclusion?: GitHubWorkflowRunConclusion;
  url: string;
  actor?: string;
  pullRequestNumbers: number[];
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
};

export type GitHubActionsRunFilters = {
  branches: string[];
  includeTags: boolean;
  includeMyPullRequests: boolean;
};

export type GitHubActionsTileView = 'runs' | 'pull-requests';

export type GitHubActionsRunsInput = {
  profileId: string;
  owner: string;
  repository: string;
  limit: number;
  view: GitHubActionsTileView;
  filters: GitHubActionsRunFilters;
};

export type GitHubWorkflowRunFailureInput = {
  profileId: string;
  owner: string;
  repository: string;
  runId: number;
};

export type GitHubWorkflowStep = {
  number: number;
  name: string;
  status: GitHubWorkflowRunStatus;
  conclusion?: GitHubWorkflowRunConclusion;
  startedAt?: string;
  completedAt?: string;
};

export type GitHubWorkflowJob = {
  id: number;
  name: string;
  dependencyJobIds: number[];
  status: GitHubWorkflowRunStatus;
  conclusion?: GitHubWorkflowRunConclusion;
  url: string;
  startedAt?: string;
  completedAt?: string;
  runnerName?: string;
  labels: string[];
  steps: GitHubWorkflowStep[];
};

export type GitHubWorkflowRunDetail = {
  profileId: string;
  owner: string;
  repository: string;
  runId: number;
  workflowPath?: string;
  dependencyGraphAvailable: boolean;
  totalJobCount: number;
  jobs: GitHubWorkflowJob[];
  loadedAt: string;
};

export type GitHubActionsPullRequestGroup = {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  baseRefName: string;
  updatedAt: string;
  runs: GitHubWorkflowRun[];
};

export type GitHubActionsRuns = {
  profileId: string;
  owner: string;
  repository: string;
  runs: GitHubWorkflowRun[];
  pullRequests: GitHubActionsPullRequestGroup[];
  searchedRunCount: number;
  searchLimitReached: boolean;
  loadedAt: string;
};

export type GitHubActionsDashboardTile = {
  id: string;
  kind: 'github-actions';
  startsNewRow?: boolean;
  owner: string;
  repository: string;
  limit: number;
  view: GitHubActionsTileView;
  filters: GitHubActionsRunFilters;
};

export type GitHubActionsDashboardTileInput = Omit<GitHubActionsDashboardTile, 'id'> & {
  id?: string;
};

export type PortainerConnection = {
  id: string;
  name: string;
  baseUrl: string;
  tlsVerify: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PortainerConnectionInput = {
  id?: string;
  name: string;
  baseUrl: string;
  accessToken?: string;
  tlsVerify: boolean;
};

export type PortainerConnectionTestResult = {
  version?: string;
  environmentCount: number;
  dockerEnvironmentCount: number;
  swarmEnvironmentCount: number;
};

export type PortainerStackSummary = {
  id: number;
  name: string;
  endpointId: number;
  stackType: 'swarm' | 'compose';
  status: 'active' | 'inactive';
};

export type PortainerEnvironmentCatalog = {
  id: number;
  name: string;
  status: 'up' | 'down' | 'unknown';
  imageNotificationsEnabled: boolean;
  stacks: PortainerStackSummary[];
};

export type PortainerStackCatalog = {
  connectionId: string;
  environments: PortainerEnvironmentCatalog[];
  loadedAt: string;
};

export type PortainerStackDashboardTile = {
  id: string;
  kind: 'portainer-swarm-stack';
  startsNewRow?: boolean;
  connectionId: string;
  endpointId: number;
  stackId: number;
  stackName: string;
  environmentName: string;
};

export type PortainerStackDashboardTileInput = Omit<PortainerStackDashboardTile, 'id'> & {
  id?: string;
};

export type DashboardTile = GitHubActionsDashboardTile | PortainerStackDashboardTile;
export type DashboardTileInput =
  | GitHubActionsDashboardTileInput
  | PortainerStackDashboardTileInput;

export type Dashboard = {
  id: string;
  profileId: string;
  name: string;
  tiles: DashboardTile[];
  createdAt: string;
  updatedAt: string;
};

export type DashboardInput = {
  id?: string;
  profileId: string;
  name: string;
  tiles: DashboardTileInput[];
};

export type DashboardState = {
  profileId: string;
  dashboards: Dashboard[];
  selectedDashboardId?: string;
};

export type DashboardActionFailureAlert = {
  id: string;
  profileId: string;
  owner: string;
  repository: string;
  runId: number;
  runNumber: number;
  workflowName: string;
  displayTitle: string;
  branch?: string;
  conclusion: GitHubWorkflowRunConclusion;
  url: string;
  failedAt: string;
  detectedAt: string;
  readAt?: string;
};

export type DashboardActionAlertState = {
  profileId: string;
  alerts: DashboardActionFailureAlert[];
  unreadCount: number;
};

export type PortainerStackStatusInput = {
  connectionId: string;
  endpointId: number;
  stackId: number;
  stackName: string;
};

export type PortainerStackImagesInput = PortainerStackStatusInput & {
  refresh?: boolean;
};

export type PortainerStackHealth =
  | 'healthy'
  | 'updating'
  | 'degraded'
  | 'stopped'
  | 'unavailable';

export type PortainerServiceHealth = 'healthy' | 'updating' | 'degraded' | 'stopped';

export type PortainerServiceRuntime = {
  id: string;
  name: string;
  image: string;
  desiredTasks: number;
  runningTasks: number;
  completedTasks: number;
  health: PortainerServiceHealth;
  runningSince?: string;
  lastError?: string;
};

export type PortainerStackRuntime = {
  connectionId: string;
  endpointId: number;
  stackId: number;
  stackName: string;
  stackType: 'swarm' | 'compose';
  health: PortainerStackHealth;
  desiredTasks: number;
  runningTasks: number;
  completedTasks: number;
  services: PortainerServiceRuntime[];
  portainerUrl: string;
  loadedAt: string;
};

export type PortainerImageFreshness =
  | 'up-to-date'
  | 'update-available'
  | 'checking'
  | 'unknown';

export type PortainerServiceImageStatus = {
  serviceId: string;
  freshness: PortainerImageFreshness;
  message?: string;
};

export type PortainerStackImages = {
  connectionId: string;
  endpointId: number;
  stackId: number;
  services: PortainerServiceImageStatus[];
  loadedAt: string;
};

export type GitHubPullRequestCategory =
  | 'needs-your-review'
  | 'needs-team-review'
  | 'drafts'
  | 'waiting'
  | 'needs-action'
  | 'ready-to-merge';

export type GitHubPullRequestChecks = {
  state: 'success' | 'failure' | 'pending' | 'expected' | 'error' | 'unknown';
  total: number;
  passed: number;
  failed: number;
  pending: number;
};

export type GitHubPullRequestLocator = {
  profileId: string;
  owner: string;
  repository: string;
  number: number;
};

export type GitHubPullRequestReviewer = {
  author: string;
  authorAvatarUrl?: string;
  state: 'approved' | 'changes-requested' | 'pending';
  submittedAt?: string;
};

export type GitHubPullRequestSummary = GitHubPullRequestLocator & {
  id: string;
  title: string;
  url: string;
  author: string;
  authorAvatarUrl?: string;
  updatedAt: string;
  state?: 'open' | 'closed' | 'merged';
  category: GitHubPullRequestCategory;
  isDraft: boolean;
  reviewDecision: 'approved' | 'changes-requested' | 'review-required' | 'unknown';
  mergeState: 'clean' | 'blocked' | 'behind' | 'dirty' | 'unstable' | 'unknown';
  mergeable: 'mergeable' | 'conflicting' | 'unknown';
  canMerge: boolean;
  reviewers: GitHubPullRequestReviewer[];
  comments: number;
  changedFiles: number;
  additions: number;
  deletions: number;
  headRefName: string;
  headRepositoryOwner?: string;
  headRepository?: string;
  headSha?: string;
  baseRefName: string;
  checks: GitHubPullRequestChecks;
};

export type GitHubPullRequestSuggestion = {
  id: string;
  owner: string;
  repository: string;
  branch: string;
  defaultBranch: string;
  headSha: string;
  pushedAt: string;
  compareUrl: string;
};

export type GitHubPullRequestInbox = {
  profileId: string;
  viewerLogin: string;
  host: string;
  pullRequests: GitHubPullRequestSummary[];
  suggestions: GitHubPullRequestSuggestion[];
  suggestionsError?: string;
  loadedAt: string;
};

export type GitHubPullRequestFile = {
  sha: string;
  path: string;
  previousPath?: string;
  status: 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  omittedReason?: 'binary' | 'too-large';
};

export type GitHubPullRequestReviewComment = {
  id: number;
  reviewId?: number;
  body: string;
  author: string;
  authorAvatarUrl?: string;
  url: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  subjectType: 'line' | 'file';
  line?: number;
  side?: 'left' | 'right';
  startLine?: number;
  startSide?: 'left' | 'right';
  inReplyToId?: number;
};

export type GitHubPullRequestConversationComment = {
  id: number;
  body: string;
  author: string;
  authorAvatarUrl?: string;
  url: string;
  createdAt: string;
  updatedAt: string;
};

export type GitHubPullRequestReview = {
  id: number;
  author: string;
  authorAvatarUrl?: string;
  body: string;
  state: 'approved' | 'changes-requested' | 'commented' | 'dismissed' | 'pending' | 'unknown';
  submittedAt?: string;
  url: string;
};

export type GitHubPullRequestCommit = {
  sha: string;
  message: string;
  author: string;
  authorAvatarUrl?: string;
  committedAt: string;
  url: string;
};

export type GitHubPullRequestMergeMethod = 'merge' | 'squash' | 'rebase';

export type GitHubPullRequestConflictInput = {
  baseSha: string;
  headSha: string;
};

export type GitHubPullRequestConflictDetails = {
  files: string[];
  unavailableReason?: string;
};

export type GitHubRepositoryMergeSettings = {
  allowedMethods: GitHubPullRequestMergeMethod[];
  defaultMethod: GitHubPullRequestMergeMethod;
};

export type GitHubPullRequestDetail = GitHubPullRequestSummary & {
  body: string;
  bodyImageUrls?: Record<string, string>;
  headSha: string;
  baseSha: string;
  baseRefSha: string;
  commits: number;
  commitTimeline: GitHubPullRequestCommit[];
  files: GitHubPullRequestFile[];
  reviewPlan: GitReviewPlan;
  mergeSettings: GitHubRepositoryMergeSettings;
  viewerLogin: string;
  reviewComments: GitHubPullRequestReviewComment[];
  conversationComments: GitHubPullRequestConversationComment[];
  reviews: GitHubPullRequestReview[];
  loadedAt: string;
};

export type GitHubPullRequestDraftLineComment = {
  id: string;
  body: string;
  path: string;
  line: number;
  side: 'left' | 'right';
  startLine?: number;
  startSide?: 'left' | 'right';
};

export type GitHubPullRequestDraftFileComment = {
  id: string;
  body: string;
  path: string;
};

export type GitHubPullRequestDraftReply = {
  id: string;
  body: string;
  inReplyToId: number;
};

export type GitHubPullRequestReviewInput = GitHubPullRequestLocator & {
  event: 'comment' | 'approve' | 'request-changes';
  body: string;
  commitId: string;
  comments: GitHubPullRequestDraftLineComment[];
  fileComments: GitHubPullRequestDraftFileComment[];
  replies: GitHubPullRequestDraftReply[];
};

export type GitHubPullRequestReviewCommentUpdateInput = GitHubPullRequestLocator & {
  commentId: number;
  body: string;
};

export type GitHubPullRequestMergeInput = GitHubPullRequestLocator & {
  method: GitHubPullRequestMergeMethod;
};

export type GitHubPullRequestActionResult = {
  message: string;
  merged?: boolean;
  sha?: string;
  submitted?: boolean;
  failedDraftIds?: string[];
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
  lastFetchedAt?: string;
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
