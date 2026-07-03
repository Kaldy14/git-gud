import type { CommitGraphPage, GitProfile, GitRepositoryOverview, RepoChangedEvent, WorkspaceState } from './types';

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
  setSidebarCollapsed: (collapsed: boolean) => Promise<WorkspaceState>;
  getRepositoryOverview: (repoPath: string) => Promise<GitRepositoryOverview>;
  getCommitGraph: (repoPath: string, limit?: number) => Promise<CommitGraphPage>;
  listProfiles: () => Promise<GitProfile[]>;
  saveProfile: (profile: GitProfile) => Promise<GitProfile[]>;
  assignProfile: (repoPath: string, profileId: string | undefined) => Promise<WorkspaceState>;
  onRepositoryChanged: (listener: (event: RepoChangedEvent) => void) => () => void;
};
