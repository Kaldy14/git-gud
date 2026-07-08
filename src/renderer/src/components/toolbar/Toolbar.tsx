import type { ReactElement, ReactNode } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  ChevronRight,
  FolderGit2,
  GitBranch,
  GitPullRequestArrow,
  Loader2,
  Redo2,
  Search,
  Terminal,
  Undo2,
  Zap
} from 'lucide-react';

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
  onOpenQuickJump
}: ToolbarProps): ReactElement {
  const hasRepo = Boolean(activeTab);
  const branchLabel = repositoryOverview ? formatBranchLabel(repositoryOverview) : hasRepo ? 'Loading…' : '—';
  const dirtyCount = repositoryOverview?.status.dirtyCount ?? 0;
  const hasStashes = (repositoryOverview?.stashes.length ?? 0) > 0;
  const undoTitle = latestUndo?.staleReason ?? latestUndo?.label ?? 'No undoable operation';

  return (
    <div className="flex h-[56px] shrink-0 items-center border-b border-[var(--border)] bg-[var(--bg-toolbar)] px-2">
      <div className="flex h-full min-w-0 items-center">
        <button className="tb-select" type="button" disabled={!hasRepo} title={activeTab?.path}>
          <span className="tb-select-label">repository</span>
          <span className="tb-select-value">
            <FolderGit2 size={13} className="shrink-0 text-[var(--text-3)]" />
            <span className="min-w-0 truncate">{activeTab?.name ?? 'No repository'}</span>
            <ChevronDown size={12} className="shrink-0 text-[var(--text-3)]" />
          </span>
        </button>
        <ChevronRight size={14} className="mx-0.5 shrink-0 text-[var(--text-3)]" />
        <button className="tb-select" type="button" disabled title="Use the sidebar or graph context menu to switch branches">
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
        <ToolbarAction label="Redo" icon={<Redo2 size={17} />} hint="Redo is not implemented yet" />
        <div className="tb-divider" />
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
        />
      </div>

      <div className="flex h-full shrink-0 items-center">
        <ToolbarAction label="Actions" icon={<Zap size={17} />} hint="Quick actions are not implemented yet" />
        <ToolbarAction
          label="Search"
          icon={<Search size={17} />}
          hint="Jump to repository or branch"
          disabled={!hasRepo}
          onClick={onOpenQuickJump}
        />
      </div>
    </div>
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
};

function ToolbarAction({ label, icon, hint, emphasized = false, disabled = true, onClick }: ToolbarActionProps): ReactElement {
  return (
    <button
      className="tb-action"
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
