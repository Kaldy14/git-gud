import type {
  CommitGraphPage,
  GitCommitDetail,
  GitCommitInput,
  GitFileDiff,
  GitFileDiffRequest,
  GitOperationResult,
  GitProfile,
  GitRepositoryOverview,
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
  listProfiles: () => Promise<GitProfile[]>;
  saveProfile: (profile: GitProfile) => Promise<GitProfile[]>;
  assignProfile: (repoPath: string, profileId: string | undefined) => Promise<WorkspaceState>;
  onRepositoryChanged: (listener: (event: RepoChangedEvent) => void) => () => void;
};
