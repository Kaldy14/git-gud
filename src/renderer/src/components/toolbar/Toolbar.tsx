import type { ReactElement, ReactNode } from 'react';
import { useRef } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  ChevronRight,
  FolderGit2,
  GitBranch,
  GitMerge,
  GitPullRequestArrow,
  MoreHorizontal,
  Search,
  Tag,
  Undo2,
  Workflow
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu';

import type { GitRepositoryOverview, GitUndoEntry, PrimarySyncOperation, RepoTab } from '@shared/types';

type ToolbarProps = {
  activeTab?: RepoTab;
  repositoryOverview?: GitRepositoryOverview;
  isBusy: boolean;
  latestUndo?: GitUndoEntry;
  defaultSyncOperation: PrimarySyncOperation;
  onSync: (operation: PrimarySyncOperation) => void;
  onChangeDefaultSyncOperation: (operation: PrimarySyncOperation) => void;
  onPush: () => void;
  onCreateBranch: () => void;
  onStashPush: () => void;
  onStashPop: () => void;
  onUndo: () => void;
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
  defaultSyncOperation,
  onSync,
  onChangeDefaultSyncOperation,
  onPush,
  onCreateBranch,
  onStashPush,
  onStashPop,
  onUndo,
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
  const hasConflicts = (repositoryOverview?.status.conflictedCount ?? 0) > 0;
  const hasStashes = (repositoryOverview?.stashes.length ?? 0) > 0;
  const undoTitle = latestUndo?.staleReason ?? latestUndo?.label ?? 'No undoable operation';

  return (
    <div className="app-toolbar h-12 shrink-0 items-center border-b border-[var(--border)] bg-[var(--bg-toolbar)] px-2">
      <div className="tb-context flex h-full min-w-0 items-center">
        <button className="tb-select" type="button" disabled={!hasRepo} title={activeTab?.path} onClick={onOpenQuickJump}>
          <span className="tb-select-label">repository</span>
          <span className="tb-select-value">
            <FolderGit2 size={13} className="shrink-0 text-[var(--text-3)]" />
            <span className="min-w-0 flex-1 truncate whitespace-nowrap">{activeTab?.name ?? 'No repository'}</span>
            <ChevronDown size={12} className="shrink-0 text-[var(--text-3)]" />
          </span>
        </button>
        <ChevronRight size={14} className="mx-0.5 shrink-0 text-[var(--text-3)]" />
        <button
          className="tb-select tb-select-branch"
          type="button"
          disabled={!hasRepo || isBusy}
          title="Switch branch"
          onClick={onOpenQuickJump}
        >
          <span className="tb-select-label">branch</span>
          <span className="tb-select-value">
            <GitBranch size={13} className="shrink-0 text-[var(--text-3)]" />
            <span
              className={`min-w-0 flex-1 truncate whitespace-nowrap ${hasRepo ? 'text-[var(--text-2)]' : 'text-[var(--text-3)]'}`}
              title={branchLabel}
            >
              {branchLabel}
            </span>
            {dirtyCount > 0 ? (
              <span className="shrink-0 rounded border border-[var(--border-strong)] px-1 text-[10px] text-[var(--accent-2)]">
                {dirtyCount}
              </span>
            ) : null}
            <ChevronDown size={12} className="shrink-0 text-[var(--text-3)]" />
          </span>
        </button>
      </div>

      <div className="flex h-full items-center justify-center">
        <ToolbarAction
          label="Undo"
          icon={<Undo2 size={17} />}
          hint={undoTitle}
          disabled={!latestUndo || Boolean(latestUndo.staleReason) || isBusy}
          onClick={onUndo}
        />
        <PrimarySyncAction
          operation={defaultSyncOperation}
          disabled={!hasRepo || isBusy}
          onRun={() => onSync(defaultSyncOperation)}
          onChange={onChangeDefaultSyncOperation}
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
          hint={hasConflicts ? 'Resolve conflicts before stashing' : 'Choose files to stash'}
          disabled={!hasRepo || dirtyCount === 0 || hasConflicts || isBusy}
          onClick={onStashPush}
        />
        <ToolbarAction
          label="Pop"
          icon={<ArchiveRestore size={17} />}
          hint="Pop latest stash"
          disabled={!hasRepo || !hasStashes || isBusy}
          onClick={onStashPop}
        />
      </div>

      <div className="flex h-full shrink-0 items-center justify-self-end">
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

const primarySyncOptions: ReadonlyArray<{
  operation: PrimarySyncOperation;
  label: string;
  buttonLabel: string;
  hint: string;
}> = [
  {
    operation: 'fetch-all',
    label: 'Fetch All',
    buttonLabel: 'Fetch',
    hint: 'Fetch and prune all remotes'
  },
  {
    operation: 'pull-ff',
    label: 'Pull (fast-forward if possible)',
    buttonLabel: 'Pull',
    hint: 'Fast-forward when possible, otherwise create a merge commit'
  },
  {
    operation: 'pull-ff-only',
    label: 'Pull (fast-forward only)',
    buttonLabel: 'Pull',
    hint: 'Pull only when the branch can fast-forward'
  },
  {
    operation: 'pull-rebase',
    label: 'Pull (rebase)',
    buttonLabel: 'Pull',
    hint: 'Rebase local commits onto the upstream branch'
  }
];

function PrimarySyncAction({
  operation,
  disabled,
  onRun,
  onChange
}: {
  operation: PrimarySyncOperation;
  disabled: boolean;
  onRun: () => void;
  onChange: (operation: PrimarySyncOperation) => void;
}): ReactElement {
  const selected = primarySyncOptions.find((option) => option.operation === operation) ?? primarySyncOptions[0];
  const icon = operation === 'fetch-all'
    ? <ArrowDownToLine size={17} />
    : <GitPullRequestArrow size={17} />;

  return (
    <div className="tb-sync-control">
      <ToolbarAction
        label={selected.buttonLabel}
        icon={icon}
        hint={selected.hint}
        disabled={disabled}
        onClick={onRun}
        emphasized
        className="tb-sync-action"
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="tb-sync-menu-trigger"
            type="button"
            disabled={disabled}
            title="Choose the default sync operation"
            aria-label={`Choose the default sync operation. Current: ${selected.label}`}
          >
            <ChevronDown size={11} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={-2} className="w-72" aria-label="Default sync operation">
          <p className="px-2 py-1.5 text-[11px] leading-4 text-[var(--text-3)]">
            Choose what the main sync button does
          </p>
          <DropdownMenuSeparator className="mx-0 my-1" />
          {primarySyncOptions.map((option) => (
            <DropdownMenuItem key={option.operation} onSelect={() => onChange(option.operation)}>
              <span className="grid w-4 shrink-0 place-items-center">
                {option.operation === operation ? <Check size={13} /> : null}
              </span>
              <span className="min-w-0 flex-1 truncate text-left">{option.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pendingActionRef = useRef<(() => void) | undefined>(undefined);

  function run(action: () => void): void {
    pendingActionRef.current = action;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          ref={triggerRef}
          className="tb-action"
          type="button"
          title="Git actions for the selected commit"
          disabled={disabled}
        >
          <span className="tb-action-label">Actions</span>
          <span className="tb-action-icon">
            <MoreHorizontal size={17} />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={-2}
        className="w-64"
        aria-label="Git actions"
        onCloseAutoFocus={(event) => {
          const action = pendingActionRef.current;

          if (!action) {
            return;
          }

          event.preventDefault();
          pendingActionRef.current = undefined;
          triggerRef.current?.focus({ preventScroll: true });
          action();
        }}
      >
        <ActionMenuItem
          icon={<GitMerge size={14} />}
          label="Merge selected into current"
          disabled={!hasSelectedCommit}
          onClick={() => run(onMergeSelected)}
        />
        <ActionMenuItem
          icon={<Workflow size={14} />}
          label="Rebase current onto selected"
          disabled={!hasSelectedCommit}
          onClick={() => run(onRebaseSelected)}
        />
        <ActionMenuItem
          icon={<Workflow size={14} />}
          label="Interactive rebase from selected"
          disabled={!hasSelectedCommit}
          onClick={() => run(onInteractiveRebaseSelected)}
        />
        <DropdownMenuSeparator className="mx-0 my-1" />
        <ActionMenuItem
          icon={<Tag size={14} />}
          label="Tag selected commit"
          disabled={!hasSelectedCommit}
          onClick={() => run(onTagSelected)}
        />
        <DropdownMenuSeparator className="mx-0 my-1" />
        <ActionMenuItem
          icon={<Search size={14} />}
          label="All commands…"
          onClick={() => run(onOpenQuickJump)}
          shortcut="⌘P"
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ActionMenuItem({
  icon,
  label,
  shortcut,
  disabled = false,
  onClick
}: {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <DropdownMenuItem disabled={disabled} onSelect={onClick}>
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {shortcut ? <kbd className="text-[10px] text-[var(--text-3)]">{shortcut}</kbd> : null}
    </DropdownMenuItem>
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
