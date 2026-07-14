import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent, PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  FolderGit2,
  GitBranch,
  Laptop,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Search,
  Tag,
  Trash2
} from 'lucide-react';

import { handleMenuKeyDown } from '@renderer/components/accessibility/menuKeyboard';
import type { GitBranchRef, GitRemoteBranchRef, GitRepositoryOverview, GitStashEntry, GitStashRefInput, GitTagRef, RepoTab } from '@shared/types';
import { DEFAULT_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, normalizeSidebarWidth } from '@shared/workspace';

type SidebarProps = {
  activeTab?: RepoTab;
  repositoryOverview?: GitRepositoryOverview;
  isLoading: boolean;
  isRefreshing: boolean;
  errorMessage?: string;
  isCollapsed: boolean;
  width: number;
  filterFocusSignal: number;
  onToggleCollapsed: () => void;
  onResize: (width: number) => void;
  onResizeCommit: (width: number) => void;
  isOperationBusy: boolean;
  onCheckoutBranch: (name: string) => void;
  onCheckoutRemoteBranch: (name: string) => void;
  onRenameBranch: (name: string) => void;
  onDeleteBranch: (name: string) => void;
  onDeleteTag: (name: string) => void;
  onStashApply: (input: GitStashRefInput) => void;
  onStashPop: (input: GitStashRefInput) => void;
  onStashDrop: (input: GitStashRefInput) => void;
};

type SectionId = 'local' | 'remote' | 'worktrees' | 'stashes' | 'tags';

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
    }
  | {
      kind: 'stash';
      stash: GitStashEntry;
    };

type SidebarContextMenuState = SidebarContextMenuTarget & {
  x: number;
  y: number;
};

type SidebarResizeState = {
  startX: number;
  startWidth: number;
  width: number;
};

const SECTIONS: Array<{ id: SectionId; title: string; icon: ReactNode }> = [
  { id: 'local', title: 'Local', icon: <Laptop size={14} /> },
  { id: 'remote', title: 'Remote', icon: <Cloud size={14} /> },
  { id: 'worktrees', title: 'Worktrees', icon: <FolderGit2 size={14} /> },
  { id: 'stashes', title: 'Stashes', icon: <Archive size={14} /> },
  { id: 'tags', title: 'Tags', icon: <Tag size={14} /> }
];

const SIDEBAR_REF_PAGE_SIZE = 10;

export function Sidebar({
  activeTab,
  repositoryOverview,
  isLoading,
  isRefreshing,
  errorMessage,
  isCollapsed,
  width,
  filterFocusSignal,
  onToggleCollapsed,
  onResize,
  onResizeCommit,
  isOperationBusy,
  onCheckoutBranch,
  onCheckoutRemoteBranch,
  onRenameBranch,
  onDeleteBranch,
  onDeleteTag,
  onStashApply,
  onStashPop,
  onStashDrop
}: SidebarProps): ReactElement {
  const resizeStateRef = useRef<SidebarResizeState | undefined>(undefined);
  const contextMenuReturnFocusRef = useRef<HTMLElement | null>(null);
  const [expanded, setExpanded] = useState<Record<SectionId, boolean>>({
    local: true,
    remote: false,
    worktrees: false,
    stashes: false,
    tags: false
  });
  const [filter, setFilter] = useState('');
  const [contextMenu, setContextMenu] = useState<SidebarContextMenuState>();
  const [isResizing, setIsResizing] = useState(false);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const counts = {
    local: repositoryOverview?.refs.localBranches.length ?? 0,
    remote: repositoryOverview?.refs.remoteBranches.length ?? 0,
    worktrees: repositoryOverview?.worktrees.length ?? 0,
    stashes: repositoryOverview?.stashes.length ?? 0,
    tags: repositoryOverview?.refs.tags.length ?? 0
  };
  const viewingCount = counts.local + counts.remote + counts.worktrees + counts.stashes + counts.tags;

  useEffect(() => {
    if (filterFocusSignal > 0 && !isCollapsed) {
      filterInputRef.current?.focus({ preventScroll: true });
    }
  }, [filterFocusSignal, isCollapsed]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setContextMenu(undefined);
        contextMenuReturnFocusRef.current?.focus({ preventScroll: true });
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

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function handlePointerMove(event: PointerEvent): void {
      const state = resizeStateRef.current;

      if (!state) {
        return;
      }

      const nextWidth = normalizeSidebarWidth(state.startWidth + event.clientX - state.startX);
      state.width = nextWidth;
      onResize(nextWidth);
    }

    function stopResize(): void {
      const nextWidth = resizeStateRef.current?.width;
      resizeStateRef.current = undefined;
      setIsResizing(false);

      if (typeof nextWidth === 'number') {
        onResizeCommit(nextWidth);
      }
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizing, onResize, onResizeCommit]);

  function handleRowContextMenu(event: MouseEvent<HTMLElement>, state: SidebarContextMenuTarget): void {
    event.preventDefault();
    contextMenuReturnFocusRef.current = event.currentTarget;
    setContextMenu({
      ...state,
      x: event.clientX,
      y: event.clientY
    });
  }

  function handleResizeStart(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: width,
      width
    };
    setIsResizing(true);
  }

  function handleResizeNudge(delta: number): void {
    const nextWidth = normalizeSidebarWidth(width + delta);
    onResize(nextWidth);
    onResizeCommit(nextWidth);
  }

  function handleResizeReset(): void {
    onResize(DEFAULT_SIDEBAR_WIDTH);
    onResizeCommit(DEFAULT_SIDEBAR_WIDTH);
  }

  if (isCollapsed) {
    return (
      <aside className="workspace-sidebar flex w-12 shrink-0 flex-col items-center gap-1 border-r border-[var(--border)] bg-[var(--bg-sidebar)] py-2" aria-label="Repository navigation">
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
    <aside
      className="workspace-sidebar relative flex shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg-sidebar)]"
      style={{ width: normalizeSidebarWidth(width) }}
      aria-label="Repository navigation"
      aria-busy={isLoading || isRefreshing}
    >
      <SidebarResizeHandle
        value={width}
        isActive={isResizing}
        onPointerDown={handleResizeStart}
        onNudge={handleResizeNudge}
        onReset={handleResizeReset}
      />
      <div className="border-b border-[var(--border)] px-3 pb-2 pt-2">
        <div className="flex items-center gap-2">
          <button className="icon-btn h-7 w-7" type="button" onClick={onToggleCollapsed} aria-label="Collapse sidebar">
            <PanelLeftClose size={14} />
          </button>
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--text-1)]">Repository</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-[var(--text-2)]">
          <span>
            Viewing <span className="font-semibold text-[var(--text-1)]">{viewingCount}</span>
          </span>
          {isRefreshing ? (
            <span className="flex items-center gap-1 text-[var(--text-3)]">
              <Loader2 size={11} className="animate-spin" />
              Refreshing
            </span>
          ) : null}
        </div>
        <div className="relative mt-1.5 min-w-0 flex-1">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input
            ref={filterInputRef}
            className="h-7 w-full rounded-md border border-[var(--border)] bg-[var(--bg-field)] pl-7 pr-2 text-xs text-[var(--text-1)] placeholder-[var(--text-3)] outline-none transition focus:border-[var(--border-strong)]"
            placeholder="Filter (⌘⌥F)"
            aria-label="Filter repository references"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" role="tree" aria-label="Branches, worktrees, stashes, and tags">
        {SECTIONS.map((section) => {
          const isExpanded = expanded[section.id];
          const sectionCount = counts[section.id as keyof typeof counts];

          return (
            <section key={section.id} className="sidebar-section m-0" role="group">
              <button
                className="side-section"
                type="button"
                role="treeitem"
                aria-expanded={isExpanded}
                aria-level={1}
                onClick={() => setExpanded((value) => ({ ...value, [section.id]: !value[section.id] }))}
                onKeyDown={handleSidebarTreeKeyDown}
              >
                {isExpanded ? (
                  <ChevronDown size={13} className="shrink-0 text-[var(--text-3)]" />
                ) : (
                  <ChevronRight size={13} className="shrink-0 text-[var(--text-3)]" />
                )}
                <span className="shrink-0 text-[var(--text-3)]">{section.icon}</span>
                <span className="min-w-0 flex-1 truncate text-left uppercase">{section.title}</span>
                {typeof sectionCount === 'number' ? (
                  <span className="shrink-0 text-[11px] font-normal text-[var(--text-3)]">{sectionCount}</span>
                ) : null}
              </button>
              {isExpanded ? (
                <SectionRows
                  key={`${repositoryOverview?.repoPath ?? 'empty'}:${section.id}`}
                  sectionId={section.id}
                  repositoryOverview={repositoryOverview}
                  filter={filter}
                  isLoading={isLoading}
                  isOperationBusy={isOperationBusy}
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
          onStashApply={onStashApply}
          onStashPop={onStashPop}
          onStashDrop={onStashDrop}
        />
      ) : null}
    </aside>
  );
}

function SidebarResizeHandle({
  value,
  isActive,
  onPointerDown,
  onNudge,
  onReset
}: {
  value: number;
  isActive: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onNudge: (delta: number) => void;
  onReset: () => void;
}): ReactElement {
  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const step = event.shiftKey ? 48 : 16;

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onNudge(-step);
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      onNudge(step);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      onNudge(MIN_SIDEBAR_WIDTH - value);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      onNudge(MAX_SIDEBAR_WIDTH - value);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onReset();
    }
  }

  return (
    <div
      className="sidebar-resizer"
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      aria-valuenow={Math.round(value)}
      data-active={isActive ? 'true' : undefined}
      title="Drag to resize. Double-click to reset."
      onPointerDown={onPointerDown}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onReset();
      }}
      onKeyDown={handleKeyDown}
    />
  );
}

type SectionRowsProps = {
  sectionId: SectionId;
  repositoryOverview?: GitRepositoryOverview;
  filter: string;
  isLoading: boolean;
  isOperationBusy: boolean;
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
  isOperationBusy,
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
    return (
      <PaginatedRefRows
        items={rows.map((branch) => (
          <SidebarRow
            key={branch.fullName}
            icon={<GitBranch size={12} />}
            label={branch.name}
            meta={formatAheadBehind(branch.ahead, branch.behind)}
            isActive={branch.current}
            isActionDisabled={branch.current || isOperationBusy}
            title={isOperationBusy && !branch.current ? 'A Git operation is running' : branch.name}
            onContextMenu={(event) => onContextMenu(event, { kind: 'local', branch })}
            onDoubleClick={() => {
              if (!branch.current) {
                onCheckoutBranch(branch.name);
              }
            }}
          />
        ))}
        emptyLabel="No local branches."
        itemLabel="local branches"
        isFiltering={normalizedFilter.length > 0}
      />
    );
  }

  if (sectionId === 'remote') {
    const rows = repositoryOverview.refs.remoteBranches.filter((branch) => matchesFilter(branch.name, normalizedFilter));
    return (
      <PaginatedRefRows
        items={rows.map((branch) => (
          <SidebarRow
            key={branch.fullName}
            icon={<Cloud size={12} />}
            label={branch.name}
            meta={branch.sha.slice(0, 7)}
            isActionDisabled={isOperationBusy}
            title={isOperationBusy ? 'A Git operation is running' : branch.name}
            onContextMenu={(event) => onContextMenu(event, { kind: 'remote', branch })}
            onDoubleClick={() => onCheckoutRemoteBranch(branch.name)}
          />
        ))}
        emptyLabel="No remote branches."
        itemLabel="remote branches"
        isFiltering={normalizedFilter.length > 0}
      />
    );
  }

  if (sectionId === 'worktrees') {
    const rows = repositoryOverview.worktrees.filter((worktree) =>
      matchesFilter(`${worktree.branch ?? worktree.path} ${worktree.path}`, normalizedFilter)
    );
    return rows.length > 0 ? (
      <div className="py-1">
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

  if (sectionId === 'stashes') {
    const rows = repositoryOverview.stashes.filter((stash) =>
      matchesFilter(`${stash.selector} ${stash.subject}`, normalizedFilter)
    );

    return rows.length > 0 ? (
      <div className="py-1">
        {rows.map((stash) => (
          <SidebarRow
            key={stash.selector}
            icon={<Archive size={12} />}
            label={formatStashSubject(stash.subject)}
            meta={stash.selector}
            title={`${stash.selector} ${stash.subject}`}
            onContextMenu={(event) => onContextMenu(event, { kind: 'stash', stash })}
          />
        ))}
      </div>
    ) : (
      <EmptySection label="No stashes." />
    );
  }

  if (sectionId !== 'tags') {
    return <EmptySection label="Not available in the local build." />;
  }

  const rows = repositoryOverview.refs.tags.filter((tag) => matchesFilter(tag.name, normalizedFilter));
  return (
    <PaginatedRefRows
      items={rows.map((tag) => (
        <SidebarRow
          key={tag.fullName}
          icon={<Tag size={12} />}
          label={tag.name}
          meta={tag.sha.slice(0, 7)}
          onContextMenu={(event) => onContextMenu(event, { kind: 'tag', tag })}
        />
      ))}
      emptyLabel="No tags."
      itemLabel="tags"
      isFiltering={normalizedFilter.length > 0}
    />
  );
}

function PaginatedRefRows({
  items,
  emptyLabel,
  itemLabel,
  isFiltering
}: {
  items: ReactElement[];
  emptyLabel: string;
  itemLabel: string;
  isFiltering: boolean;
}): ReactElement {
  const [visibleCount, setVisibleCount] = useState(SIDEBAR_REF_PAGE_SIZE);

  if (items.length === 0) {
    return <EmptySection label={emptyLabel} />;
  }

  const visibleItems = isFiltering ? items : items.slice(0, visibleCount);
  const remainingCount = items.length - visibleItems.length;
  const nextPageSize = Math.min(SIDEBAR_REF_PAGE_SIZE, remainingCount);
  const canShowLess = !isFiltering && visibleItems.length > SIDEBAR_REF_PAGE_SIZE;
  const hasDisplayControls = canShowLess || remainingCount > 0;

  return (
    <div className="py-1">
      {visibleItems}
      {hasDisplayControls ? (
        <div className="side-ref-controls" role="group" aria-label={`${itemLabel} display controls`}>
          {canShowLess ? (
            <button
              className="side-ref-action"
              type="button"
              role="treeitem"
              aria-level={2}
              aria-label={`Show only the first ${SIDEBAR_REF_PAGE_SIZE} ${itemLabel}`}
              onClick={() => setVisibleCount(SIDEBAR_REF_PAGE_SIZE)}
              onKeyDown={handleSidebarTreeKeyDown}
            >
              Show less
            </button>
          ) : null}
          {remainingCount > 0 ? (
            <button
              className="side-ref-action"
              type="button"
              role="treeitem"
              aria-level={2}
              aria-label={`Show ${nextPageSize} more ${itemLabel}`}
              onClick={() => setVisibleCount((count) => Math.min(count + SIDEBAR_REF_PAGE_SIZE, items.length))}
              onKeyDown={handleSidebarTreeKeyDown}
            >
              Show more
            </button>
          ) : null}
          {remainingCount > SIDEBAR_REF_PAGE_SIZE ? (
            <button
              className="side-ref-action"
              type="button"
              role="treeitem"
              aria-level={2}
              aria-label={`Show all ${items.length} ${itemLabel}`}
              onClick={() => setVisibleCount(items.length)}
              onKeyDown={handleSidebarTreeKeyDown}
            >
              Show all
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SidebarRow({
  icon,
  label,
  meta,
  isActive = false,
  isActionDisabled = false,
  title,
  onContextMenu,
  onDoubleClick
}: {
  icon: ReactNode;
  label: string;
  meta?: string;
  isActive?: boolean;
  isActionDisabled?: boolean;
  title?: string;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
  onDoubleClick?: () => void;
}): ReactElement {
  return (
    <div
      className="side-row"
      data-active={isActive}
      title={title ?? label}
      role="treeitem"
      aria-level={2}
      aria-current={isActive ? 'page' : undefined}
      aria-disabled={isActionDisabled || undefined}
      tabIndex={isActive ? 0 : -1}
      onContextMenu={onContextMenu}
      onDoubleClick={isActionDisabled ? undefined : onDoubleClick}
      onKeyDown={(event) => {
        handleSidebarTreeKeyDown(event);

        if ((event.key === 'Enter' || event.key === ' ') && onDoubleClick && !isActionDisabled) {
          event.preventDefault();
          onDoubleClick();
          return;
        }

        if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && onContextMenu) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          event.currentTarget.dispatchEvent(
            new globalThis.MouseEvent('contextmenu', {
              bubbles: true,
              cancelable: true,
              clientX: rect.left + Math.min(24, rect.width / 2),
              clientY: rect.top + rect.height / 2
            })
          );
        }
      }}
    >
      <span className="side-row-icon">{isActive ? <Check size={12} /> : icon}</span>
      <span className="side-row-label">{label}</span>
      {meta ? <span className="side-row-meta">{meta}</span> : null}
    </div>
  );
}

function handleSidebarTreeKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
  const tree = event.currentTarget.closest('[role="tree"]');

  if (!tree) {
    return;
  }

  const items = Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]')).filter(
    (item) => item.offsetParent !== null
  );
  const currentIndex = items.indexOf(event.currentTarget);
  let nextIndex: number | undefined;

  if (event.key === 'ArrowDown') {
    nextIndex = Math.min(items.length - 1, currentIndex + 1);
  } else if (event.key === 'ArrowUp') {
    nextIndex = Math.max(0, currentIndex - 1);
  } else if (event.key === 'Home') {
    nextIndex = 0;
  } else if (event.key === 'End') {
    nextIndex = items.length - 1;
  }

  if (typeof nextIndex !== 'number' || nextIndex === currentIndex) {
    return;
  }

  event.preventDefault();
  items[nextIndex]?.focus();
}

function SidebarContextMenu({
  state,
  isOperationBusy,
  onClose,
  onCheckoutBranch,
  onCheckoutRemoteBranch,
  onRenameBranch,
  onDeleteBranch,
  onDeleteTag,
  onStashApply,
  onStashPop,
  onStashDrop
}: {
  state: SidebarContextMenuState;
  isOperationBusy: boolean;
  onClose: () => void;
  onCheckoutBranch: (name: string) => void;
  onCheckoutRemoteBranch: (name: string) => void;
  onRenameBranch: (name: string) => void;
  onDeleteBranch: (name: string) => void;
  onDeleteTag: (name: string) => void;
  onStashApply: (input: GitStashRefInput) => void;
  onStashPop: (input: GitStashRefInput) => void;
  onStashDrop: (input: GitStashRefInput) => void;
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
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [state]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-56 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-popover)] p-1.5 shadow-2xl shadow-black/60"
      style={{ left: position.left, top: position.top }}
      role="menu"
      aria-label="Reference actions"
      onKeyDown={(event) => handleMenuKeyDown(event, onClose)}
      onClick={(event) => event.stopPropagation()}
    >
      {state.kind === 'local' ? (
        <>
          <button
            className="menu-row"
            type="button"
            role="menuitem"
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
            role="menuitem"
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
            role="menuitem"
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
          role="menuitem"
          disabled={isOperationBusy}
          onClick={() => {
            onCheckoutRemoteBranch(state.branch.name);
            onClose();
          }}
        >
          <GitBranch size={14} />
          <span>Checkout tracking branch</span>
        </button>
      ) : state.kind === 'tag' ? (
        <button
          className="menu-row"
          type="button"
          role="menuitem"
          disabled={isOperationBusy}
          onClick={() => {
            onDeleteTag(state.tag.name);
            onClose();
          }}
        >
          <Trash2 size={14} />
          <span>Delete tag</span>
        </button>
      ) : (
        <>
          <button
            className="menu-row"
            type="button"
            role="menuitem"
            disabled={isOperationBusy}
            onClick={() => {
              onStashApply({ selector: state.stash.selector, expectedSha: state.stash.sha });
              onClose();
            }}
          >
            <Archive size={14} />
            <span>Apply stash</span>
          </button>
          <button
            className="menu-row"
            type="button"
            role="menuitem"
            disabled={isOperationBusy}
            onClick={() => {
              onStashPop({ selector: state.stash.selector, expectedSha: state.stash.sha });
              onClose();
            }}
          >
            <Archive size={14} />
            <span>Pop stash</span>
          </button>
          <button
            className="menu-row"
            type="button"
            role="menuitem"
            disabled={isOperationBusy}
            onClick={() => {
              onStashDrop({ selector: state.stash.selector, expectedSha: state.stash.sha });
              onClose();
            }}
          >
            <Trash2 size={14} />
            <span>Drop stash</span>
          </button>
        </>
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

function formatStashSubject(subject: string): string {
  return subject.replace(/^(WIP|On) on [^:]+:\s*/, '') || subject;
}
