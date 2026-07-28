import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceState } from '@shared/types';
import { reorderRepositoryTab } from '@shared/workspace';

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

  it('reorders tabs optimistically and persists the final order', async () => {
    const initialWorkspace = createWorkspace();
    const secondTab = {
      ...initialWorkspace.tabs[0]!,
      id: 'second-tab',
      path: '/second',
      name: 'second'
    };
    initialWorkspace.tabs.push(secondTab);
    const persistedWorkspace = reorderRepositoryTab(initialWorkspace, 'repo-tab', 1);
    const reorderTab = vi.fn(async () => persistedWorkspace);
    vi.stubGlobal('window', { api: { reorderTab } });
    useWorkspaceStore.setState({
      workspace: initialWorkspace,
      isLoading: false,
      errorMessage: undefined
    });

    const persistence = useWorkspaceStore.getState().reorderTab('repo-tab', 1);

    expect(useWorkspaceStore.getState().workspace.tabs.map((tab) => tab.id)).toEqual([
      'second-tab',
      'repo-tab'
    ]);
    await persistence;
    expect(reorderTab).toHaveBeenCalledWith('repo-tab', 1);
    expect(useWorkspaceStore.getState().workspace.tabs.map((tab) => tab.id)).toEqual([
      'second-tab',
      'repo-tab'
    ]);
  });

  it('does not let an older failed reorder overwrite a newer drag', async () => {
    const initialWorkspace = createWorkspace();
    initialWorkspace.tabs.push(
      {
        ...initialWorkspace.tabs[0]!,
        id: 'second-tab',
        path: '/second',
        name: 'second'
      },
      {
        ...initialWorkspace.tabs[0]!,
        id: 'third-tab',
        path: '/third',
        name: 'third'
      }
    );
    let rejectFirstReorder: (error: Error) => void = () => {};
    const firstReorderResponse = new Promise<WorkspaceState>((_resolve, reject) => {
      rejectFirstReorder = reject;
    });
    const reorderTab = vi.fn((_tabId: string, targetIndex: number) =>
      targetIndex === 2 ? firstReorderResponse : Promise.resolve(initialWorkspace)
    );
    vi.stubGlobal('window', { api: { reorderTab } });
    useWorkspaceStore.setState({
      workspace: initialWorkspace,
      isLoading: false,
      errorMessage: undefined
    });

    const firstReorder = useWorkspaceStore.getState().reorderTab('repo-tab', 2);
    const secondReorder = useWorkspaceStore.getState().reorderTab('repo-tab', 1);

    await secondReorder;
    rejectFirstReorder(new Error('stale failure'));
    await firstReorder;

    expect(useWorkspaceStore.getState().workspace.tabs.map((tab) => tab.id)).toEqual([
      'second-tab',
      'repo-tab',
      'third-tab'
    ]);
    expect(useWorkspaceStore.getState().errorMessage).toBeUndefined();
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
