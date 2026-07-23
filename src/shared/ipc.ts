import type {
  AppSettings,
  AppSettingsInput,
  CommitGraphPage,
  GitCommitDetail,
  GitCommitSelectionDetail,
  GitCommitInput,
  GitCheckoutTarget,
  GitConflictActionInput,
  GitConflictFile,
  GitConflictFileResolutionInput,
  GitCreateBranchInput,
  GitDeleteBranchInput,
  GitFileDiff,
  GitFileDiffRequest,
  GitFileBlame,
  GitFileHistory,
  GitComparison,
  GitInteractiveRebaseInput,
  GitInteractiveRebasePlan,
  GitMergeInput,
  GitOperationResult,
  GitOperationCancellationResult,
  GitOperationProgressEvent,
  GitPatchApplyInput,
  GitPullInput,
  GitHubCliAccount,
  GitHubPullRequestActionResult,
  GitHubPullRequestDetail,
  GitHubPullRequestInbox,
  GitHubPullRequestLocator,
  GitHubPullRequestMergeInput,
  GitHubPullRequestReviewInput,
  GitProfile,
  GitPushInput,
  GitRebaseInput,
  GitRepositoryOverview,
  GitReviewPlan,
  GitReviewProgressUpdate,
  GitReviewTarget,
  GitRenameBranchInput,
  GitResetInput,
  GitStashPushInput,
  GitStashRefInput,
  GitTagCreateInput,
  GitTagDeleteInput,
  GitTagPushInput,
  GitWipDetail,
  RepoChangedEvent,
  WorkspaceState
} from './types';

export type IpcChannelMap = {
  'workspace:get': {
    args: [];
    result: WorkspaceState;
  };
  'repo:open-dialog': {
    args: [];
    result: WorkspaceState | null;
  };
  'repo:open-path': {
    args: [repoPath: string];
    result: WorkspaceState;
  };
  'repo:replace-path': {
    args: [tabId: string, repoPath: string];
    result: WorkspaceState;
  };
  'tabs:activate': {
    args: [tabId: string];
    result: WorkspaceState;
  };
  'tabs:close': {
    args: [tabId: string];
    result: WorkspaceState;
  };
  'tabs:select-commit': {
    args: [tabId: string, selectedCommit: string | undefined];
    result: WorkspaceState;
  };
  'tabs:select-file': {
    args: [tabId: string, selectedFile: string | undefined];
    result: WorkspaceState;
  };
  'workspace:set-sidebar-collapsed': {
    args: [collapsed: boolean];
    result: WorkspaceState;
  };
  'workspace:set-sidebar-width': {
    args: [width: number];
    result: WorkspaceState;
  };
  'workspace:set-detail-panel-collapsed': {
    args: [collapsed: boolean];
    result: WorkspaceState;
  };
  'workspace:set-detail-panel-width': {
    args: [width: number];
    result: WorkspaceState;
  };
  'repo:overview': {
    args: [repoPath: string];
    result: GitRepositoryOverview;
  };
  'repo:graph': {
    args: [repoPath: string, limit?: number];
    result: CommitGraphPage;
  };
  'repo:commit-detail': {
    args: [repoPath: string, sha: string];
    result: GitCommitDetail;
  };
  'repo:commit-selection-detail': {
    args: [repoPath: string, shas: string[]];
    result: GitCommitSelectionDetail;
  };
  'repo:wip-detail': {
    args: [repoPath: string];
    result: GitWipDetail;
  };
  'repo:file-diff': {
    args: [repoPath: string, request: GitFileDiffRequest];
    result: GitFileDiff;
  };
  'repo:review-plan': {
    args: [repoPath: string, target: GitReviewTarget];
    result: GitReviewPlan;
  };
  'repo:set-review-progress': {
    args: [repoPath: string, update: GitReviewProgressUpdate];
    result: string[];
  };
  'repo:file-history': {
    args: [repoPath: string, path: string, limit?: number];
    result: GitFileHistory;
  };
  'repo:file-blame': {
    args: [repoPath: string, path: string, revision?: string];
    result: GitFileBlame;
  };
  'repo:compare': {
    args: [repoPath: string, base: string, head: string];
    result: GitComparison;
  };
  'repo:apply-patch': {
    args: [repoPath: string, input: GitPatchApplyInput];
    result: GitOperationResult;
  };
  'repo:stage-file': {
    args: [repoPath: string, path: string];
    result: GitOperationResult;
  };
  'repo:unstage-file': {
    args: [repoPath: string, path: string];
    result: GitOperationResult;
  };
  'repo:discard-file': {
    args: [repoPath: string, path: string];
    result: GitOperationResult;
  };
  'repo:discard-all': {
    args: [repoPath: string];
    result: GitOperationResult;
  };
  'repo:open-file': {
    args: [repoPath: string, path: string];
    result: GitOperationResult;
  };
  'repo:reveal-file': {
    args: [repoPath: string, path: string];
    result: GitOperationResult;
  };
  'system:open-codex-task': {
    args: [repoPath: string, prompt: string];
    result: void;
  };
  'repo:stage-all': {
    args: [repoPath: string];
    result: GitOperationResult;
  };
  'repo:unstage-all': {
    args: [repoPath: string];
    result: GitOperationResult;
  };
  'repo:commit': {
    args: [repoPath: string, input: GitCommitInput];
    result: GitOperationResult;
  };
  'repo:fetch': {
    args: [repoPath: string];
    result: GitOperationResult;
  };
  'repo:pull': {
    args: [repoPath: string, input: GitPullInput];
    result: GitOperationResult;
  };
  'repo:push': {
    args: [repoPath: string, input: GitPushInput];
    result: GitOperationResult;
  };
  'repo:create-branch': {
    args: [repoPath: string, input: GitCreateBranchInput];
    result: GitOperationResult;
  };
  'repo:rename-branch': {
    args: [repoPath: string, input: GitRenameBranchInput];
    result: GitOperationResult;
  };
  'repo:delete-branch': {
    args: [repoPath: string, input: GitDeleteBranchInput];
    result: GitOperationResult;
  };
  'repo:checkout': {
    args: [repoPath: string, target: GitCheckoutTarget];
    result: GitOperationResult;
  };
  'repo:merge': {
    args: [repoPath: string, input: GitMergeInput];
    result: GitOperationResult;
  };
  'repo:create-tag': {
    args: [repoPath: string, input: GitTagCreateInput];
    result: GitOperationResult;
  };
  'repo:push-tag': {
    args: [repoPath: string, input: GitTagPushInput];
    result: GitOperationResult;
  };
  'repo:delete-tag': {
    args: [repoPath: string, input: GitTagDeleteInput];
    result: GitOperationResult;
  };
  'repo:stash-push': {
    args: [repoPath: string, input: GitStashPushInput];
    result: GitOperationResult;
  };
  'repo:stash-apply': {
    args: [repoPath: string, input: GitStashRefInput];
    result: GitOperationResult;
  };
  'repo:stash-pop': {
    args: [repoPath: string, input: GitStashRefInput];
    result: GitOperationResult;
  };
  'repo:stash-drop': {
    args: [repoPath: string, input: GitStashRefInput];
    result: GitOperationResult;
  };
  'repo:cherry-pick': {
    args: [repoPath: string, shas: string[]];
    result: GitOperationResult;
  };
  'repo:revert': {
    args: [repoPath: string, sha: string];
    result: GitOperationResult;
  };
  'repo:reset': {
    args: [repoPath: string, input: GitResetInput];
    result: GitOperationResult;
  };
  'repo:rebase': {
    args: [repoPath: string, input: GitRebaseInput];
    result: GitOperationResult;
  };
  'repo:interactive-rebase-plan': {
    args: [repoPath: string, base: string];
    result: GitInteractiveRebasePlan;
  };
  'repo:interactive-rebase': {
    args: [repoPath: string, input: GitInteractiveRebaseInput];
    result: GitOperationResult;
  };
  'repo:resolve-conflict': {
    args: [repoPath: string, input: GitConflictActionInput];
    result: GitOperationResult;
  };
  'repo:conflict-file': {
    args: [repoPath: string, path: string];
    result: GitConflictFile;
  };
  'repo:resolve-conflict-file': {
    args: [repoPath: string, input: GitConflictFileResolutionInput];
    result: GitOperationResult;
  };
  'repo:undo': {
    args: [repoPath: string, undoId: string];
    result: GitOperationResult;
  };
  'repo:cancel-operation': {
    args: [repoPath: string, operationId: string];
    result: GitOperationCancellationResult;
  };
  'settings:get': {
    args: [];
    result: AppSettings;
  };
  'settings:update': {
    args: [settings: AppSettingsInput];
    result: AppSettings;
  };
  'profiles:list': {
    args: [];
    result: GitProfile[];
  };
  'profiles:list-github-accounts': {
    args: [];
    result: GitHubCliAccount[];
  };
  'github:pull-request-inbox': {
    args: [profileId: string];
    result: GitHubPullRequestInbox;
  };
  'github:pull-request-detail': {
    args: [locator: GitHubPullRequestLocator];
    result: GitHubPullRequestDetail;
  };
  'github:submit-pull-request-review': {
    args: [input: GitHubPullRequestReviewInput];
    result: GitHubPullRequestActionResult;
  };
  'github:merge-pull-request': {
    args: [input: GitHubPullRequestMergeInput];
    result: GitHubPullRequestActionResult;
  };
  'profiles:save': {
    args: [profile: GitProfile];
    result: GitProfile[];
  };
  'profiles:activate': {
    args: [profileId: string | undefined];
    result: WorkspaceState;
  };
  'repo:assign-profile': {
    args: [repoPath: string, profileId: string | undefined];
    result: WorkspaceState;
  };
};

export type IpcChannelName = keyof IpcChannelMap;

export type RendererApi = {
  getWorkspace: () => Promise<WorkspaceState>;
  openRepository: () => Promise<WorkspaceState | null>;
  openRepositoryAtPath: (repoPath: string) => Promise<WorkspaceState>;
  replaceRepositoryAtPath: (tabId: string, repoPath: string) => Promise<WorkspaceState>;
  activateTab: (tabId: string) => Promise<WorkspaceState>;
  closeTab: (tabId: string) => Promise<WorkspaceState>;
  selectCommit: (tabId: string, selectedCommit: string | undefined) => Promise<WorkspaceState>;
  selectFile: (tabId: string, selectedFile: string | undefined) => Promise<WorkspaceState>;
  setSidebarCollapsed: (collapsed: boolean) => Promise<WorkspaceState>;
  setSidebarWidth: (width: number) => Promise<WorkspaceState>;
  setDetailPanelCollapsed: (collapsed: boolean) => Promise<WorkspaceState>;
  setDetailPanelWidth: (width: number) => Promise<WorkspaceState>;
  getRepositoryOverview: (repoPath: string) => Promise<GitRepositoryOverview>;
  getCommitGraph: (repoPath: string, limit?: number) => Promise<CommitGraphPage>;
  getCommitDetail: (repoPath: string, sha: string) => Promise<GitCommitDetail>;
  getCommitSelectionDetail: (repoPath: string, shas: string[]) => Promise<GitCommitSelectionDetail>;
  getWipDetail: (repoPath: string) => Promise<GitWipDetail>;
  getFileDiff: (repoPath: string, request: GitFileDiffRequest) => Promise<GitFileDiff>;
  getReviewPlan: (repoPath: string, target: GitReviewTarget) => Promise<GitReviewPlan>;
  setReviewProgress: (repoPath: string, update: GitReviewProgressUpdate) => Promise<string[]>;
  getFileHistory: (repoPath: string, path: string, limit?: number) => Promise<GitFileHistory>;
  getFileBlame: (repoPath: string, path: string, revision?: string) => Promise<GitFileBlame>;
  compareRefs: (repoPath: string, base: string, head: string) => Promise<GitComparison>;
  applyWipPatch: (repoPath: string, input: GitPatchApplyInput) => Promise<GitOperationResult>;
  stageFile: (repoPath: string, path: string) => Promise<GitOperationResult>;
  unstageFile: (repoPath: string, path: string) => Promise<GitOperationResult>;
  discardFile: (repoPath: string, path: string) => Promise<GitOperationResult>;
  discardAllChanges: (repoPath: string) => Promise<GitOperationResult>;
  openFile: (repoPath: string, path: string) => Promise<GitOperationResult>;
  revealFile: (repoPath: string, path: string) => Promise<GitOperationResult>;
  openCodexTask: (repoPath: string, prompt: string) => Promise<void>;
  stageAll: (repoPath: string) => Promise<GitOperationResult>;
  unstageAll: (repoPath: string) => Promise<GitOperationResult>;
  commitChanges: (repoPath: string, input: GitCommitInput) => Promise<GitOperationResult>;
  fetchRepository: (repoPath: string) => Promise<GitOperationResult>;
  pullRepository: (repoPath: string, input: GitPullInput) => Promise<GitOperationResult>;
  pushRepository: (repoPath: string, input: GitPushInput) => Promise<GitOperationResult>;
  createBranch: (repoPath: string, input: GitCreateBranchInput) => Promise<GitOperationResult>;
  renameBranch: (repoPath: string, input: GitRenameBranchInput) => Promise<GitOperationResult>;
  deleteBranch: (repoPath: string, input: GitDeleteBranchInput) => Promise<GitOperationResult>;
  checkoutRef: (repoPath: string, target: GitCheckoutTarget) => Promise<GitOperationResult>;
  mergeRef: (repoPath: string, input: GitMergeInput) => Promise<GitOperationResult>;
  createTag: (repoPath: string, input: GitTagCreateInput) => Promise<GitOperationResult>;
  pushTag: (repoPath: string, input: GitTagPushInput) => Promise<GitOperationResult>;
  deleteTag: (repoPath: string, input: GitTagDeleteInput) => Promise<GitOperationResult>;
  stashPush: (repoPath: string, input: GitStashPushInput) => Promise<GitOperationResult>;
  stashApply: (repoPath: string, input: GitStashRefInput) => Promise<GitOperationResult>;
  stashPop: (repoPath: string, input: GitStashRefInput) => Promise<GitOperationResult>;
  stashDrop: (repoPath: string, input: GitStashRefInput) => Promise<GitOperationResult>;
  cherryPick: (repoPath: string, shas: string[]) => Promise<GitOperationResult>;
  revertCommit: (repoPath: string, sha: string) => Promise<GitOperationResult>;
  resetToCommit: (repoPath: string, input: GitResetInput) => Promise<GitOperationResult>;
  rebaseOnto: (repoPath: string, input: GitRebaseInput) => Promise<GitOperationResult>;
  getInteractiveRebasePlan: (repoPath: string, base: string) => Promise<GitInteractiveRebasePlan>;
  runInteractiveRebase: (repoPath: string, input: GitInteractiveRebaseInput) => Promise<GitOperationResult>;
  resolveConflict: (repoPath: string, input: GitConflictActionInput) => Promise<GitOperationResult>;
  getConflictFile: (repoPath: string, path: string) => Promise<GitConflictFile>;
  resolveConflictFile: (repoPath: string, input: GitConflictFileResolutionInput) => Promise<GitOperationResult>;
  undoOperation: (repoPath: string, undoId: string) => Promise<GitOperationResult>;
  cancelRepositoryOperation: (repoPath: string, operationId: string) => Promise<GitOperationCancellationResult>;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (settings: AppSettingsInput) => Promise<AppSettings>;
  listProfiles: () => Promise<GitProfile[]>;
  listGitHubAccounts: () => Promise<GitHubCliAccount[]>;
  getGitHubPullRequestInbox: (profileId: string) => Promise<GitHubPullRequestInbox>;
  getGitHubPullRequestDetail: (locator: GitHubPullRequestLocator) => Promise<GitHubPullRequestDetail>;
  submitGitHubPullRequestReview: (input: GitHubPullRequestReviewInput) => Promise<GitHubPullRequestActionResult>;
  mergeGitHubPullRequest: (input: GitHubPullRequestMergeInput) => Promise<GitHubPullRequestActionResult>;
  saveProfile: (profile: GitProfile) => Promise<GitProfile[]>;
  activateProfile: (profileId: string | undefined) => Promise<WorkspaceState>;
  assignProfile: (repoPath: string, profileId: string | undefined) => Promise<WorkspaceState>;
  onRepositoryChanged: (listener: (event: RepoChangedEvent) => void) => () => void;
  onOperationProgress: (listener: (event: GitOperationProgressEvent) => void) => () => void;
};
