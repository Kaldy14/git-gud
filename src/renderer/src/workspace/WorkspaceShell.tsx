import type { ReactElement, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  ChevronDown,
  CircleDot,
  Download,
  FolderOpen,
  GitBranch,
  GitCommitVertical,
  GitFork,
  GitMerge,
  History,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Tag,
  Upload,
  UserCircle,
  X
} from 'lucide-react';

import type { RecentRepository, RepoTab } from '@shared/types';
import { useWorkspaceStore } from '@renderer/state/workspace';

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
  const [isOpenMenuVisible, setIsOpenMenuVisible] = useState(false);
  const activeTab = useMemo(
    () => workspace.tabs.find((tab) => tab.id === workspace.activeTabId),
    [workspace.activeTabId, workspace.tabs]
  );

  useEffect(() => {
    void initialize();
  }, [initialize]);

  async function handleOpenRepository(): Promise<void> {
    setIsOpenMenuVisible(false);
    await openRepository();
  }

  async function handleRecentRepository(repoPath: string): Promise<void> {
    setIsOpenMenuVisible(false);
    await openRepositoryAtPath(repoPath);
  }

  return (
    <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-[var(--app-bg)] text-[var(--text-primary)]">
      <div className="drag-region flex h-12 shrink-0 items-stretch border-b border-[var(--border-muted)] bg-[var(--topbar-bg)] pl-[84px]">
        <TabStrip
          tabs={workspace.tabs}
          activeTabId={workspace.activeTabId}
          isOpenMenuVisible={isOpenMenuVisible}
          recentRepos={workspace.recentRepos}
          onActivateTab={activateTab}
          onCloseTab={closeTab}
          onToggleOpenMenu={() => setIsOpenMenuVisible((value) => !value)}
          onOpenRepository={handleOpenRepository}
          onOpenRecentRepository={handleRecentRepository}
        />
        <TopRightActions />
      </div>

      <Toolbar activeTab={activeTab} />

      {errorMessage ? (
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-2 text-sm text-[var(--danger-text)]">
          <span>{errorMessage}</span>
          <button className="icon-button h-7 w-7" type="button" onClick={clearError} aria-label="Dismiss error">
            <X size={15} />
          </button>
        </div>
      ) : null}

      <section className="grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)_382px]">
        <Sidebar
          activeTab={activeTab}
          isCollapsed={workspace.sidebarCollapsed}
          recentRepos={workspace.recentRepos}
          onOpenRepository={handleOpenRepository}
          onOpenRecentRepository={handleRecentRepository}
          onToggleCollapsed={() => void setSidebarCollapsed(!workspace.sidebarCollapsed)}
        />
        <GraphStage activeTab={activeTab} isLoading={isLoading} />
        <DetailPanel activeTab={activeTab} />
      </section>
    </main>
  );
}

type TabStripProps = {
  tabs: RepoTab[];
  activeTabId?: string;
  recentRepos: RecentRepository[];
  isOpenMenuVisible: boolean;
  onActivateTab: (tabId: string) => Promise<void>;
  onCloseTab: (tabId: string) => Promise<void>;
  onToggleOpenMenu: () => void;
  onOpenRepository: () => Promise<void>;
  onOpenRecentRepository: (repoPath: string) => Promise<void>;
};

function TabStrip({
  tabs,
  activeTabId,
  recentRepos,
  isOpenMenuVisible,
  onActivateTab,
  onCloseTab,
  onToggleOpenMenu,
  onOpenRepository,
  onOpenRecentRepository
}: TabStripProps): ReactElement {
  return (
    <div className="no-drag relative flex min-w-0 flex-1 items-end">
      <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto px-2">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;

          return (
            <button
              key={tab.id}
              className={[
                'group flex h-9 max-w-56 shrink-0 items-center gap-2 border border-b-0 px-3 text-left text-sm transition',
                isActive
                  ? 'border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text-primary)]'
                  : 'border-transparent bg-[var(--surface-muted)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'
              ].join(' ')}
              type="button"
              onClick={() => void onActivateTab(tab.id)}
            >
              <GitBranch size={14} className="shrink-0 text-[var(--accent-teal)]" />
              <span className="min-w-0 truncate">{tab.name}</span>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-amber)]" aria-hidden="true" />
              <span
                role="button"
                tabIndex={0}
                aria-label={`Close ${tab.name}`}
                className="ml-1 grid h-5 w-5 shrink-0 place-items-center text-[var(--text-dim)] opacity-70 transition hover:text-[var(--text-primary)] group-hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  void onCloseTab(tab.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    void onCloseTab(tab.id);
                  }
                }}
              >
                <X size={13} />
              </span>
            </button>
          );
        })}
        <button
          className="grid h-9 w-10 shrink-0 place-items-center border border-b-0 border-transparent bg-[var(--surface-muted)] text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          type="button"
          onClick={onToggleOpenMenu}
          aria-label="Open repository menu"
        >
          <Plus size={16} />
        </button>
      </div>

      {isOpenMenuVisible ? (
        <div className="absolute left-2 top-11 z-50 w-80 border border-[var(--border-strong)] bg-[var(--popover-bg)] p-2 shadow-2xl shadow-black/45">
          <button className="menu-row" type="button" onClick={() => void onOpenRepository()}>
            <FolderOpen size={15} />
            <span>Open folder</span>
          </button>
          {recentRepos.length > 0 ? <div className="my-2 h-px bg-[var(--border-muted)]" /> : null}
          {recentRepos.map((recentRepo) => (
            <button
              key={recentRepo.path}
              className="menu-row"
              type="button"
              onClick={() => void onOpenRecentRepository(recentRepo.path)}
            >
              <History size={15} />
              <span className="min-w-0 flex-1 truncate text-left">{recentRepo.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TopRightActions(): ReactElement {
  return (
    <div className="no-drag flex shrink-0 items-center gap-1 px-3 text-[var(--text-muted)]">
      <button className="icon-button" type="button" aria-label="Search">
        <Search size={16} />
      </button>
      <button className="icon-button" type="button" aria-label="Notifications">
        <Bell size={16} />
      </button>
      <button className="icon-button" type="button" aria-label="Settings">
        <Settings size={16} />
      </button>
      <button className="ml-1 flex h-8 items-center gap-2 border border-[var(--border-muted)] bg-[var(--surface-muted)] px-2 text-xs text-[var(--text-muted)]">
        <UserCircle size={16} />
        <span>Profile</span>
        <ChevronDown size={14} />
      </button>
    </div>
  );
}

function Toolbar({ activeTab }: { activeTab?: RepoTab }): ReactElement {
  return (
    <div className="flex h-13 shrink-0 items-center justify-between border-b border-[var(--border-muted)] bg-[var(--toolbar-bg)] px-3">
      <div className="flex min-w-0 items-center gap-2">
        <select
          className="h-8 min-w-54 border border-[var(--border-muted)] bg-[var(--field-bg)] px-2 text-sm text-[var(--text-primary)] outline-none"
          value={activeTab?.id ?? ''}
          disabled={!activeTab}
          onChange={() => undefined}
          aria-label="Repository"
        >
          <option value={activeTab?.id ?? ''}>{activeTab?.name ?? 'No repository'}</option>
        </select>
        <button className="toolbar-pill" type="button" disabled>
          <GitBranch size={15} />
          <span>Branch data in M1</span>
        </button>
      </div>

      <div className="flex items-center gap-1">
        <ToolbarButton icon={<RefreshCw size={15} />} label="Fetch" />
        <ToolbarButton icon={<Download size={15} />} label="Pull" />
        <ToolbarButton icon={<Upload size={15} />} label="Push" />
        <div className="mx-1 h-6 w-px bg-[var(--border-muted)]" />
        <ToolbarButton icon={<GitFork size={15} />} label="Branch" />
        <ToolbarButton icon={<GitMerge size={15} />} label="Merge" />
        <ToolbarButton icon={<Tag size={15} />} label="Tag" />
      </div>
    </div>
  );
}

function ToolbarButton({ icon, label }: { icon: ReactNode; label: string }): ReactElement {
  return (
    <button className="toolbar-button" type="button" disabled>
      {icon}
      <span>{label}</span>
    </button>
  );
}

type SidebarProps = {
  activeTab?: RepoTab;
  recentRepos: RecentRepository[];
  isCollapsed: boolean;
  onOpenRepository: () => Promise<void>;
  onOpenRecentRepository: (repoPath: string) => Promise<void>;
  onToggleCollapsed: () => void;
};

function Sidebar({
  activeTab,
  recentRepos,
  isCollapsed,
  onOpenRepository,
  onOpenRecentRepository,
  onToggleCollapsed
}: SidebarProps): ReactElement {
  if (isCollapsed) {
    return (
      <aside className="flex w-12 flex-col items-center border-r border-[var(--border-muted)] bg-[var(--sidebar-bg)] py-3">
        <button className="icon-button" type="button" onClick={onToggleCollapsed} aria-label="Expand sidebar">
          <PanelLeftOpen size={16} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex w-[282px] min-w-[282px] flex-col border-r border-[var(--border-muted)] bg-[var(--sidebar-bg)]">
      <div className="flex h-12 items-center justify-between border-b border-[var(--border-muted)] px-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--text-primary)]">{activeTab?.name ?? 'Workspace'}</p>
          <p className="truncate text-xs text-[var(--text-dim)]">{activeTab?.path ?? 'No repository open'}</p>
        </div>
        <button className="icon-button h-8 w-8" type="button" onClick={onToggleCollapsed} aria-label="Collapse sidebar">
          <PanelLeftClose size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <button className="primary-command mb-4 w-full" type="button" onClick={() => void onOpenRepository()}>
          <FolderOpen size={16} />
          <span>Open repository</span>
        </button>

        <SidebarSection icon={<GitBranch size={15} />} title="Local Branches" count={0} />
        <SidebarSection icon={<Upload size={15} />} title="Remotes" count={0} />
        <SidebarSection icon={<Tag size={15} />} title="Tags" count={0} />
        <SidebarSection icon={<GitFork size={15} />} title="Worktrees" count={0} />
      </div>

      <div className="border-t border-[var(--border-muted)] p-3">
        <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.14em] text-[var(--text-dim)]">
          <span>Recent</span>
          <span>{recentRepos.length}</span>
        </div>
        <div className="space-y-1">
          {recentRepos.slice(0, 4).map((repo) => (
            <button
              key={repo.path}
              className="flex w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              type="button"
              onClick={() => void onOpenRecentRepository(repo.path)}
            >
              <CircleDot size={12} className="shrink-0 text-[var(--accent-teal)]" />
              <span className="truncate">{repo.name}</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

function SidebarSection({ icon, title, count }: { icon: ReactNode; title: string; count: number }): ReactElement {
  return (
    <section className="mb-4">
      <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-[0.14em] text-[var(--text-dim)]">
        <span className="flex items-center gap-2">
          {icon}
          {title}
        </span>
        <span>{count}</span>
      </div>
      <div className="h-8 border border-dashed border-[var(--border-muted)] bg-[var(--surface-faint)]" />
    </section>
  );
}

function GraphStage({ activeTab, isLoading }: { activeTab?: RepoTab; isLoading: boolean }): ReactElement {
  const rows = activeTab ? Array.from({ length: 12 }, (_value, index) => index) : [];

  return (
    <section className="min-w-0 overflow-hidden bg-[var(--graph-bg)]">
      <div className="grid h-9 grid-cols-[132px_128px_minmax(0,1fr)_160px_128px] items-center border-b border-[var(--border-muted)] bg-[var(--graph-header-bg)] px-4 text-xs uppercase tracking-[0.12em] text-[var(--text-dim)]">
        <span>Refs</span>
        <span>Graph</span>
        <span>Message</span>
        <span>Author</span>
        <span>Date</span>
      </div>

      {activeTab ? (
        <div className="h-full overflow-y-auto">
          <div className="sticky top-0 z-10 border-b border-[var(--border-muted)] bg-[var(--date-chip-bg)] px-4 py-2 text-xs text-[var(--text-muted)]">
            {activeTab.name}
          </div>
          {rows.map((row) => (
            <div
              key={row}
              className="grid h-12 grid-cols-[132px_128px_minmax(0,1fr)_160px_128px] items-center border-b border-[var(--row-border)] px-4 text-sm"
            >
              <div>{row === 0 ? <span className="ref-chip">WIP</span> : null}</div>
              <MiniGraph row={row} />
              <div className="min-w-0">
                <div className="h-3 max-w-[480px] bg-[var(--skeleton-strong)]" />
              </div>
              <div className="h-3 w-24 bg-[var(--skeleton)]" />
              <div className="h-3 w-16 bg-[var(--skeleton)]" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid h-full place-items-center px-8">
          <div className="w-full max-w-lg text-center">
            <div className="mx-auto mb-5 grid h-16 w-16 place-items-center border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--accent-teal)]">
              <GitCommitVertical size={30} />
            </div>
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">Open a Git repository</h1>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              {isLoading ? 'Loading workspace.' : 'Tabs, panels, and recent repositories will persist here.'}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function MiniGraph({ row }: { row: number }): ReactElement {
  const color = row % 3 === 0 ? 'var(--accent-coral)' : row % 3 === 1 ? 'var(--accent-teal)' : 'var(--accent-amber)';

  return (
    <svg className="h-12 w-24" viewBox="0 0 96 48" aria-hidden="true">
      <path d="M22 0 V48" stroke="var(--rail-muted)" strokeWidth="2" />
      <path d="M48 0 V48" stroke="var(--rail-muted)" strokeWidth="2" />
      {row % 4 === 0 ? <path d="M22 24 C34 24 36 36 48 36" fill="none" stroke="var(--rail-muted)" strokeWidth="2" /> : null}
      <circle cx={row % 2 === 0 ? 22 : 48} cy="24" r="5.5" fill={color} stroke="var(--graph-bg)" strokeWidth="3" />
    </svg>
  );
}

function DetailPanel({ activeTab }: { activeTab?: RepoTab }): ReactElement {
  return (
    <aside className="min-w-0 border-l border-[var(--border-muted)] bg-[var(--detail-bg)]">
      <div className="flex h-9 items-center justify-between border-b border-[var(--border-muted)] px-3 text-xs uppercase tracking-[0.12em] text-[var(--text-dim)]">
        <span>Details</span>
        <button className="icon-button h-7 w-7" type="button" aria-label="Details menu">
          <ChevronDown size={14} />
        </button>
      </div>
      <div className="space-y-5 p-4">
        <section>
          <p className="mb-2 text-xs uppercase tracking-[0.14em] text-[var(--text-dim)]">Repository</p>
          <h2 className="truncate text-lg font-semibold text-[var(--text-primary)]">{activeTab?.name ?? 'No repository'}</h2>
          <p className="mt-1 break-all text-xs leading-5 text-[var(--text-muted)]">{activeTab?.path ?? 'Open a folder to begin.'}</p>
        </section>

        <section className="space-y-2 text-sm">
          <DetailRow label="Git dir" value={activeTab?.gitDir ?? 'None'} />
          <DetailRow label="Common dir" value={activeTab?.commonDir ?? 'None'} />
          <DetailRow label="Selected commit" value={activeTab?.selectedCommit ?? 'None'} />
          <DetailRow label="Selected file" value={activeTab?.selectedFile ?? 'None'} />
        </section>

        <section>
          <p className="mb-2 text-xs uppercase tracking-[0.14em] text-[var(--text-dim)]">Changed Files</p>
          <div className="h-36 border border-dashed border-[var(--border-muted)] bg-[var(--surface-faint)]" />
        </section>

        <section>
          <p className="mb-2 text-xs uppercase tracking-[0.14em] text-[var(--text-dim)]">Diff</p>
          <div className="space-y-2 border border-[var(--border-muted)] bg-[var(--surface)] p-3">
            <div className="h-2 w-4/5 bg-[var(--skeleton-strong)]" />
            <div className="h-2 w-3/5 bg-[var(--skeleton)]" />
            <div className="h-2 w-5/6 bg-[var(--skeleton)]" />
            <div className="h-2 w-1/2 bg-[var(--skeleton)]" />
          </div>
        </section>
      </div>
    </aside>
  );
}

function DetailRow({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 border-b border-[var(--border-muted)] pb-2">
      <span className="text-xs uppercase tracking-[0.1em] text-[var(--text-dim)]">{label}</span>
      <span className="break-all text-xs leading-5 text-[var(--text-muted)]">{value}</span>
    </div>
  );
}
