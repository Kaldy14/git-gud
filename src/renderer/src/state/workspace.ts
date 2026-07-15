import { create } from 'zustand';

import type { WorkspaceState } from '@shared/types';
import {
  createDefaultWorkspaceState,
  closeRepositoryTab,
  normalizeDetailPanelWidth,
  normalizeSidebarWidth,
  selectRepositoryCommit,
  selectRepositoryFile
} from '@shared/workspace';

type WorkspaceStore = {
  workspace: WorkspaceState;
  isLoading: boolean;
  errorMessage?: string;
  initialize: () => Promise<void>;
  openRepository: () => Promise<void>;
  openRepositoryAtPath: (repoPath: string) => Promise<void>;
  activateTab: (tabId: string) => Promise<void>;
  closeTab: (tabId: string) => Promise<void>;
  selectCommit: (tabId: string, selectedCommit: string | undefined) => Promise<void>;
  selectFile: (tabId: string, selectedFile: string | undefined) => Promise<void>;
  setSidebarCollapsed: (collapsed: boolean) => Promise<void>;
  setSidebarWidth: (width: number) => Promise<void>;
  setDetailPanelCollapsed: (collapsed: boolean) => Promise<void>;
  setDetailPanelWidth: (width: number) => Promise<void>;
  activateProfile: (profileId: string | undefined) => Promise<WorkspaceState | undefined>;
  assignProfile: (repoPath: string, profileId: string | undefined) => Promise<void>;
  clearError: () => void;
};

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  workspace: createDefaultWorkspaceState(),
  isLoading: true,
  async initialize() {
    await runWorkspaceAction(set, () => window.api.getWorkspace());
  },
  async openRepository() {
    await runWorkspaceAction(set, () => window.api.openRepository());
  },
  async openRepositoryAtPath(repoPath) {
    await runWorkspaceAction(set, () => window.api.openRepositoryAtPath(repoPath));
  },
  async activateTab(tabId) {
    await runWorkspaceAction(set, () => window.api.activateTab(tabId));
  },
  async closeTab(tabId) {
    let previousWorkspace = createDefaultWorkspaceState();
    set((state) => {
      previousWorkspace = state.workspace;
      return {
        workspace: closeRepositoryTab(state.workspace, tabId),
        isLoading: false,
        errorMessage: undefined
      };
    });

    try {
      const workspace = await window.api.closeTab(tabId);
      set({ workspace });
    } catch (error) {
      set({
        workspace: previousWorkspace,
        errorMessage: workspaceActionErrorMessage(error)
      });
    }
  },
  async selectCommit(tabId, selectedCommit) {
    set((state) => ({
      workspace: selectRepositoryCommit(state.workspace, tabId, selectedCommit),
      errorMessage: undefined
    }));

    try {
      await window.api.selectCommit(tabId, selectedCommit);
    } catch (error) {
      set({ errorMessage: workspaceActionErrorMessage(error) });
    }
  },
  async selectFile(tabId, selectedFile) {
    set((state) => ({
      workspace: selectRepositoryFile(state.workspace, tabId, selectedFile),
      errorMessage: undefined
    }));

    try {
      await window.api.selectFile(tabId, selectedFile);
    } catch (error) {
      set({ errorMessage: workspaceActionErrorMessage(error) });
    }
  },
  async setSidebarCollapsed(collapsed) {
    await runWorkspaceAction(set, () => window.api.setSidebarCollapsed(collapsed));
  },
  async setSidebarWidth(width) {
    const sidebarWidth = normalizeSidebarWidth(width);
    set((state) => ({
      workspace: {
        ...state.workspace,
        sidebarWidth
      },
      errorMessage: undefined
    }));

    try {
      const workspace = await window.api.setSidebarWidth(sidebarWidth);
      set({ workspace });
    } catch (error) {
      set({ errorMessage: workspaceActionErrorMessage(error) });
    }
  },
  async setDetailPanelCollapsed(collapsed) {
    await runWorkspaceAction(set, () => window.api.setDetailPanelCollapsed(collapsed));
  },
  async setDetailPanelWidth(width) {
    const detailPanelWidth = normalizeDetailPanelWidth(width);
    set((state) => ({
      workspace: {
        ...state.workspace,
        detailPanelWidth
      },
      errorMessage: undefined
    }));

    try {
      const workspace = await window.api.setDetailPanelWidth(detailPanelWidth);
      set({ workspace });
    } catch (error) {
      set({ errorMessage: workspaceActionErrorMessage(error) });
    }
  },
  async activateProfile(profileId) {
    return runWorkspaceAction(set, () => window.api.activateProfile(profileId), true);
  },
  async assignProfile(repoPath, profileId) {
    await runWorkspaceAction(set, () => window.api.assignProfile(repoPath, profileId), true);
  },
  clearError() {
    set({ errorMessage: undefined });
  }
}));

async function runWorkspaceAction(
  set: (partial: Partial<WorkspaceStore>) => void,
  action: () => Promise<WorkspaceState | null>,
  rethrow = false
): Promise<WorkspaceState | undefined> {
  set({ isLoading: true, errorMessage: undefined });

  try {
    const workspace = await action();

    if (workspace) {
      set({ workspace, isLoading: false });
      return workspace;
    }

    set({ isLoading: false });
    return undefined;
  } catch (error) {
    const errorMessage = workspaceActionErrorMessage(error);

    set({
      isLoading: false,
      errorMessage
    });

    if (rethrow) {
      throw new Error(errorMessage, { cause: error });
    }

    return undefined;
  }
}

function workspaceActionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The requested workspace action failed.';
}
