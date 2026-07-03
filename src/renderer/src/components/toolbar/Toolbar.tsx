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
  Redo2,
  Search,
  Terminal,
  Undo2,
  Zap
} from 'lucide-react';

import type { GitRepositoryOverview, RepoTab } from '@shared/types';

type ToolbarProps = {
  activeTab?: RepoTab;
  repositoryOverview?: GitRepositoryOverview;
};

export function Toolbar({ activeTab, repositoryOverview }: ToolbarProps): ReactElement {
  const hasRepo = Boolean(activeTab);
  const branchLabel = repositoryOverview ? formatBranchLabel(repositoryOverview) : hasRepo ? 'Loading…' : '—';
  const dirtyCount = repositoryOverview?.status.dirtyCount ?? 0;

  return (
    <div className="flex h-[54px] shrink-0 items-center border-b border-[var(--border)] bg-[var(--bg-toolbar)] px-2">
      <div className="flex min-w-0 items-center">
        <button className="tb-select" type="button" disabled={!hasRepo} title={activeTab?.path}>
          <span className="tb-select-label">repository</span>
          <span className="tb-select-value">
            <FolderGit2 size={13} className="shrink-0 text-[var(--text-3)]" />
            <span className="min-w-0 truncate">{activeTab?.name ?? 'No repository'}</span>
            <ChevronDown size={12} className="shrink-0 text-[var(--text-3)]" />
          </span>
        </button>
        <ChevronRight size={14} className="mx-0.5 shrink-0 text-[var(--text-3)]" />
        <button className="tb-select" type="button" disabled title="Checkout and branch switching land in M4">
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

      <div className="flex flex-1 items-center justify-center">
        <ToolbarAction label="Undo" icon={<Undo2 size={17} />} hint="Undo — lands in M4" />
        <ToolbarAction label="Redo" icon={<Redo2 size={17} />} hint="Redo — lands in M4" />
        <div className="tb-divider" />
        <ToolbarAction label="Fetch" icon={<ArrowDownToLine size={17} />} hint="Fetch — lands in M4" emphasized={hasRepo} />
        <ToolbarAction label="Push" icon={<ArrowUpFromLine size={17} />} hint="Push — lands in M4" emphasized={hasRepo} />
        <ToolbarAction label="Branch" icon={<GitBranch size={17} />} hint="Create branch — lands in M4" emphasized={hasRepo} />
        <ToolbarAction label="Stash" icon={<Archive size={17} />} hint="Stash — lands in M4" />
        <ToolbarAction label="Pop" icon={<ArchiveRestore size={17} />} hint="Pop stash — lands in M4" />
        <div className="tb-divider" />
        <ToolbarAction label="Terminal" icon={<Terminal size={17} />} hint="Open Terminal.app — lands in M6" emphasized={hasRepo} />
      </div>

      <div className="flex shrink-0 items-center">
        <ToolbarAction label="Actions" icon={<Zap size={17} />} hint="Quick actions — lands in M4" />
        <ToolbarAction label="Search" icon={<Search size={17} />} hint="Search — lands in M6" />
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
};

function ToolbarAction({ label, icon, hint, emphasized = false }: ToolbarActionProps): ReactElement {
  return (
    <button className="tb-action" type="button" disabled title={hint} style={emphasized ? { opacity: 1, color: 'var(--text-2)' } : undefined}>
      <span className="text-[11px] leading-none">{label}</span>
      {icon}
    </button>
  );
}
