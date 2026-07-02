import type { WorkspaceState } from './types';

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
  'workspace:set-sidebar-collapsed': {
    args: [collapsed: boolean];
    result: WorkspaceState;
  };
};

export type IpcChannelName = keyof IpcChannelMap;

export type RendererApi = {
  getWorkspace: () => Promise<WorkspaceState>;
  openRepository: () => Promise<WorkspaceState | null>;
  openRepositoryAtPath: (repoPath: string) => Promise<WorkspaceState>;
  activateTab: (tabId: string) => Promise<WorkspaceState>;
  closeTab: (tabId: string) => Promise<WorkspaceState>;
  setSidebarCollapsed: (collapsed: boolean) => Promise<WorkspaceState>;
};
