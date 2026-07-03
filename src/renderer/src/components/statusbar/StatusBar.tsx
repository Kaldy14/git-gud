import type { ReactElement } from 'react';
import { FolderGit2, GitBranch, UserCircle } from 'lucide-react';

import type { GitRepositoryOverview, RepoTab } from '@shared/types';

type StatusBarProps = {
  activeTab?: RepoTab;
  repositoryOverview?: GitRepositoryOverview;
  isRepositoryLoading: boolean;
};

export function StatusBar({ activeTab, repositoryOverview, isRepositoryLoading }: StatusBarProps): ReactElement {
  const branchLabel = repositoryOverview ? formatBranchLabel(repositoryOverview) : isRepositoryLoading ? 'Loading Git data' : undefined;
  const statusLabel = repositoryOverview
    ? repositoryOverview.status.isDirty
      ? `${repositoryOverview.status.dirtyCount} changed`
      : 'clean'
    : undefined;
  const identityLabel = formatIdentity(repositoryOverview);

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--bg-titlebar)] px-3 text-[11px] text-[var(--text-3)]">
      <span className="flex min-w-0 items-center gap-1.5">
        <FolderGit2 size={12} className="shrink-0" />
        <span className="min-w-0 truncate">{activeTab ? activeTab.path : 'No repository open'}</span>
      </span>
      <span className="flex shrink-0 items-center gap-3">
        {branchLabel ? (
          <span className="flex items-center gap-1.5">
            <GitBranch size={12} />
            {branchLabel}
          </span>
        ) : null}
        {statusLabel ? (
          <span className="flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: repositoryOverview?.status.isDirty ? '#f0b35f' : 'var(--accent)' }}
            />
            {statusLabel}
          </span>
        ) : null}
        {repositoryOverview?.stashes.length ? <span>{repositoryOverview.stashes.length} stash</span> : null}
        {identityLabel ? (
          <span className="flex items-center gap-1.5">
            <UserCircle size={12} />
            {identityLabel}
          </span>
        ) : null}
        <span>v0.0.0</span>
      </span>
    </footer>
  );
}

function formatBranchLabel(repositoryOverview: GitRepositoryOverview): string {
  const branch = repositoryOverview.status.branch;

  if (branch.isDetached) {
    return branch.oid ? `detached ${branch.oid.slice(0, 7)}` : 'detached';
  }

  return branch.head;
}

function formatIdentity(repositoryOverview: GitRepositoryOverview | undefined): string | undefined {
  const identity = repositoryOverview?.profileState.effectiveIdentity;

  if (!identity?.name && !identity?.email) {
    return undefined;
  }

  return identity.name ?? identity.email;
}
