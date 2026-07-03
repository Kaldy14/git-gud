import type { ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';

import { CommitDetailPanel } from '@renderer/components/commit/CommitDetailPanel';
import { GraphView } from '@renderer/components/graph/GraphView';
import { SAMPLE_GRAPH_ROWS, findGraphRow } from '@renderer/components/graph/sampleGraph';
import { Sidebar } from '@renderer/components/sidebar/Sidebar';
import { StartPage } from '@renderer/components/start/StartPage';
import { StatusBar } from '@renderer/components/statusbar/StatusBar';
import { TabStrip } from '@renderer/components/tabs/TabStrip';
import { Toolbar } from '@renderer/components/toolbar/Toolbar';
import { useRepositoryChangeInvalidation, useRepositoryOverview } from '@renderer/queries/repository';
import { useWorkspaceStore } from '@renderer/state/workspace';

const DEFAULT_SELECTED_SHA = SAMPLE_GRAPH_ROWS[1]?.sha;

export function WorkspaceShell(): ReactElement {
  const {
    workspace,
    isLoading,
    errorMessage,
    initialize,
    openRepository,
    openRepositoryAtPath,
    activateTab,
    closeTab,
    setSidebarCollapsed,
    clearError
  } = useWorkspaceStore();
  const [selectionByTab, setSelectionByTab] = useState<Record<string, string>>({});

  const activeTab = useMemo(
    () => workspace.tabs.find((tab) => tab.id === workspace.activeTabId),
    [workspace.activeTabId, workspace.tabs]
  );
  const repositoryQuery = useRepositoryOverview(activeTab?.path);
  const repositoryError =
    repositoryQuery.error instanceof Error ? repositoryQuery.error.message : undefined;
  const selectedSha = activeTab ? (selectionByTab[activeTab.id] ?? DEFAULT_SELECTED_SHA) : undefined;
  const selectedRow = findGraphRow(selectedSha);
  const parentSha = useMemo(() => {
    const index = SAMPLE_GRAPH_ROWS.findIndex((row) => row.sha === selectedSha);
    return index === -1 ? undefined : SAMPLE_GRAPH_ROWS[index + 1]?.sha;
  }, [selectedSha]);

  useRepositoryChangeInvalidation();

  useEffect(() => {
    void initialize();
  }, [initialize]);

  function handleSelectRow(sha: string): void {
    if (activeTab) {
      setSelectionByTab((value) => ({ ...value, [activeTab.id]: sha }));
    }
  }

  function handleErrorAction(): void {
    if (errorMessage) {
      clearError();
      return;
    }

    void repositoryQuery.refetch();
  }

  return (
    <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-[var(--bg-app)] text-[var(--text-1)]">
      <TabStrip
        tabs={workspace.tabs}
        activeTabId={workspace.activeTabId}
        recentRepos={workspace.recentRepos}
        profileState={repositoryQuery.data?.profileState}
        onActivateTab={(tabId) => void activateTab(tabId)}
        onCloseTab={(tabId) => void closeTab(tabId)}
        onOpenRepository={() => void openRepository()}
        onOpenRecentRepository={(repoPath) => void openRepositoryAtPath(repoPath)}
      />

      <Toolbar activeTab={activeTab} repositoryOverview={repositoryQuery.data} />

      {errorMessage || repositoryError ? (
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-1.5 text-xs text-[var(--danger-text)]">
          <span>{errorMessage ?? repositoryError}</span>
          <button className="icon-btn h-6 w-6" type="button" onClick={handleErrorAction} aria-label="Retry or dismiss error">
            <X size={13} />
          </button>
        </div>
      ) : null}

      <section className="flex min-h-0 flex-1">
        {activeTab ? (
          <>
            <Sidebar
              activeTab={activeTab}
              repositoryOverview={repositoryQuery.data}
              isLoading={repositoryQuery.isLoading}
              errorMessage={repositoryError}
              isCollapsed={workspace.sidebarCollapsed}
              onToggleCollapsed={() => void setSidebarCollapsed(!workspace.sidebarCollapsed)}
            />
            <GraphView rows={SAMPLE_GRAPH_ROWS} selectedSha={selectedSha} onSelectRow={handleSelectRow} />
            <CommitDetailPanel row={selectedRow} parentSha={parentSha} />
          </>
        ) : (
          <StartPage
            isLoading={isLoading}
            recentRepos={workspace.recentRepos}
            onOpenRepository={() => void openRepository()}
            onOpenRecentRepository={(repoPath) => void openRepositoryAtPath(repoPath)}
          />
        )}
      </section>

      <StatusBar
        activeTab={activeTab}
        repositoryOverview={repositoryQuery.data}
        isRepositoryLoading={repositoryQuery.isLoading}
      />
    </main>
  );
}
