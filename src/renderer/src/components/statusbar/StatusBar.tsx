import { useEffect, useState, type ReactElement } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FolderGit2,
  GitBranch,
  Loader2,
  RefreshCw,
  UserCircle
} from 'lucide-react';

import { FILE_STATUS_COLORS } from '@shared/graph';
import type {
  ApplicationUpdateState,
  GitRepositoryOverview,
  RepoTab
} from '@shared/types';

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
  const [applicationUpdateState, setApplicationUpdateState] =
    useState<ApplicationUpdateState>({ status: 'idle' });
  const [isApplyingUpdate, setIsApplyingUpdate] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const unsubscribe = window.api.onApplicationUpdateStateChanged((state) => {
      if (isMounted) {
        setApplicationUpdateState(state);
      }
    });

    void window.api.getApplicationUpdateState().then((state) => {
      if (isMounted) {
        setApplicationUpdateState(state);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  async function handleApplyUpdate(): Promise<void> {
    setIsApplyingUpdate(true);

    try {
      setApplicationUpdateState(await window.api.applyApplicationUpdate());
    } catch (error) {
      console.error('Unable to apply the Git Gud update.', error);
    } finally {
      setIsApplyingUpdate(false);
    }
  }

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-[var(--border)] bg-[var(--bg-titlebar)] px-3 text-[11px] text-[var(--text-3)]">
      <span className="flex min-w-0 items-center gap-1.5">
        <FolderGit2 size={12} className="shrink-0" />
        <span className="min-w-0 truncate">{activeTab ? activeTab.path : 'Git Gud'}</span>
        <ApplicationUpdateButton
          state={applicationUpdateState}
          isApplying={isApplyingUpdate}
          onUpdate={() => void handleApplyUpdate()}
        />
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
        <span>v{import.meta.env.VITE_APP_VERSION}</span>
      </span>
    </footer>
  );
}

type ApplicationUpdateButtonProps = {
  state: ApplicationUpdateState;
  isApplying: boolean;
  onUpdate: () => void;
};

export function ApplicationUpdateButton({
  state,
  isApplying,
  onUpdate
}: ApplicationUpdateButtonProps): ReactElement | null {
  if (state.status === 'idle') {
    return null;
  }

  if (state.status === 'checking' || state.status === 'downloading') {
    return (
      <span
        className="statusbar-update-status flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] font-semibold"
        data-update-status={state.status}
        role="status"
        aria-live="polite"
      >
        <Loader2 size={11} className="animate-spin" />
        {state.status === 'checking' ? 'Checking for update…' : 'Downloading update…'}
      </span>
    );
  }

  if (state.status === 'up-to-date') {
    return (
      <span
        className="statusbar-update-status flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] font-semibold"
        data-update-status={state.status}
        role="status"
        aria-live="polite"
        title={state.message}
      >
        <CheckCircle2 size={11} />
        Up to date
      </span>
    );
  }

  const presentation =
    state.status === 'downloaded'
      ? {
          icon: <RefreshCw size={11} />,
          label: isApplying ? 'Restarting…' : 'Restart to update',
          title: `${state.releaseName} is ready. Restart Git Gud to install it.`
        }
      : state.status === 'manual-update-required'
        ? {
            icon: <Download size={11} />,
            label: isApplying ? 'Opening release…' : 'Get signed release',
            title: state.message
          }
        : {
            icon: <AlertCircle size={11} />,
            label: isApplying ? 'Checking…' : 'Update failed · Retry',
            title: state.message
          };

  return (
    <button
      type="button"
      className="statusbar-update-button flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] font-semibold"
      data-update-status={state.status}
      disabled={isApplying}
      title={presentation.title}
      onClick={onUpdate}
    >
      {isApplying ? <Loader2 size={11} className="animate-spin" /> : presentation.icon}
      {presentation.label}
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

function formatIdentity(repositoryOverview: GitRepositoryOverview | undefined): string | undefined {
  const identity = repositoryOverview?.profileState.effectiveIdentity;

  if (!identity?.name && !identity?.email) {
    return undefined;
  }

  return identity.name ?? identity.email;
}
