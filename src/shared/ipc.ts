import type {
  CommitGraphPage,
  GitCommitDetail,
  GitCommitInput,
  GitCheckoutTarget,
  GitConflictActionInput,
  GitCreateBranchInput,
  GitDeleteBranchInput,
  GitFileDiff,
  GitFileDiffRequest,
  GitInteractiveRebaseInput,
  GitInteractiveRebasePlan,
  GitMergeInput,
  GitOperationResult,
  GitPullInput,
  GitProfile,
  GitPushInput,
  GitRebaseInput,
  GitRepositoryOverview,
  GitRenameBranchInput,
  GitResetInput,
  GitStashPushInput,
  GitStashRefInput,
  GitTagCreateInput,
  GitTagDeleteInput,
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
  'repo:wip-detail': {
    args: [repoPath: string];
    result: GitWipDetail;
  };
  'repo:file-diff': {
    args: [repoPath: string, request: GitFileDiffRequest];
    result: GitFileDiff;
  };
  'repo:stage-file': {
    args: [repoPath: string, path: string];
    result: GitOperationResult;
  };
  'repo:unstage-file': {
    args: [repoPath: string, path: string];
    result: GitOperationResult;
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
    args: [repoPath: string, sha: string];
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
  'repo:undo': {
    args: [repoPath: string, undoId: string];
    result: GitOperationResult;
  };
  'profiles:list': {
    args: [];
    result: GitProfile[];
  };
  'profiles:save': {
    args: [profile: GitProfile];
    result: GitProfile[];
  };
  'repo:assign-profile': {
    args: [repoPath: string, profileId: string | undefined];
    result: WorkspaceState;
  };
};

export type IpcChannelName = keyof IpcChannelMap;

export type RendererEventMap = {
  'repo:changed': RepoChangedEvent;
};

export type RendererEventName = keyof RendererEventMap;

export type RendererApi = {
  getWorkspace: () => Promise<WorkspaceState>;
  openRepository: () => Promise<WorkspaceState | null>;
  openRepositoryAtPath: (repoPath: string) => Promise<WorkspaceState>;
  activateTab: (tabId: string) => Promise<WorkspaceState>;
  closeTab: (tabId: string) => Promise<WorkspaceState>;
  selectCommit: (tabId: string, selectedCommit: string | undefined) => Promise<WorkspaceState>;
  selectFile: (tabId: string, selectedFile: string | undefined) => Promise<WorkspaceState>;
  setSidebarCollapsed: (collapsed: boolean) => Promise<WorkspaceState>;
  getRepositoryOverview: (repoPath: string) => Promise<GitRepositoryOverview>;
  getCommitGraph: (repoPath: string, limit?: number) => Promise<CommitGraphPage>;
  getCommitDetail: (repoPath: string, sha: string) => Promise<GitCommitDetail>;
  getWipDetail: (repoPath: string) => Promise<GitWipDetail>;
  getFileDiff: (repoPath: string, request: GitFileDiffRequest) => Promise<GitFileDiff>;
  stageFile: (repoPath: string, path: string) => Promise<GitOperationResult>;
  unstageFile: (repoPath: string, path: string) => Promise<GitOperationResult>;
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
  deleteTag: (repoPath: string, input: GitTagDeleteInput) => Promise<GitOperationResult>;
  stashPush: (repoPath: string, input: GitStashPushInput) => Promise<GitOperationResult>;
  stashApply: (repoPath: string, input: GitStashRefInput) => Promise<GitOperationResult>;
  stashPop: (repoPath: string, input: GitStashRefInput) => Promise<GitOperationResult>;
  stashDrop: (repoPath: string, input: GitStashRefInput) => Promise<GitOperationResult>;
  cherryPick: (repoPath: string, sha: string) => Promise<GitOperationResult>;
  revertCommit: (repoPath: string, sha: string) => Promise<GitOperationResult>;
  resetToCommit: (repoPath: string, input: GitResetInput) => Promise<GitOperationResult>;
  rebaseOnto: (repoPath: string, input: GitRebaseInput) => Promise<GitOperationResult>;
  getInteractiveRebasePlan: (repoPath: string, base: string) => Promise<GitInteractiveRebasePlan>;
  runInteractiveRebase: (repoPath: string, input: GitInteractiveRebaseInput) => Promise<GitOperationResult>;
  resolveConflict: (repoPath: string, input: GitConflictActionInput) => Promise<GitOperationResult>;
  undoOperation: (repoPath: string, undoId: string) => Promise<GitOperationResult>;
  listProfiles: () => Promise<GitProfile[]>;
  saveProfile: (profile: GitProfile) => Promise<GitProfile[]>;
  assignProfile: (repoPath: string, profileId: string | undefined) => Promise<WorkspaceState>;
  onRepositoryChanged: (listener: (event: RepoChangedEvent) => void) => () => void;
};
