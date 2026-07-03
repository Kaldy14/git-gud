import type { ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';

import { CommitDetailPanel } from '@renderer/components/commit/CommitDetailPanel';
import { GraphView } from '@renderer/components/graph/GraphView';
import { Sidebar } from '@renderer/components/sidebar/Sidebar';
import { StartPage } from '@renderer/components/start/StartPage';
import { StatusBar } from '@renderer/components/statusbar/StatusBar';
import { TabStrip } from '@renderer/components/tabs/TabStrip';
import { Toolbar } from '@renderer/components/toolbar/Toolbar';
import { useCommitGraph, useRepositoryChangeInvalidation, useRepositoryOverview } from '@renderer/queries/repository';
import { useWorkspaceStore } from '@renderer/state/workspace';
import { COMMIT_GRAPH_LIMIT_STEP, DEFAULT_COMMIT_GRAPH_LIMIT } from '@shared/graph';
import type { GitProfile } from '@shared/types';

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
    assignProfile,
    clearError
  } = useWorkspaceStore();
  const [selectionByTab, setSelectionByTab] = useState<Record<string, string>>({});
  const [graphLimitByTab, setGraphLimitByTab] = useState<Record<string, number>>({});

  const activeTab = useMemo(
    () => workspace.tabs.find((tab) => tab.id === workspace.activeTabId),
    [workspace.activeTabId, workspace.tabs]
  );
  const graphLimit = activeTab ? (graphLimitByTab[activeTab.id] ?? DEFAULT_COMMIT_GRAPH_LIMIT) : DEFAULT_COMMIT_GRAPH_LIMIT;
  const repositoryQuery = useRepositoryOverview(activeTab?.path);
  const graphQuery = useCommitGraph(activeTab?.path, graphLimit);
  const repositoryError =
    repositoryQuery.error instanceof Error ? repositoryQuery.error.message : undefined;
  const graphError = graphQuery.error instanceof Error ? graphQuery.error.message : undefined;
  const graphRows = graphQuery.data?.rows ?? [];
  const selectedSha = activeTab ? selectionByTab[activeTab.id] : undefined;
  const selectedRow = graphRows.find((row) => row.sha === selectedSha) ?? graphRows[0];
  const parentSha = selectedRow?.parentShas[0];

  useRepositoryChangeInvalidation();

  useEffect(() => {
    void initialize();
  }, [initialize]);

  function handleSelectRow(sha: string): void {
    if (activeTab) {
      setSelectionByTab((value) => ({ ...value, [activeTab.id]: sha }));
    }
  }

  function handleLoadMoreGraphRows(): void {
    if (!activeTab) {
      return;
    }

    const nextLimit = graphQuery.data?.nextLimit ?? graphLimit + COMMIT_GRAPH_LIMIT_STEP;
    setGraphLimitByTab((value) => ({ ...value, [activeTab.id]: nextLimit }));
  }

  function handleErrorAction(): void {
    if (errorMessage) {
      clearError();
      return;
    }

    void repositoryQuery.refetch();
  }

  async function handleAssignProfile(profileId: string | undefined): Promise<void> {
    if (!activeTab) {
      return;
    }

    await assignProfile(activeTab.path, profileId);
    await repositoryQuery.refetch();
  }

  async function handleSaveAndAssignProfile(profile: GitProfile): Promise<void> {
    await window.api.saveProfile(profile);
    await handleAssignProfile(profile.id);
  }

  return (
    <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-[var(--bg-app)] text-[var(--text-1)]">
      <TabStrip
        tabs={workspace.tabs}
        activeTabId={workspace.activeTabId}
        activeRepoPath={activeTab?.path}
        recentRepos={workspace.recentRepos}
        profileState={repositoryQuery.data?.profileState}
        onActivateTab={(tabId) => void activateTab(tabId)}
        onCloseTab={(tabId) => void closeTab(tabId)}
        onOpenRepository={() => void openRepository()}
        onOpenRecentRepository={(repoPath) => void openRepositoryAtPath(repoPath)}
        onAssignProfile={handleAssignProfile}
        onSaveAndAssignProfile={handleSaveAndAssignProfile}
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
            <GraphView
              rows={graphRows}
              selectedSha={selectedRow?.sha}
              isLoading={graphQuery.isLoading}
              isFetching={graphQuery.isFetching}
              errorMessage={graphError}
              hasMore={graphQuery.data?.hasMore ?? false}
              onSelectRow={handleSelectRow}
              onLoadMore={handleLoadMoreGraphRows}
            />
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
