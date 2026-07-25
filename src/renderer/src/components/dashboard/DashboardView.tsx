import type { FormEvent, ReactElement } from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash2,
  ExternalLink,
  GitBranch,
  LayoutDashboard,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Workflow,
  X,
  XCircle
} from 'lucide-react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';

import { ModalSurface } from '@renderer/components/accessibility/ModalSurface';
import {
  dashboardsQueryKey,
  useDashboards,
  useGitHubActionsRuns,
  useGitHubRepositories
} from '@renderer/queries/github';
import type {
  Dashboard,
  GitHubActionsDashboardTile,
  GitHubRepositorySummary,
  GitHubWorkflowRun,
  GitProfile
} from '@shared/types';

import { workflowRunPresentation } from './workflowRunPresentation';

type DashboardViewProps = {
  profile?: GitProfile;
  requestedDashboardId?: string;
  onSelectDashboard: (dashboardId: string | undefined) => void;
  onOpenProfileSettings: () => void;
  onClose: () => void;
};

type DashboardDialog =
  | { kind: 'create'; name: string }
  | { kind: 'rename'; name: string }
  | { kind: 'add-tile'; repository: string; limit: number }
  | { kind: 'delete' };

export function DashboardView({
  profile,
  requestedDashboardId,
  onSelectDashboard,
  onOpenProfileSettings,
  onClose
}: DashboardViewProps): ReactElement {
  const profileId = profile?.ghConfigDir && profile.githubLogin ? profile.id : undefined;
  const dashboardsQuery = useDashboards(profileId);
  const repositoriesQuery = useGitHubRepositories(profileId);
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DashboardDialog>();
  const [isSaving, setIsSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string>();
  const dashboards = dashboardsQuery.data?.dashboards ?? [];
  const activeDashboard =
    dashboards.find((dashboard) => dashboard.id === requestedDashboardId) ?? dashboards[0];
  const availableRepositories = useMemo(
    () =>
      (repositoriesQuery.data ?? []).filter(
        (repository) =>
          !activeDashboard?.tiles.some(
            (tile) => tile.owner === repository.owner && tile.repository === repository.name
          )
      ),
    [activeDashboard?.tiles, repositoriesQuery.data]
  );
  const dashboardFetchCount = useIsFetching({
    queryKey: profileId ? ['github-actions-runs', profileId] : ['github-actions-runs', 'none']
  });

  useEffect(() => {
    if (!dashboardsQuery.data) {
      return;
    }

    if (activeDashboard?.id !== requestedDashboardId) {
      onSelectDashboard(activeDashboard?.id);
    }
  }, [activeDashboard?.id, dashboardsQuery.data, onSelectDashboard, requestedDashboardId]);

  if (!profileId) {
    return (
      <DashboardMessage
        icon={<LayoutDashboard size={21} />}
        title="Connect a GitHub account"
        detail="Dashboards use the GitHub CLI account attached to the active Git profile."
        actionLabel="Open profile settings"
        onAction={onOpenProfileSettings}
        onClose={onClose}
      />
    );
  }

  if (dashboardsQuery.isLoading && !dashboardsQuery.data) {
    return (
      <DashboardMessage
        icon={<Loader2 size={21} className="animate-spin" />}
        title="Loading dashboards"
        detail={`Restoring dashboard configuration for @${profile?.githubLogin}.`}
        onClose={onClose}
      />
    );
  }

  if (dashboardsQuery.error && !dashboardsQuery.data) {
    return (
      <DashboardMessage
        icon={<AlertTriangle size={21} />}
        title="Could not load dashboards"
        detail={errorMessage(dashboardsQuery.error)}
        actionLabel="Try again"
        onAction={() => void dashboardsQuery.refetch()}
        onClose={onClose}
        tone="danger"
      />
    );
  }

  const activeProfileId = profileId;

  async function persistDashboard(dashboard: Dashboard): Promise<void> {
    setIsSaving(true);
    setMutationError(undefined);

    try {
      const state = await window.api.saveDashboard({
        id: dashboard.id,
        profileId: dashboard.profileId,
        name: dashboard.name,
        tiles: dashboard.tiles.map((tile) => ({
          ...tile,
          id: tile.id || undefined
        }))
      });
      queryClient.setQueryData(dashboardsQueryKey(activeProfileId), state);
    } catch (error) {
      setMutationError(errorMessage(error));
      throw error;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDialogSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!dialog) {
      return;
    }

    setMutationError(undefined);

    try {
      if (dialog.kind === 'create') {
        setIsSaving(true);
        const state = await window.api.saveDashboard({
          profileId: activeProfileId,
          name: dialog.name,
          tiles: []
        });
        queryClient.setQueryData(dashboardsQueryKey(activeProfileId), state);
        onSelectDashboard(state.dashboards.at(-1)?.id);
      } else if (dialog.kind === 'rename' && activeDashboard) {
        await persistDashboard({ ...activeDashboard, name: dialog.name });
      } else if (dialog.kind === 'add-tile' && activeDashboard) {
        const repository = availableRepositories.find(
          (candidate) =>
            candidate.fullName ===
            (dialog.repository || availableRepositories[0]?.fullName)
        );

        if (!repository) {
          throw new Error('Select a GitHub project.');
        }

        await persistDashboard({
          ...activeDashboard,
          tiles: [
            ...activeDashboard.tiles,
            {
              id: '',
              kind: 'github-actions',
              owner: repository.owner,
              repository: repository.name,
              limit: dialog.limit
            }
          ]
        });
      } else if (dialog.kind === 'delete' && activeDashboard) {
        setIsSaving(true);
        const state = await window.api.deleteDashboard(activeProfileId, activeDashboard.id);
        queryClient.setQueryData(dashboardsQueryKey(activeProfileId), state);
        onSelectDashboard(state.dashboards[0]?.id);
      }

      setDialog(undefined);
    } catch (error) {
      setMutationError(errorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRemoveTile(tileId: string): Promise<void> {
    if (!activeDashboard) {
      return;
    }

    try {
      await persistDashboard({
        ...activeDashboard,
        tiles: activeDashboard.tiles.filter((tile) => tile.id !== tileId)
      });
    } catch {
      // The local error message remains visible in the dashboard header.
    }
  }

  function openAddTileDialog(): void {
    setMutationError(undefined);
    setDialog({
      kind: 'add-tile',
      repository: availableRepositories[0]?.fullName ?? '',
      limit: 10
    });
  }

  function refreshDashboard(): void {
    void queryClient.invalidateQueries({
      queryKey: ['github-actions-runs', activeProfileId]
    });
  }

  return (
    <section className="dashboard-view" aria-label="Dashboards">
      <div className="dashboard-content">
        {activeDashboard ? (
          <>
            <header className="dashboard-header">
              <div className="min-w-0">
                <h2>{activeDashboard.name}</h2>
              </div>
              <div className="dashboard-header-actions">
                <button
                  className="icon-btn h-7 w-7"
                  type="button"
                  aria-label="Create dashboard"
                  title="Create dashboard"
                  onClick={() => {
                    setMutationError(undefined);
                    setDialog({ kind: 'create', name: '' });
                  }}
                >
                  <LayoutDashboard size={13} />
                </button>
                <button
                  className="icon-btn h-7 w-7"
                  type="button"
                  aria-label="Rename dashboard"
                  title="Rename dashboard"
                  onClick={() => {
                    setMutationError(undefined);
                    setDialog({ kind: 'rename', name: activeDashboard.name });
                  }}
                >
                  <Pencil size={13} />
                </button>
                <button
                  className="icon-btn h-7 w-7 text-[var(--danger-text)]"
                  type="button"
                  aria-label="Delete dashboard"
                  title="Delete dashboard"
                  onClick={() => {
                    setMutationError(undefined);
                    setDialog({ kind: 'delete' });
                  }}
                >
                  <Trash2 size={13} />
                </button>
                <button
                  className="icon-btn h-7 w-7"
                  type="button"
                  disabled={dashboardFetchCount > 0}
                  aria-label={dashboardFetchCount > 0 ? 'Refreshing dashboard' : 'Refresh dashboard'}
                  title={dashboardFetchCount > 0 ? 'Refreshing dashboard' : 'Refresh dashboard'}
                  onClick={refreshDashboard}
                >
                  <RefreshCw
                    size={13}
                    className={dashboardFetchCount > 0 ? 'animate-spin' : undefined}
                  />
                </button>
                <button
                  className="icon-btn h-7 w-7"
                  type="button"
                  aria-label="Add tile"
                  title="Add tile"
                  onClick={openAddTileDialog}
                >
                  <Plus size={13} />
                </button>
                <button
                  className="icon-btn h-7 w-7"
                  type="button"
                  onClick={onClose}
                  aria-label="Close dashboards and return to commit graph"
                  title="Return to commit graph"
                >
                  <X size={14} />
                </button>
              </div>
            </header>

            {mutationError ? (
              <div className="dashboard-inline-error" role="alert">
                <AlertTriangle size={13} />
                <span>{mutationError}</span>
              </div>
            ) : null}

            {activeDashboard.tiles.length > 0 ? (
              <div className="dashboard-grid">
                {activeDashboard.tiles.map((tile) => (
                  <GitHubActionsTile
                    key={tile.id}
                    profileId={activeProfileId}
                    tile={tile}
                    onRemove={() => void handleRemoveTile(tile.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="dashboard-empty">
                <div className="dashboard-empty-icon">
                  <Workflow size={22} />
                </div>
                <h3>Add your first project</h3>
                <p>Choose a GitHub project and show its latest workflow runs in this dashboard.</p>
                <button className="btn-primary mt-4" type="button" onClick={openAddTileDialog}>
                  <Plus size={14} />
                  Add GitHub Actions tile
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="dashboard-empty">
            <div className="dashboard-empty-icon">
              <LayoutDashboard size={22} />
            </div>
            <h2>Create a dashboard</h2>
            <p>Group the GitHub Actions state you check across projects into one persistent view.</p>
            <button
              className="btn-primary mt-4"
              type="button"
              onClick={() => setDialog({ kind: 'create', name: '' })}
            >
              <Plus size={14} />
              Create dashboard
            </button>
          </div>
        )}
      </div>

      {dialog ? (
        <DashboardDialogSurface
          dialog={dialog}
          repositories={availableRepositories}
          repositoriesLoading={repositoriesQuery.isLoading}
          repositoriesError={
            repositoriesQuery.error ? errorMessage(repositoriesQuery.error) : undefined
          }
          isSaving={isSaving}
          errorMessage={mutationError}
          onChange={setDialog}
          onClose={() => {
            setMutationError(undefined);
            setDialog(undefined);
          }}
          onSubmit={(event) => void handleDialogSubmit(event)}
        />
      ) : null}
    </section>
  );
}

type GitHubActionsTileProps = {
  profileId: string;
  tile: GitHubActionsDashboardTile;
  onRemove: () => void;
};

function GitHubActionsTile({
  profileId,
  tile,
  onRemove
}: GitHubActionsTileProps): ReactElement {
  const runsQuery = useGitHubActionsRuns({
    profileId,
    owner: tile.owner,
    repository: tile.repository,
    limit: tile.limit
  });
  const runs = runsQuery.data?.runs ?? [];
  const runningCount = runs.filter((run) => run.status !== 'completed').length;
  const failedCount = runs.filter(
    (run) => workflowRunPresentation(run).tone === 'danger'
  ).length;

  return (
    <article className="actions-tile" aria-label={`${tile.owner}/${tile.repository} workflow runs`}>
      <header className="actions-tile-header">
        <div className="actions-tile-identity">
          <span className="actions-tile-icon">
            <Workflow size={15} />
          </span>
          <span className="min-w-0">
            <strong>
              <span>{tile.owner}/</span>
              {tile.repository}
            </strong>
          </span>
        </div>
        <div className="actions-tile-header-actions">
          {runningCount > 0 ? (
            <span className="actions-summary" data-tone="running">
              <Loader2 size={11} className="animate-spin" />
              {runningCount} running
            </span>
          ) : failedCount > 0 ? (
            <span className="actions-summary" data-tone="danger">
              <XCircle size={11} />
              {failedCount} failed
            </span>
          ) : runs.length > 0 ? (
            <span className="actions-summary" data-tone="success">
              <CheckCircle2 size={11} />
              Healthy
            </span>
          ) : null}
          <button
            className="icon-btn h-7 w-7"
            type="button"
            aria-label={`Remove ${tile.owner}/${tile.repository} tile`}
            title="Remove tile"
            onClick={onRemove}
          >
            <X size={13} />
          </button>
        </div>
      </header>

      {runsQuery.error ? (
        <div className="actions-tile-error" role="alert">
          <AlertTriangle size={13} />
          <span>{errorMessage(runsQuery.error)}</span>
          <button type="button" onClick={() => void runsQuery.refetch()}>
            Retry
          </button>
        </div>
      ) : null}

      {runsQuery.isLoading && !runsQuery.data ? (
        <div className="actions-tile-loading" role="status">
          <Loader2 size={18} className="animate-spin" />
          <span>Loading workflow runs…</span>
        </div>
      ) : runs.length > 0 ? (
        <div className="workflow-run-list">
          {runs.map((run) => (
            <WorkflowRunRow key={run.id} run={run} />
          ))}
        </div>
      ) : !runsQuery.error ? (
        <div className="actions-tile-empty">
          <CircleSlash2 size={17} />
          <span>No workflow runs found.</span>
        </div>
      ) : null}
    </article>
  );
}

function WorkflowRunRow({ run }: { run: GitHubWorkflowRun }): ReactElement {
  const presentation = workflowRunPresentation(run);
  const statusIcon =
    presentation.icon === 'running' ? (
      <Loader2 size={14} className="animate-spin" />
    ) : presentation.icon === 'success' ? (
      <CheckCircle2 size={14} />
    ) : presentation.icon === 'failure' ? (
      <XCircle size={14} />
    ) : (
      <CircleSlash2 size={14} />
    );

  return (
    <a
      className="workflow-run-row"
      href={run.url}
      target="_blank"
      rel="noreferrer"
      aria-label={`${run.displayTitle}, ${presentation.label}. Open workflow run in browser`}
    >
      <span className="workflow-run-status" data-tone={presentation.tone} title={presentation.label}>
        {statusIcon}
      </span>
      <span className="workflow-run-copy">
        <strong title={run.displayTitle}>{run.displayTitle}</strong>
        <span>
          <span>{run.name}</span>
          <span>#{run.runNumber}</span>
          {run.branch ? (
            <span className="workflow-run-branch">
              <GitBranch size={10} />
              {run.branch}
            </span>
          ) : null}
        </span>
      </span>
      <span className="workflow-run-meta">
        <span data-tone={presentation.tone}>{presentation.label}</span>
        <small>{formatRelativeTime(run.updatedAt)}</small>
      </span>
      <ExternalLink size={12} className="workflow-run-external" aria-hidden="true" />
    </a>
  );
}

type DashboardDialogSurfaceProps = {
  dialog: DashboardDialog;
  repositories: GitHubRepositorySummary[];
  repositoriesLoading: boolean;
  repositoriesError?: string;
  isSaving: boolean;
  errorMessage?: string;
  onChange: (dialog: DashboardDialog) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function DashboardDialogSurface({
  dialog,
  repositories,
  repositoriesLoading,
  repositoriesError,
  isSaving,
  errorMessage,
  onChange,
  onClose,
  onSubmit
}: DashboardDialogSurfaceProps): ReactElement {
  const title =
    dialog.kind === 'create'
      ? 'Create dashboard'
      : dialog.kind === 'rename'
        ? 'Rename dashboard'
        : dialog.kind === 'add-tile'
          ? 'Add GitHub Actions tile'
          : 'Delete dashboard';
  const description =
    dialog.kind === 'add-tile'
      ? 'Choose a project and how many recent workflow runs to monitor.'
      : dialog.kind === 'delete'
        ? 'This removes the dashboard configuration and all of its tiles.'
        : 'Use a short name that describes the projects or delivery signal you monitor.';

  return (
    <ModalSurface
      labelledBy="dashboard-dialog-title"
      describedBy="dashboard-dialog-description"
      className="dashboard-dialog"
      onClose={onClose}
    >
      <form onSubmit={onSubmit}>
        <header>
          <div>
            <span className="dashboard-kicker">Dashboard</span>
            <h2 id="dashboard-dialog-title">{title}</h2>
            <p id="dashboard-dialog-description">{description}</p>
          </div>
          <button className="icon-btn h-7 w-7" type="button" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </header>

        <div className="dashboard-dialog-body">
          {dialog.kind === 'create' || dialog.kind === 'rename' ? (
            <label className="dashboard-field">
              <span>Name</span>
              <input
                data-modal-initial-focus="true"
                value={dialog.name}
                maxLength={80}
                placeholder="Delivery health"
                required
                onChange={(event) => onChange({ ...dialog, name: event.target.value })}
              />
            </label>
          ) : dialog.kind === 'add-tile' ? (
            <>
              <label className="dashboard-field">
                <span>GitHub project</span>
                <select
                  data-modal-initial-focus="true"
                  value={dialog.repository || repositories[0]?.fullName || ''}
                  required
                  disabled={repositoriesLoading || repositories.length === 0}
                  onChange={(event) =>
                    onChange({ ...dialog, repository: event.target.value })
                  }
                >
                  {repositoriesLoading ? <option value="">Loading projects…</option> : null}
                  {!repositoriesLoading && repositories.length === 0 ? (
                    <option value="">No additional projects available</option>
                  ) : null}
                  {repositories.map((repository) => (
                    <option key={repository.fullName} value={repository.fullName}>
                      {repository.fullName}
                      {repository.isPrivate ? ' · Private' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="dashboard-field">
                <span>Workflow runs to show</span>
                <select
                  value={dialog.limit}
                  onChange={(event) =>
                    onChange({ ...dialog, limit: Number(event.target.value) })
                  }
                >
                  {[5, 10, 15, 20].map((limit) => (
                    <option key={limit} value={limit}>
                      Last {limit} runs
                    </option>
                  ))}
                </select>
              </label>
              <div className="dashboard-dialog-note">
                <Lock size={13} />
                <span>Uses the GitHub CLI credentials attached to the active Git profile.</span>
              </div>
              {repositoriesError ? (
                <div className="dashboard-dialog-error" role="alert">
                  <AlertTriangle size={13} />
                  {repositoriesError}
                </div>
              ) : null}
            </>
          ) : (
            <div className="dashboard-delete-warning">
              <AlertTriangle size={16} />
              <span>You cannot undo this configuration change.</span>
            </div>
          )}

          {errorMessage ? (
            <div className="dashboard-dialog-error" role="alert">
              <AlertTriangle size={13} />
              {errorMessage}
            </div>
          ) : null}
        </div>

        <footer>
          <button className="btn-subtle" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className={dialog.kind === 'delete' ? 'btn-danger' : 'btn-primary'}
            type="submit"
            disabled={
              isSaving ||
              ((dialog.kind === 'create' || dialog.kind === 'rename') && !dialog.name.trim()) ||
              (dialog.kind === 'add-tile' && repositories.length === 0)
            }
          >
            {isSaving ? <Loader2 size={13} className="animate-spin" /> : null}
            {dialog.kind === 'create'
              ? 'Create dashboard'
              : dialog.kind === 'rename'
                ? 'Save name'
                : dialog.kind === 'add-tile'
                  ? 'Add tile'
                  : 'Delete dashboard'}
          </button>
        </footer>
      </form>
    </ModalSurface>
  );
}

type DashboardMessageProps = {
  icon: ReactElement;
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
  onClose: () => void;
  tone?: 'default' | 'danger';
};

function DashboardMessage({
  icon,
  title,
  detail,
  actionLabel,
  onAction,
  onClose,
  tone = 'default'
}: DashboardMessageProps): ReactElement {
  return (
    <section className="dashboard-message" data-tone={tone} role={tone === 'danger' ? 'alert' : 'status'}>
      <button
        className="icon-btn absolute right-3 top-3 h-8 w-8"
        type="button"
        onClick={onClose}
        aria-label="Close dashboards and return to commit graph"
        title="Return to commit graph"
      >
        <X size={14} />
      </button>
      <div className="dashboard-empty-icon">{icon}</div>
      <h1>{title}</h1>
      <p>{detail}</p>
      {actionLabel && onAction ? (
        <button className="btn-primary mt-4" type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </section>
  );
}

function formatRelativeTime(isoDate: string): string {
  const elapsedMs = Date.now() - new Date(isoDate).getTime();

  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return 'just now';
  }

  const seconds = Math.floor(elapsedMs / 1000);

  if (seconds < 45) {
    return 'just now';
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(isoDate).toLocaleDateString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}
