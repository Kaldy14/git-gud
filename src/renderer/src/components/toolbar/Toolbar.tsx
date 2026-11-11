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
  GitBranchMinus,
  GitMerge,
  GitPullRequestArrow,
  MonitorUp,
  MoreHorizontal,
  Rocket,
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

import { ApplicationIcon } from '@renderer/components/applications/ApplicationIcon';
import type { ExternalApplication } from '@shared/externalApplications';
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
  /** The automatic next tag name; without one the Release action stays disabled. */
  releaseTagName?: string;
  onCreateRelease: () => void;
  onOpenRepositoryMaintenance: () => void;
  hasSelectedCommit: boolean;
  applications: readonly ExternalApplication[];
  selectedApplication?: ExternalApplication;
  onOpenInApplication: (application: ExternalApplication) => void;
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
  releaseTagName,
  onCreateRelease,
  onOpenRepositoryMaintenance,
  hasSelectedCommit,
  applications,
  selectedApplication,
  onOpenInApplication
}: ToolbarProps): ReactElement {
  const hasRepo = Boolean(activeTab);
  const branchLabel = repositoryOverview ? formatBranchLabel(repositoryOverview) : hasRepo ? 'Loading…' : 'No branch';
  const dirtyCount = repositoryOverview?.status.dirtyCount ?? 0;
  const hasConflicts = (repositoryOverview?.status.conflictedCount ?? 0) > 0;
  const hasStashes = (repositoryOverview?.stashes.length ?? 0) > 0;
  const undoTitle = latestUndo?.staleReason ?? latestUndo?.label ?? 'No undoable operation';
  const branchState = repositoryOverview?.status.branch;
  const upstream = branchState?.upstream;
  const aheadCount = upstream ? branchState?.ahead ?? 0 : 0;
  const behindCount = upstream ? branchState?.behind ?? 0 : 0;
  // Unknown while the overview loads; only a loaded repository without remotes disables sync.
  const hasNoRemotes = repositoryOverview ? repositoryOverview.remotes.length === 0 : false;
  const hasNoCommits = Boolean(repositoryOverview && !branchState?.oid);
  const hasUnfinishedOperation = hasConflicts || Boolean(repositoryOverview?.conflictState.isActive);
  const branchUnavailableReason = !repositoryOverview ? 'Loading repository state'
    : hasNoCommits ? 'Make the first commit before creating a branch'
    : hasUnfinishedOperation ? 'Finish or abort the current Git operation before creating a branch'
    : undefined;
  // Keep in step with releaseUnavailableReason in WorkspaceShell, which guards the same action.
  const releaseUnavailableReason = !repositoryOverview ? 'Loading repository state'
    : !repositoryOverview.remotes.some((remote) => remote.name === 'origin') ? 'Add a remote named origin to create a release'
    : !releaseTagName ? noReleaseTagHint
    : undefined;

  return (
    <div className="app-toolbar h-11 shrink-0 items-center border-b border-[var(--border)] bg-[var(--bg-toolbar)] px-2">
      <div className="tb-context flex h-full min-w-0 items-center">
        <button className="tb-select" type="button" disabled={!hasRepo} title={activeTab?.path} onClick={onOpenQuickJump}>
          <span className="sr-only">Repository</span>
          <span className="tb-select-value">
            <FolderGit2 size={13} className="shrink-0 text-[var(--text-3)]" />
            <span className="min-w-0 flex-1 truncate whitespace-nowrap">{activeTab?.name ?? 'No repository'}</span>
            <ChevronDown size={12} className="shrink-0 text-[var(--text-3)]" />
          </span>
        </button>
        <ChevronRight size={13} className="shrink-0 text-[var(--text-3)] opacity-60" aria-hidden="true" />
        <button
          className="tb-select tb-select-branch"
          type="button"
          disabled={!hasRepo || isBusy}
          title="Switch branch"
          onClick={onOpenQuickJump}
        >
          <span className="sr-only">Branch</span>
          <span className="tb-select-value">
            <GitBranch size={13} className="shrink-0 text-[var(--text-3)]" />
            <span
              className={`min-w-0 flex-1 truncate whitespace-nowrap ${hasRepo ? 'text-[var(--text-2)]' : 'text-[var(--text-3)]'}`}
              title={branchLabel}
            >
              {branchLabel}
            </span>
            {dirtyCount > 0 ? (
              <span className="tb-dirty-count" title={`${dirtyCount} changed ${dirtyCount === 1 ? 'file' : 'files'}`}>
                {dirtyCount}
              </span>
            ) : null}
            <ChevronDown size={12} className="shrink-0 text-[var(--text-3)]" />
          </span>
        </button>
      </div>

      <div className="tb-group justify-center">
        <ToolbarAction
          label="Undo"
          icon={<Undo2 size={15} />}
          hint={undoTitle}
          disabled={!latestUndo || Boolean(latestUndo.staleReason) || isBusy}
          onClick={onUndo}
        />
        <span className="tb-divider" aria-hidden="true" />
        <PrimarySyncAction
          operation={defaultSyncOperation}
          disabled={!hasRepo || isBusy || hasNoRemotes}
          unavailableReason={hasNoRemotes ? noRemoteHint : undefined}
          behindCount={behindCount}
          upstream={upstream}
          onRun={() => onSync(defaultSyncOperation)}
          onChange={onChangeDefaultSyncOperation}
        />
        <ToolbarAction
          label="Push"
          icon={<ArrowUpFromLine size={15} />}
          hint={hasNoRemotes ? noRemoteHint : aheadCount > 0 && upstream ? `Push ${formatCommitCount(aheadCount)} to ${upstream}` : 'Push current branch'}
          badge={aheadCount > 0 ? { count: aheadCount, description: `${formatCommitCount(aheadCount)} to push` } : undefined}
          disabled={!hasRepo || isBusy || hasNoRemotes}
          onClick={onPush}
        />
        <span className="tb-divider" aria-hidden="true" />
        <ToolbarAction
          label="Release"
          icon={<Rocket size={15} />}
          hint={releaseUnavailableReason ?? `Create release ${releaseTagName} from latest origin/main and push to origin`}
          disabled={!hasRepo || isBusy || Boolean(releaseUnavailableReason)}
          onClick={onCreateRelease}
        />
        <span className="tb-divider" aria-hidden="true" />
        <ToolbarAction
          label="Branch"
          icon={<GitBranch size={15} />}
          hint={branchUnavailableReason ?? 'Create branch'}
          disabled={!hasRepo || isBusy || Boolean(branchUnavailableReason)}
          onClick={onCreateBranch}
        />
        <ToolbarAction
          label="Stash"
          icon={<Archive size={15} />}
          hint={hasConflicts ? 'Resolve conflicts before stashing' : 'Choose files to stash'}
          disabled={!hasRepo || dirtyCount === 0 || hasConflicts || isBusy}
          onClick={onStashPush}
        />
        <ToolbarAction
          label="Pop"
          icon={<ArchiveRestore size={15} />}
          hint="Pop latest stash"
          disabled={!hasRepo || !hasStashes || isBusy}
          onClick={onStashPop}
        />
      </div>

      <div className="tb-group shrink-0 justify-self-end">
        <OpenInApplicationAction
          disabled={!hasRepo || isBusy}
          applications={applications}
          selectedApplication={selectedApplication}
          onOpen={onOpenInApplication}
        />
        <ActionsMenu
          disabled={!hasRepo || isBusy}
          hasSelectedCommit={hasSelectedCommit}
          onOpenQuickJump={onOpenQuickJump}
          onMergeSelected={onMergeSelected}
          onRebaseSelected={onRebaseSelected}
          onInteractiveRebaseSelected={onInteractiveRebaseSelected}
          onTagSelected={onTagSelected}
          onOpenRepositoryMaintenance={onOpenRepositoryMaintenance}
        />
        <button
          className="tb-jump"
          type="button"
          disabled={!hasRepo}
          title="Jump to a repository, branch, or command"
          aria-label="Jump to a repository, branch, or command"
          onClick={onOpenQuickJump}
        >
          <Search size={13} className="shrink-0" aria-hidden="true" />
          <span className="tb-jump-text">Jump to…</span>
          <kbd>⌘P</kbd>
        </button>
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
  behindCount,
  upstream,
  unavailableReason,
  onRun,
  onChange
}: {
  operation: PrimarySyncOperation;
  disabled: boolean;
  behindCount: number;
  upstream?: string;
  unavailableReason?: string;
  onRun: () => void;
  onChange: (operation: PrimarySyncOperation) => void;
}): ReactElement {
  const selected = primarySyncOptions.find((option) => option.operation === operation) ?? primarySyncOptions[0];
  const behindDescription = `${formatCommitCount(behindCount)} to pull`;
  const icon = operation === 'fetch-all'
    ? <ArrowDownToLine size={15} />
    : <GitPullRequestArrow size={15} />;

  return (
    <div className="tb-sync-control">
      <ToolbarAction
        label={selected.buttonLabel}
        icon={icon}
        hint={unavailableReason ?? (behindCount > 0 && upstream ? `${selected.hint}. ${upstream} has ${behindDescription}.` : selected.hint)}
        badge={behindCount > 0 ? { count: behindCount, description: behindDescription } : undefined}
        disabled={disabled}
        onClick={onRun}
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
        <DropdownMenuContent align="start" className="w-72" aria-label="Default sync operation">
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

function OpenInApplicationAction({
  disabled,
  applications,
  selectedApplication,
  onOpen
}: {
  disabled: boolean;
  applications: readonly ExternalApplication[];
  selectedApplication?: ExternalApplication;
  onOpen: (application: ExternalApplication) => void;
}): ReactElement {
  const unavailable = disabled || !selectedApplication;

  return (
    <div className="tb-sync-control">
      <ToolbarAction
        label="Open"
        icon={selectedApplication ? <ApplicationIcon application={selectedApplication} size={16} /> : <MonitorUp size={15} />}
        hint={selectedApplication ? `Open repository in ${selectedApplication.name}` : 'No supported editor, terminal, or file manager was found'}
        ariaLabel={selectedApplication ? `Open repository in ${selectedApplication.name}` : 'Open repository'}
        disabled={unavailable}
        onClick={() => selectedApplication && onOpen(selectedApplication)}
        className="tb-sync-action"
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="tb-sync-menu-trigger"
            type="button"
            disabled={unavailable}
            title="Choose an application"
            aria-label="Choose an application to open the repository in"
          >
            <ChevronDown size={11} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60" aria-label="Open repository in">
          <p className="px-2 py-1.5 text-[11px] leading-4 text-[var(--text-3)]">Open this repository in</p>
          <DropdownMenuSeparator className="mx-0 my-1" />
          {applications.map((application) => (
            <DropdownMenuItem key={application.id} className="min-h-9" onSelect={() => onOpen(application)}>
              <ApplicationIcon application={application} size={20} />
              <span className="min-w-0 flex-1 truncate text-left">{application.name}</span>
              {application.id === selectedApplication?.id ? <Check size={13} className="text-[var(--accent-2)]" /> : null}
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
  onTagSelected,
  onOpenRepositoryMaintenance
}: {
  disabled: boolean;
  hasSelectedCommit: boolean;
  onOpenQuickJump: () => void;
  onMergeSelected: () => void;
  onRebaseSelected: () => void;
  onInteractiveRebaseSelected: () => void;
  onTagSelected: () => void;
  onOpenRepositoryMaintenance: () => void;
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
          title="Git actions and repository maintenance"
          aria-label="Actions"
          disabled={disabled}
        >
          <span className="tb-action-icon">
            <MoreHorizontal size={15} />
          </span>
          <span className="tb-action-text">Actions</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
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
          icon={<GitBranchMinus size={14} />}
          label="Repository maintenance…"
          onClick={() => run(onOpenRepositoryMaintenance)}
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
  ariaLabel?: string;
  badge?: { count: number; description: string };
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
};

function ToolbarAction({ label, icon, hint, ariaLabel, badge, disabled = true, onClick, className = '' }: ToolbarActionProps): ReactElement {
  return (
    <button
      className={`tb-action ${className}`.trim()}
      type="button"
      disabled={disabled}
      title={hint}
      aria-label={ariaLabel ?? (badge ? `${label}, ${badge.description}` : label)}
      onClick={onClick}
    >
      <span className="tb-action-icon">{icon}</span>
      <span className="tb-action-text">{label}</span>
      {badge ? (
        <span className="tb-action-badge" aria-hidden="true">
          {badge.count > 99 ? '99+' : badge.count}
        </span>
      ) : null}
    </button>
  );
}

const noRemoteHint = 'This repository has no remotes. Add one with + beside Remote in the sidebar.';
const noReleaseTagHint = 'No automatic release tag name can be determined from the existing tags';

function formatCommitCount(count: number): string {
  return `${count} ${count === 1 ? 'commit' : 'commits'}`;
}
