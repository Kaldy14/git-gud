import type { ReactElement } from 'react';
import { FolderGit2, GitBranch, Loader2, UserCircle } from 'lucide-react';

import { FILE_STATUS_COLORS } from '@shared/graph';
import type { GitRepositoryOverview, RepoTab } from '@shared/types';
import packageJson from '../../../../../package.json';

type StatusBarProps = {
  activeTab?: RepoTab;
  repositoryOverview?: GitRepositoryOverview;
  isRepositoryLoading: boolean;
  isRepositoryRefreshing: boolean;
  activeOperation?: {
    label: string;
    phase: 'running' | 'refreshing';
  };
};

export function StatusBar({
  activeTab,
  repositoryOverview,
  isRepositoryLoading,
  isRepositoryRefreshing,
  activeOperation
}: StatusBarProps): ReactElement {
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
      {activeOperation || isRepositoryRefreshing ? (
        <span
          className="mx-3 flex min-w-0 items-center gap-1.5 text-[var(--text-2)]"
          role={activeOperation ? undefined : 'status'}
          aria-live={activeOperation ? undefined : 'polite'}
          aria-atomic={activeOperation ? undefined : 'true'}
        >
          <Loader2 size={12} className="shrink-0 animate-spin text-[var(--accent-2)]" />
          <span className="truncate">
            {activeOperation
              ? activeOperation.phase === 'refreshing'
                ? `Updating after ${activeOperation.label}…`
                : `${activeOperation.label}…`
              : 'Refreshing repository…'}
          </span>
        </span>
      ) : null}
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
              style={{ background: repositoryOverview?.status.isDirty ? FILE_STATUS_COLORS.modified : 'var(--accent)' }}
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
        <span>v{packageJson.version}</span>
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
