import type { ReactElement, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  ChevronRight,
  FolderGit2,
  GitBranch,
  GitMerge,
  GitPullRequestArrow,
  Loader2,
  MoreHorizontal,
  Search,
  Tag,
  Terminal,
  Undo2,
  Workflow
} from 'lucide-react';

import { handleMenuKeyDown } from '@renderer/components/accessibility/menuKeyboard';

import type { GitRepositoryOverview, GitUndoEntry, RepoTab } from '@shared/types';

type ToolbarProps = {
  activeTab?: RepoTab;
  repositoryOverview?: GitRepositoryOverview;
  isBusy: boolean;
  latestUndo?: GitUndoEntry;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
  onCreateBranch: () => void;
  onStashPush: () => void;
  onStashPop: () => void;
  onUndo: () => void;
  onOpenTerminal: () => void;
  onOpenQuickJump: () => void;
  onMergeSelected: () => void;
  onRebaseSelected: () => void;
  onInteractiveRebaseSelected: () => void;
  onTagSelected: () => void;
  hasSelectedCommit: boolean;
};

export function Toolbar({
  activeTab,
  repositoryOverview,
  isBusy,
  latestUndo,
  onFetch,
  onPull,
  onPush,
  onCreateBranch,
  onStashPush,
  onStashPop,
  onUndo,
  onOpenTerminal,
  onOpenQuickJump,
  onMergeSelected,
  onRebaseSelected,
  onInteractiveRebaseSelected,
  onTagSelected,
  hasSelectedCommit
}: ToolbarProps): ReactElement {
  const hasRepo = Boolean(activeTab);
  const branchLabel = repositoryOverview ? formatBranchLabel(repositoryOverview) : hasRepo ? 'Loading…' : '—';
  const dirtyCount = repositoryOverview?.status.dirtyCount ?? 0;
  const hasStashes = (repositoryOverview?.stashes.length ?? 0) > 0;
  const undoTitle = latestUndo?.staleReason ?? latestUndo?.label ?? 'No undoable operation';

  return (
    <div className="app-toolbar flex h-[56px] shrink-0 items-center border-b border-[var(--border)] bg-[var(--bg-toolbar)] px-2">
      <div className="tb-context flex h-full min-w-0 items-center">
        <button className="tb-select" type="button" disabled={!hasRepo} title={activeTab?.path} onClick={onOpenQuickJump}>
          <span className="tb-select-label">repository</span>
          <span className="tb-select-value">
            <FolderGit2 size={13} className="shrink-0 text-[var(--text-3)]" />
            <span className="min-w-0 truncate">{activeTab?.name ?? 'No repository'}</span>
            <ChevronDown size={12} className="shrink-0 text-[var(--text-3)]" />
          </span>
        </button>
        <ChevronRight size={14} className="mx-0.5 shrink-0 text-[var(--text-3)]" />
        <button className="tb-select" type="button" disabled={!hasRepo || isBusy} title="Switch branch" onClick={onOpenQuickJump}>
          <span className="tb-select-label">branch</span>
          <span className="tb-select-value">
            <GitBranch size={13} className="shrink-0 text-[var(--text-3)]" />
            <span className={hasRepo ? 'text-[var(--text-2)]' : 'text-[var(--text-3)]'}>
              {branchLabel}
            </span>
            {dirtyCount > 0 ? (
              <span className="rounded border border-[var(--border-strong)] px-1 text-[10px] text-[var(--accent-2)]">
                {dirtyCount}
              </span>
            ) : null}
            <ChevronDown size={12} className="shrink-0 text-[var(--text-3)]" />
          </span>
        </button>
      </div>

      <div className="flex h-full flex-1 items-center justify-center">
        <ToolbarAction
          label="Undo"
          icon={isBusy ? <Loader2 size={17} className="animate-spin" /> : <Undo2 size={17} />}
          hint={undoTitle}
          disabled={!latestUndo || Boolean(latestUndo.staleReason) || isBusy}
          onClick={onUndo}
        />
        <ToolbarAction
          label="Fetch"
          icon={<ArrowDownToLine size={17} />}
          hint="Fetch and prune all remotes"
          disabled={!hasRepo || isBusy}
          onClick={onFetch}
          emphasized={hasRepo}
        />
        <ToolbarAction
          label="Pull"
          icon={<GitPullRequestArrow size={17} />}
          hint="Pull with fast-forward only"
          disabled={!hasRepo || isBusy}
          onClick={onPull}
          emphasized={hasRepo}
        />
        <ToolbarAction
          label="Push"
          icon={<ArrowUpFromLine size={17} />}
          hint="Push current branch"
          disabled={!hasRepo || isBusy}
          onClick={onPush}
          emphasized={hasRepo}
        />
        <ToolbarAction
          label="Branch"
          icon={<GitBranch size={17} />}
          hint="Create branch"
          disabled={!hasRepo || isBusy}
          onClick={onCreateBranch}
          emphasized={hasRepo}
        />
        <ToolbarAction
          label="Stash"
          icon={<Archive size={17} />}
          hint="Stash changes"
          disabled={!hasRepo || dirtyCount === 0 || isBusy}
          onClick={onStashPush}
        />
        <ToolbarAction
          label="Pop"
          icon={<ArchiveRestore size={17} />}
          hint="Pop latest stash"
          disabled={!hasRepo || !hasStashes || isBusy}
          onClick={onStashPop}
        />
        <div className="tb-divider" />
        <ToolbarAction
          label="Terminal"
          icon={<Terminal size={17} />}
          hint="Open Terminal.app at this repository"
          disabled={!hasRepo || isBusy}
          onClick={onOpenTerminal}
          emphasized={hasRepo}
          className="tb-action-optional"
        />
      </div>

      <div className="flex h-full shrink-0 items-center">
        <ActionsMenu
          disabled={!hasRepo || isBusy}
          hasSelectedCommit={hasSelectedCommit}
          onOpenQuickJump={onOpenQuickJump}
          onMergeSelected={onMergeSelected}
          onRebaseSelected={onRebaseSelected}
          onInteractiveRebaseSelected={onInteractiveRebaseSelected}
          onTagSelected={onTagSelected}
        />
        <ToolbarAction
          label="Jump"
          icon={<Search size={17} />}
          hint="Jump to repository or branch"
          disabled={!hasRepo}
          onClick={onOpenQuickJump}
        />
      </div>
    </div>
  );
}

function ActionsMenu({
  disabled,
  hasSelectedCommit,
  onOpenQuickJump,
  onMergeSelected,
  onRebaseSelected,
  onInteractiveRebaseSelected,
  onTagSelected
}: {
  disabled: boolean;
  hasSelectedCommit: boolean;
  onOpenQuickJump: () => void;
  onMergeSelected: () => void;
  onRebaseSelected: () => void;
  onInteractiveRebaseSelected: () => void;
  onTagSelected: () => void;
}): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    function closeOnPointerDown(event: PointerEvent): void {
      if (!shellRef.current?.contains(event.target as Node)) setIsOpen(false);
    }

    window.addEventListener('pointerdown', closeOnPointerDown);
    return () => window.removeEventListener('pointerdown', closeOnPointerDown);
  }, [isOpen]);

  function run(action: () => void): void {
    setIsOpen(false);
    action();
  }

  return (
    <div ref={shellRef} className="relative">
      <ToolbarAction
        label="Actions"
        icon={<MoreHorizontal size={17} />}
        hint="Git actions for the selected commit"
        disabled={disabled}
        onClick={() => setIsOpen((value) => !value)}
      />
      {isOpen ? (
        <div
          ref={menuRef}
          className="absolute right-1 top-[48px] z-50 w-64 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-popover)] p-1.5 shadow-2xl shadow-black/60"
          role="menu"
          aria-label="Git actions"
          onKeyDown={(event) => handleMenuKeyDown(event, () => setIsOpen(false))}
        >
          <ActionMenuItem icon={<GitMerge size={14} />} label="Merge selected into current" disabled={!hasSelectedCommit} onClick={() => run(onMergeSelected)} />
          <ActionMenuItem icon={<Workflow size={14} />} label="Rebase current onto selected" disabled={!hasSelectedCommit} onClick={() => run(onRebaseSelected)} />
          <ActionMenuItem icon={<Workflow size={14} />} label="Interactive rebase from selected" disabled={!hasSelectedCommit} onClick={() => run(onInteractiveRebaseSelected)} />
          <div className="my-1 border-t border-[var(--border)]" />
          <ActionMenuItem icon={<Tag size={14} />} label="Tag selected commit" disabled={!hasSelectedCommit} onClick={() => run(onTagSelected)} />
          <div className="my-1 border-t border-[var(--border)]" />
          <ActionMenuItem icon={<Search size={14} />} label="All commands…" onClick={() => run(onOpenQuickJump)} shortcut="⌘P" />
        </div>
      ) : null}
    </div>
  );
}

function ActionMenuItem({ icon, label, shortcut, disabled = false, onClick }: { icon: ReactNode; label: string; shortcut?: string; disabled?: boolean; onClick: () => void }): ReactElement {
  return (
    <button className="menu-row" type="button" role="menuitem" disabled={disabled} onClick={onClick}>
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {shortcut ? <kbd className="text-[10px] text-[var(--text-3)]">{shortcut}</kbd> : null}
    </button>
  );
}

function formatBranchLabel(repositoryOverview: GitRepositoryOverview): string {
  const branch = repositoryOverview.status.branch;

  if (branch.isDetached) {
    return branch.oid ? `detached ${branch.oid.slice(0, 7)}` : 'detached';
  }

  return branch.head;
}

type ToolbarActionProps = {
  label: string;
  icon: ReactNode;
  hint: string;
  emphasized?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
};

function ToolbarAction({ label, icon, hint, emphasized = false, disabled = true, onClick, className = '' }: ToolbarActionProps): ReactElement {
  return (
    <button
      className={`tb-action ${className}`.trim()}
      type="button"
      disabled={disabled}
      title={hint}
      onClick={onClick}
      style={emphasized && !disabled ? { opacity: 1, color: 'var(--text-2)' } : undefined}
    >
      <span className="tb-action-label">{label}</span>
      <span className="tb-action-icon">{icon}</span>
    </button>
  );
}
