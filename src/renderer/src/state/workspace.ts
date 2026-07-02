import { create } from 'zustand';

import type { WorkspaceState } from '@shared/types';
import { createDefaultWorkspaceState } from '@shared/workspace';

type WorkspaceStore = {
  workspace: WorkspaceState;
  isLoading: boolean;
  errorMessage?: string;
  initialize: () => Promise<void>;
  openRepository: () => Promise<void>;
  openRepositoryAtPath: (repoPath: string) => Promise<void>;
  activateTab: (tabId: string) => Promise<void>;
  closeTab: (tabId: string) => Promise<void>;
  setSidebarCollapsed: (collapsed: boolean) => Promise<void>;
  clearError: () => void;
};

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  workspace: createDefaultWorkspaceState(),
  isLoading: true,
  async initialize() {
    await runWorkspaceAction(set, () => window.api.getWorkspace(), true);
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
    await runWorkspaceAction(set, () => window.api.closeTab(tabId));
  },
  async setSidebarCollapsed(collapsed) {
    await runWorkspaceAction(set, () => window.api.setSidebarCollapsed(collapsed));
  },
  clearError() {
    set({ errorMessage: undefined });
  }
}));

async function runWorkspaceAction(
  set: (partial: Partial<WorkspaceStore>) => void,
  action: () => Promise<WorkspaceState | null>,
  keepLoading = false
): Promise<void> {
  set({ isLoading: true, errorMessage: undefined });

  try {
    const workspace = await action();

    if (workspace) {
      set({ workspace, isLoading: keepLoading ? false : false });
      return;
    }

    set({ isLoading: false });
  } catch (error) {
    set({
      isLoading: false,
      errorMessage: error instanceof Error ? error.message : 'The requested workspace action failed.'
    });
  }
}
