import type { MouseEvent, ReactElement, ReactNode } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  FolderGit2,
  GitBranch,
  Laptop,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2
} from 'lucide-react';

import { FILE_STATUS_COLORS } from '@shared/graph';
import type { GitBranchRef, GitRemoteBranchRef, GitRepositoryOverview, GitStatusCode, GitTagRef, RepoTab } from '@shared/types';

type SidebarProps = {
  activeTab?: RepoTab;
  repositoryOverview?: GitRepositoryOverview;
  isLoading: boolean;
  errorMessage?: string;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  isOperationBusy: boolean;
  onCheckoutBranch: (name: string) => void;
  onCheckoutRemoteBranch: (name: string) => void;
  onRenameBranch: (name: string) => void;
  onDeleteBranch: (name: string) => void;
  onDeleteTag: (name: string) => void;
};

type SectionId = 'local' | 'remote' | 'worktrees' | 'tags';

type SidebarContextMenuTarget =
  | {
      kind: 'local';
      branch: GitBranchRef;
    }
  | {
      kind: 'remote';
      branch: GitRemoteBranchRef;
    }
  | {
      kind: 'tag';
      tag: GitTagRef;
    };

type SidebarContextMenuState = SidebarContextMenuTarget & {
  x: number;
  y: number;
};

const SECTIONS: Array<{ id: SectionId; title: string; icon: ReactNode }> = [
  { id: 'local', title: 'Local', icon: <Laptop size={14} /> },
  { id: 'remote', title: 'Remote', icon: <Cloud size={14} /> },
  { id: 'worktrees', title: 'Worktrees', icon: <FolderGit2 size={14} /> },
  { id: 'tags', title: 'Tags', icon: <Tag size={14} /> }
];

export function Sidebar({
  activeTab,
  repositoryOverview,
  isLoading,
  errorMessage,
  isCollapsed,
  onToggleCollapsed,
  isOperationBusy,
  onCheckoutBranch,
  onCheckoutRemoteBranch,
  onRenameBranch,
  onDeleteBranch,
  onDeleteTag
}: SidebarProps): ReactElement {
  const [expanded, setExpanded] = useState<Record<SectionId, boolean>>({
    local: true,
    remote: false,
    worktrees: false,
    tags: false
  });
  const [filter, setFilter] = useState('');
  const [contextMenu, setContextMenu] = useState<SidebarContextMenuState>();
  const counts = {
    local: repositoryOverview?.refs.localBranches.length ?? 0,
    remote: repositoryOverview?.refs.remoteBranches.length ?? 0,
    worktrees: repositoryOverview?.worktrees.length ?? 0,
    tags: repositoryOverview?.refs.tags.length ?? 0
  };

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setContextMenu(undefined);
      }
    }

    function handleClick(): void {
      setContextMenu(undefined);
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('click', handleClick);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('click', handleClick);
    };
  }, [contextMenu]);

  function handleRowContextMenu(event: MouseEvent<HTMLElement>, state: SidebarContextMenuTarget): void {
    event.preventDefault();
    setContextMenu({
      ...state,
      x: event.clientX,
      y: event.clientY
    });
  }

  if (isCollapsed) {
    return (
      <aside className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-[var(--border)] bg-[var(--bg-sidebar)] py-2">
        <button className="icon-btn" type="button" onClick={onToggleCollapsed} aria-label="Expand sidebar">
          <PanelLeftOpen size={15} />
        </button>
        <div className="mt-1 flex flex-col gap-1 text-[var(--text-3)]">
          {SECTIONS.map((section) => (
            <span key={section.id} className="grid h-7 w-7 place-items-center" title={section.title}>
              {section.icon}
            </span>
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex w-[264px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-sidebar)]">
      <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
        <div className="relative min-w-0 flex-1">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input
            className="h-7 w-full rounded-md border border-[var(--border)] bg-[var(--bg-field)] pl-7 pr-2 text-xs text-[var(--text-1)] placeholder-[var(--text-3)] outline-none transition focus:border-[var(--border-strong)]"
            placeholder="Filter refs"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
        <button className="icon-btn h-7 w-7" type="button" onClick={onToggleCollapsed} aria-label="Collapse sidebar">
          <PanelLeftClose size={14} />
        </button>
      </div>

      <StatusSummary repositoryOverview={repositoryOverview} />

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
        {SECTIONS.map((section) => {
          const isExpanded = expanded[section.id];

          return (
            <section key={section.id} className="mb-0.5">
              <button
                className="side-section"
                type="button"
                onClick={() => setExpanded((value) => ({ ...value, [section.id]: !value[section.id] }))}
              >
                {isExpanded ? (
                  <ChevronDown size={13} className="shrink-0 text-[var(--text-3)]" />
                ) : (
                  <ChevronRight size={13} className="shrink-0 text-[var(--text-3)]" />
                )}
                <span className="shrink-0 text-[var(--text-3)]">{section.icon}</span>
                <span className="min-w-0 flex-1 truncate text-left uppercase">{section.title}</span>
                <span className="shrink-0 text-[11px] font-normal text-[var(--text-3)]">{counts[section.id]}</span>
              </button>
              {isExpanded ? (
                <SectionRows
                  sectionId={section.id}
                  repositoryOverview={repositoryOverview}
                  filter={filter}
                  isLoading={isLoading}
                  errorMessage={errorMessage}
                  onContextMenu={handleRowContextMenu}
                  onCheckoutBranch={onCheckoutBranch}
                  onCheckoutRemoteBranch={onCheckoutRemoteBranch}
                />
              ) : null}
            </section>
          );
        })}
      </div>

      {activeTab ? (
        <div className="border-t border-[var(--border)] px-4 py-2.5">
          <p className="truncate text-xs font-medium text-[var(--text-2)]" title={activeTab.path}>
            {activeTab.name}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-[var(--text-3)]" title={activeTab.path}>
            {activeTab.path}
          </p>
        </div>
      ) : null}
      {contextMenu ? (
        <SidebarContextMenu
          state={contextMenu}
          isOperationBusy={isOperationBusy}
          onClose={() => setContextMenu(undefined)}
          onCheckoutBranch={onCheckoutBranch}
          onCheckoutRemoteBranch={onCheckoutRemoteBranch}
          onRenameBranch={onRenameBranch}
          onDeleteBranch={onDeleteBranch}
          onDeleteTag={onDeleteTag}
        />
      ) : null}
    </aside>
  );
}

type SectionRowsProps = {
  sectionId: SectionId;
  repositoryOverview?: GitRepositoryOverview;
  filter: string;
  isLoading: boolean;
  errorMessage?: string;
  onContextMenu: (event: MouseEvent<HTMLElement>, state: SidebarContextMenuTarget) => void;
  onCheckoutBranch: (name: string) => void;
  onCheckoutRemoteBranch: (name: string) => void;
};

function SectionRows({
  sectionId,
  repositoryOverview,
  filter,
  isLoading,
  errorMessage,
  onContextMenu,
  onCheckoutBranch,
  onCheckoutRemoteBranch
}: SectionRowsProps): ReactElement {
  if (errorMessage) {
    return <EmptySection label="Could not load Git data." />;
  }

  if (isLoading) {
    return <EmptySection label="Loading refs..." />;
  }

  if (!repositoryOverview) {
    return <EmptySection label="Open a repository to load refs." />;
  }

  const normalizedFilter = filter.trim().toLowerCase();

  if (sectionId === 'local') {
    const rows = repositoryOverview.refs.localBranches.filter((branch) => matchesFilter(branch.name, normalizedFilter));
    return rows.length > 0 ? (
      <div className="space-y-0.5 py-0.5">
        {rows.map((branch) => (
          <SidebarRow
            key={branch.fullName}
            icon={<GitBranch size={12} />}
            label={branch.name}
            meta={formatAheadBehind(branch.ahead, branch.behind)}
            isActive={branch.current}
            onContextMenu={(event) => onContextMenu(event, { kind: 'local', branch })}
            onDoubleClick={() => {
              if (!branch.current) {
                onCheckoutBranch(branch.name);
              }
            }}
          />
        ))}
      </div>
    ) : (
      <EmptySection label="No local branches." />
    );
  }

  if (sectionId === 'remote') {
    const rows = repositoryOverview.refs.remoteBranches.filter((branch) => matchesFilter(branch.name, normalizedFilter));
    return rows.length > 0 ? (
      <div className="space-y-0.5 py-0.5">
        {rows.map((branch) => (
          <SidebarRow
            key={branch.fullName}
            icon={<Cloud size={12} />}
            label={branch.name}
            meta={branch.sha.slice(0, 7)}
            onContextMenu={(event) => onContextMenu(event, { kind: 'remote', branch })}
            onDoubleClick={() => onCheckoutRemoteBranch(branch.name)}
          />
        ))}
      </div>
    ) : (
      <EmptySection label="No remote branches." />
    );
  }

  if (sectionId === 'worktrees') {
    const rows = repositoryOverview.worktrees.filter((worktree) =>
      matchesFilter(`${worktree.branch ?? worktree.path} ${worktree.path}`, normalizedFilter)
    );
    return rows.length > 0 ? (
      <div className="space-y-0.5 py-0.5">
        {rows.map((worktree) => (
          <SidebarRow
            key={worktree.path}
            icon={<FolderGit2 size={12} />}
            label={worktree.branch ?? worktree.path}
            meta={worktree.current ? 'current' : worktree.detached ? 'detached' : undefined}
            isActive={worktree.current}
            title={worktree.path}
          />
        ))}
      </div>
    ) : (
      <EmptySection label="No worktrees." />
    );
  }

  const rows = repositoryOverview.refs.tags.filter((tag) => matchesFilter(tag.name, normalizedFilter));
  return rows.length > 0 ? (
    <div className="space-y-0.5 py-0.5">
      {rows.map((tag) => (
        <SidebarRow
          key={tag.fullName}
          icon={<Tag size={12} />}
          label={tag.name}
          meta={tag.sha.slice(0, 7)}
          onContextMenu={(event) => onContextMenu(event, { kind: 'tag', tag })}
        />
      ))}
    </div>
  ) : (
    <EmptySection label="No tags." />
  );
}

function SidebarRow({
  icon,
  label,
  meta,
  isActive = false,
  title,
  onContextMenu,
  onDoubleClick
}: {
  icon: ReactNode;
  label: string;
  meta?: string;
  isActive?: boolean;
  title?: string;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
  onDoubleClick?: () => void;
}): ReactElement {
  return (
    <div
      className="flex h-7 min-w-0 items-center gap-2 rounded-md px-3 pl-9 text-xs text-[var(--text-2)]"
      style={{ background: isActive ? 'var(--select-bg)' : undefined }}
      title={title ?? label}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
    >
      <span className={isActive ? 'text-[var(--accent-2)]' : 'text-[var(--text-3)]'}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {meta ? <span className="shrink-0 text-[10.5px] text-[var(--text-3)]">{meta}</span> : null}
    </div>
  );
}

function SidebarContextMenu({
  state,
  isOperationBusy,
  onClose,
  onCheckoutBranch,
  onCheckoutRemoteBranch,
  onRenameBranch,
  onDeleteBranch,
  onDeleteTag
}: {
  state: SidebarContextMenuState;
  isOperationBusy: boolean;
  onClose: () => void;
  onCheckoutBranch: (name: string) => void;
  onCheckoutRemoteBranch: (name: string) => void;
  onRenameBranch: (name: string) => void;
  onDeleteBranch: (name: string) => void;
  onDeleteTag: (name: string) => void;
}): ReactElement {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: state.x, top: state.y });

  useLayoutEffect(() => {
    const menu = menuRef.current;

    if (!menu) {
      return;
    }

    const rect = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(state.x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(state.y, window.innerHeight - rect.height - 8))
    });
  }, [state]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-56 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-popover)] p-1.5 shadow-2xl shadow-black/60"
      style={{ left: position.left, top: position.top }}
      onClick={(event) => event.stopPropagation()}
    >
      {state.kind === 'local' ? (
        <>
          <button
            className="menu-row"
            type="button"
            disabled={state.branch.current || isOperationBusy}
            onClick={() => {
              onCheckoutBranch(state.branch.name);
              onClose();
            }}
          >
            <Check size={14} />
            <span>Checkout branch</span>
          </button>
          <button
            className="menu-row"
            type="button"
            disabled={isOperationBusy}
            onClick={() => {
              onRenameBranch(state.branch.name);
              onClose();
            }}
          >
            <Pencil size={14} />
            <span>Rename branch</span>
          </button>
          <button
            className="menu-row"
            type="button"
            disabled={state.branch.current || isOperationBusy}
            onClick={() => {
              onDeleteBranch(state.branch.name);
              onClose();
            }}
          >
            <Trash2 size={14} />
            <span>Delete branch</span>
          </button>
        </>
      ) : state.kind === 'remote' ? (
        <button
          className="menu-row"
          type="button"
          disabled={isOperationBusy}
          onClick={() => {
            onCheckoutRemoteBranch(state.branch.name);
            onClose();
          }}
        >
          <GitBranch size={14} />
          <span>Checkout tracking branch</span>
        </button>
      ) : (
        <button
          className="menu-row"
          type="button"
          disabled={isOperationBusy}
          onClick={() => {
            onDeleteTag(state.tag.name);
            onClose();
          }}
        >
          <Trash2 size={14} />
          <span>Delete tag</span>
        </button>
      )}
    </div>
  );
}

function EmptySection({ label }: { label: string }): ReactElement {
  return <p className="py-1.5 pl-11 pr-3 text-xs leading-5 text-[var(--text-3)]">{label}</p>;
}

function matchesFilter(value: string, filter: string): boolean {
  return filter.length === 0 || value.toLowerCase().includes(filter);
}

function formatAheadBehind(ahead: number, behind: number): string | undefined {
  if (ahead > 0 && behind > 0) {
    return `+${ahead}/-${behind}`;
  }

  if (ahead > 0) {
    return `+${ahead}`;
  }

  if (behind > 0) {
    return `-${behind}`;
  }

  return undefined;
}

function StatusSummary({
  repositoryOverview
}: {
  repositoryOverview?: GitRepositoryOverview;
}): ReactElement | null {
  if (!repositoryOverview) {
    return null;
  }

  const status = repositoryOverview.status;

  return (
    <div className="border-b border-[var(--border)] px-3 pb-2 pt-1.5">
      <div className="rounded-md border border-[var(--border)] bg-[var(--bg-field)] px-3 py-2">
        <div className="mb-1.5 flex items-center justify-between text-[11px] uppercase tracking-[0.08em] text-[var(--text-3)]">
          <span>Working Tree</span>
          <span>{status.isDirty ? `${status.dirtyCount} changed` : 'clean'}</span>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] text-[var(--text-2)]">
          <StatusCount icon={<Pencil size={11} />} label="staged" count={status.stagedCount} status="modified" />
          <StatusCount icon={<Plus size={12} />} label="unstaged" count={status.unstagedCount} status="added" />
          <StatusCount icon={<Minus size={12} />} label="conflicts" count={status.conflictedCount} status="deleted" />
        </div>
      </div>
    </div>
  );
}

function StatusCount({
  icon,
  label,
  count,
  status
}: {
  icon: ReactNode;
  label: string;
  count: number;
  status: GitStatusCode;
}): ReactElement {
  return (
    <span className="flex items-center gap-1.5">
      <span style={{ color: statusColor(status) }}>{icon}</span>
      {count} {label}
    </span>
  );
}

function statusColor(status: GitStatusCode): string {
  if (status === 'added') {
    return FILE_STATUS_COLORS.added;
  }

  if (status === 'deleted') {
    return FILE_STATUS_COLORS.deleted;
  }

  return FILE_STATUS_COLORS.modified;
}
