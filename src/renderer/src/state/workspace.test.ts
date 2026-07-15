import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceState } from '@shared/types';

import { useWorkspaceStore } from './workspace';

describe('workspace selection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('updates commit and file selection immediately without applying stale IPC responses', async () => {
    const initialWorkspace = createWorkspace();
    let resolveCommit: (workspace: WorkspaceState) => void = () => {};
    const commitResponse = new Promise<WorkspaceState>((resolve) => {
      resolveCommit = resolve;
    });
    const selectCommit = vi.fn(() => commitResponse);
    const selectFile = vi.fn(async () => initialWorkspace);
    vi.stubGlobal('window', { api: { selectCommit, selectFile } });
    useWorkspaceStore.setState({
      workspace: initialWorkspace,
      isLoading: false,
      errorMessage: undefined
    });

    const commitSelection = useWorkspaceStore.getState().selectCommit('repo-tab', 'wip');

    expect(useWorkspaceStore.getState().workspace.tabs[0]?.selectedCommit).toBe('wip');
    expect(useWorkspaceStore.getState().isLoading).toBe(false);
    resolveCommit(initialWorkspace);
    await commitSelection;
    expect(useWorkspaceStore.getState().workspace.tabs[0]?.selectedCommit).toBe('wip');

    await useWorkspaceStore.getState().selectFile('repo-tab', 'src/index.ts');
    expect(useWorkspaceStore.getState().workspace.tabs[0]?.selectedFile).toBe('src/index.ts');
  });
});

function createWorkspace(): WorkspaceState {
  return {
    tabs: [
      {
        id: 'repo-tab',
        path: '/repo',
        name: 'repo',
        gitDir: '/repo/.git',
        commonDir: '/repo/.git',
        openedAt: '2026-07-15T08:00:00.000Z',
        lastOpenedAt: '2026-07-15T08:00:00.000Z',
        viewMode: 'graph'
      }
    ],
    activeTabId: 'repo-tab',
    recentRepos: [],
    sidebarCollapsed: false,
    sidebarWidth: 382,
    detailPanelCollapsed: false,
    detailPanelWidth: 382
  };
}
