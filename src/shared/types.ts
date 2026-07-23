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
  targetKey: string;
  sourceFingerprint: string;
  units: GitReviewUnit[];
  fileContexts: GitReviewFileContext[];
  reviewedChunkIds: string[];
  loadedAt: string;
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
};

export type GitTagCreateInput = {
  name: string;
  targetSha?: string;
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

export type GitHubPullRequestSummary = GitHubPullRequestLocator & {
  id: string;
  title: string;
  url: string;
  author: string;
  authorAvatarUrl?: string;
  updatedAt: string;
  category: GitHubPullRequestCategory;
  isDraft: boolean;
  reviewDecision: 'approved' | 'changes-requested' | 'review-required' | 'unknown';
  mergeState: 'clean' | 'blocked' | 'behind' | 'dirty' | 'unstable' | 'unknown';
  mergeable: 'mergeable' | 'conflicting' | 'unknown';
  canMerge: boolean;
  comments: number;
  changedFiles: number;
  additions: number;
  deletions: number;
  headRefName: string;
  baseRefName: string;
  checks: GitHubPullRequestChecks;
};

export type GitHubPullRequestInbox = {
  profileId: string;
  viewerLogin: string;
  host: string;
  pullRequests: GitHubPullRequestSummary[];
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
  body: string;
  author: string;
  authorAvatarUrl?: string;
  url: string;
  path: string;
  createdAt: string;
  updatedAt: string;
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

export type GitHubPullRequestMergeMethod = 'merge' | 'squash' | 'rebase';

export type GitHubRepositoryMergeSettings = {
  allowedMethods: GitHubPullRequestMergeMethod[];
  defaultMethod: GitHubPullRequestMergeMethod;
};

export type GitHubPullRequestDetail = GitHubPullRequestSummary & {
  body: string;
  headSha: string;
  baseSha: string;
  commits: number;
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
  replies: GitHubPullRequestDraftReply[];
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
