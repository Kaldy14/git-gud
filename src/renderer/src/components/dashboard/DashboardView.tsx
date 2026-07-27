import type { FormEvent, ReactElement } from 'react';
import { useMemo, useState } from 'react';
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
  PlugZap,
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
import {
  portainerConnectionsQueryKey,
  refreshPortainerStackImages,
  usePortainerConnections,
  usePortainerStackCatalog
} from '@renderer/queries/portainer';
import { dashboardProfileId } from '@shared/dashboard';
import type {
  Dashboard,
  GitHubActionsDashboardTile,
  GitHubRepositorySummary,
  GitHubWorkflowRun,
  GitProfile,
  PortainerConnection,
  PortainerStackCatalog
} from '@shared/types';

import { PortainerConnectionDialog } from './PortainerConnectionDialog';
import { PortainerStackTile } from './PortainerStackTile';
import { resolveActiveDashboard } from './dashboardSelection';
import {
  hasWorkflowRunFilters,
  parseWorkflowRunBranches,
  workflowRunBranchFilterError,
  workflowRunFilterSummary
} from './workflowRunFilters';
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
  | {
      kind: 'add-tile';
      tileKind: 'github-actions' | 'portainer-swarm-stack';
      repository: string;
      limit: number;
      branches: string;
      includeTags: boolean;
      includeMyPullRequests: boolean;
      connectionId: string;
      endpointId: number;
      stackId: number;
    }
  | { kind: 'delete' };

export function DashboardView({
  profile,
  requestedDashboardId,
  onSelectDashboard,
  onOpenProfileSettings,
  onClose
}: DashboardViewProps): ReactElement {
  const activeDashboardProfileId = dashboardProfileId(profile);
  const gitHubProfileId =
    profile?.ghConfigDir && profile.githubLogin ? profile.id : undefined;
  const dashboardsQuery = useDashboards(activeDashboardProfileId);
  const repositoriesQuery = useGitHubRepositories(gitHubProfileId);
  const connectionsQuery = usePortainerConnections();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DashboardDialog>();
  const [connectionDialog, setConnectionDialog] = useState<{
    returnToAddTile: boolean;
    initialConnectionId?: string;
  }>();
  const [isSaving, setIsSaving] = useState(false);
  const [mutationError, setMutationError] = useState<string>();
  const dashboards = dashboardsQuery.data?.dashboards ?? [];
  const activeDashboard = resolveActiveDashboard(
    dashboards,
    requestedDashboardId,
    dashboardsQuery.data?.selectedDashboardId
  );
  const availableRepositories = useMemo(
    () =>
      (repositoriesQuery.data ?? []).filter(
        (repository) =>
          !activeDashboard?.tiles.some(
            (tile) =>
              tile.kind === 'github-actions' &&
              tile.owner === repository.owner &&
              tile.repository === repository.name
          )
      ),
    [activeDashboard?.tiles, repositoriesQuery.data]
  );
  const selectedConnectionId =
    dialog?.kind === 'add-tile' && dialog.tileKind === 'portainer-swarm-stack'
      ? dialog.connectionId || connectionsQuery.data?.[0]?.id
      : undefined;
  const catalogQuery = usePortainerStackCatalog(
    selectedConnectionId,
    dialog?.kind === 'add-tile' && dialog.tileKind === 'portainer-swarm-stack'
  );
  const gitHubFetchCount = useIsFetching({
    queryKey: gitHubProfileId
      ? ['github-actions-runs', gitHubProfileId]
      : ['github-actions-runs', 'none']
  });
  const portainerFetchCount = useIsFetching({
    queryKey: ['portainer-stack-runtime']
  });
  const portainerImageFetchCount = useIsFetching({
    queryKey: ['portainer-stack-images']
  });
  const dashboardFetchCount =
    gitHubFetchCount + portainerFetchCount + portainerImageFetchCount;

  if (dashboardsQuery.isLoading && !dashboardsQuery.data) {
    return (
      <DashboardMessage
        icon={<Loader2 size={21} className="animate-spin" />}
        title="Loading dashboards"
        detail="Restoring your saved monitoring dashboards."
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

  const activeProfileId = activeDashboardProfileId;

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
        if (dialog.tileKind === 'github-actions') {
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
                limit: dialog.limit,
                filters: {
                  branches: parseWorkflowRunBranches(dialog.branches),
                  includeTags: dialog.includeTags,
                  includeMyPullRequests: dialog.includeMyPullRequests
                }
              }
            ]
          });
        } else {
          const connectionId =
            dialog.connectionId || connectionsQuery.data?.[0]?.id;
          const environment =
            catalogQuery.data?.environments.find(
              (candidate) => candidate.id === dialog.endpointId
            ) ?? catalogQuery.data?.environments[0];
          const stack =
            environment?.stacks.find((candidate) => candidate.id === dialog.stackId) ??
            environment?.stacks[0];

          if (!connectionId) {
            throw new Error('Configure a Portainer connection.');
          }

          if (!environment || !stack) {
            throw new Error('Select a Portainer Swarm stack.');
          }

          await persistDashboard({
            ...activeDashboard,
            tiles: [
              ...activeDashboard.tiles,
              {
                id: '',
                kind: 'portainer-swarm-stack',
                connectionId,
                endpointId: environment.id,
                stackId: stack.id,
                stackName: stack.name,
                environmentName: environment.name
              }
            ]
          });
        }
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
      tileKind: gitHubProfileId ? 'github-actions' : 'portainer-swarm-stack',
      repository: availableRepositories[0]?.fullName ?? '',
      limit: 10,
      branches: '',
      includeTags: false,
      includeMyPullRequests: false,
      connectionId: connectionsQuery.data?.[0]?.id ?? '',
      endpointId: 0,
      stackId: 0
    });
  }

  function refreshDashboard(): void {
    const portainerTiles =
      activeDashboard?.tiles.filter(
        (tile) => tile.kind === 'portainer-swarm-stack'
      ) ?? [];

    void Promise.allSettled([
      queryClient.invalidateQueries({
        queryKey: ['github-actions-runs', gitHubProfileId ?? 'none']
      }),
      queryClient.invalidateQueries({ queryKey: ['portainer-stack-runtime'] }),
      ...portainerTiles.map((tile) =>
        refreshPortainerStackImages(queryClient, {
          connectionId: tile.connectionId,
          endpointId: tile.endpointId,
          stackId: tile.stackId,
          stackName: tile.stackName
        })
      )
    ]);
  }

  return (
    <section className="dashboard-view" aria-label="Dashboards">
      <div className="dashboard-content">
        {activeDashboard ? (
          <>
            <header className="dashboard-header">
              <div className="dashboard-header-navigation">
                <div className="dashboard-header-tabs" role="tablist" aria-label="Dashboards">
                  {dashboards.map((dashboard, dashboardIndex) => {
                    const isActive = dashboard.id === activeDashboard.id;

                    return (
                      <button
                        id={dashboardTabDomId(dashboard.id)}
                        className="dashboard-header-tab"
                        data-active={isActive}
                        key={dashboard.id}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        tabIndex={isActive ? 0 : -1}
                        title={dashboard.name}
                        onClick={() => onSelectDashboard(dashboard.id)}
                        onKeyDown={(event) => {
                          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
                            return;
                          }

                          event.preventDefault();
                          const direction = event.key === 'ArrowRight' ? 1 : -1;
                          const nextIndex =
                            (dashboardIndex + direction + dashboards.length) % dashboards.length;
                          const nextDashboard = dashboards[nextIndex];

                          if (nextDashboard) {
                            onSelectDashboard(nextDashboard.id);
                            window.requestAnimationFrame(() =>
                              document.getElementById(dashboardTabDomId(nextDashboard.id))?.focus()
                            );
                          }
                        }}
                      >
                        <span>{dashboard.name}</span>
                      </button>
                    );
                  })}
                </div>
                <button
                  className="icon-btn h-7 w-7 shrink-0"
                  type="button"
                  aria-label="Create dashboard"
                  title="Create dashboard"
                  onClick={() => {
                    setMutationError(undefined);
                    setDialog({ kind: 'create', name: '' });
                  }}
                >
                  <Plus size={13} />
                </button>
              </div>
              <div className="dashboard-header-actions">
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
                  aria-label="Portainer connections"
                  title="Portainer connections"
                  onClick={() =>
                    setConnectionDialog({
                      returnToAddTile: false,
                      initialConnectionId: connectionsQuery.data?.[0]?.id
                    })
                  }
                >
                  <PlugZap size={13} />
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
                {activeDashboard.tiles.map((tile) =>
                  tile.kind === 'github-actions' ? (
                    <GitHubActionsTile
                      key={tile.id}
                      profileId={gitHubProfileId}
                      tile={tile}
                      onRemove={() => void handleRemoveTile(tile.id)}
                    />
                  ) : (
                    <PortainerStackTile
                      key={tile.id}
                      tile={tile}
                      onRemove={() => void handleRemoveTile(tile.id)}
                    />
                  )
                )}
              </div>
            ) : (
              <div className="dashboard-empty">
                <div className="dashboard-empty-icon">
                  <Workflow size={22} />
                </div>
                <h3>Add your first monitor</h3>
                <p>
                  Choose a GitHub project or Portainer Swarm stack and keep its live
                  status in this dashboard.
                </p>
                <button className="btn-primary mt-4" type="button" onClick={openAddTileDialog}>
                  <Plus size={14} />
                  Add tile
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
            <p>
              Group the delivery and infrastructure state you check into one persistent
              view.
            </p>
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

      {dialog && !connectionDialog ? (
        <DashboardDialogSurface
          dialog={dialog}
          repositories={availableRepositories}
          repositoriesLoading={repositoriesQuery.isLoading}
          repositoriesError={
            repositoriesQuery.error ? errorMessage(repositoriesQuery.error) : undefined
          }
          gitHubConnected={Boolean(gitHubProfileId)}
          connections={connectionsQuery.data ?? []}
          connectionsLoading={connectionsQuery.isLoading}
          connectionsError={
            connectionsQuery.error ? errorMessage(connectionsQuery.error) : undefined
          }
          catalog={catalogQuery.data}
          catalogLoading={catalogQuery.isLoading}
          catalogError={catalogQuery.error ? errorMessage(catalogQuery.error) : undefined}
          isSaving={isSaving}
          errorMessage={mutationError}
          onChange={setDialog}
          onConfigurePortainer={(connectionId) =>
            setConnectionDialog({
              returnToAddTile: true,
              initialConnectionId: connectionId
            })
          }
          onOpenGitHubSettings={onOpenProfileSettings}
          onClose={() => {
            setMutationError(undefined);
            setDialog(undefined);
          }}
          onSubmit={(event) => void handleDialogSubmit(event)}
        />
      ) : null}

      {connectionDialog ? (
        <PortainerConnectionDialog
          initialConnectionId={connectionDialog.initialConnectionId}
          onClose={() => setConnectionDialog(undefined)}
          onSaved={(connectionId) => {
            if (connectionDialog.returnToAddTile) {
              setDialog((current) =>
                current?.kind === 'add-tile'
                  ? {
                      ...current,
                      tileKind: 'portainer-swarm-stack',
                      connectionId,
                      endpointId: 0,
                      stackId: 0
                    }
                  : current
              );
            }

            setConnectionDialog(undefined);
            void queryClient.invalidateQueries({
              queryKey: portainerConnectionsQueryKey
            });
          }}
        />
      ) : null}
    </section>
  );
}

function dashboardTabDomId(dashboardId: string): string {
  return `dashboard-tab-${dashboardId.replace(/[^\dA-Za-z_-]/g, '-')}`;
}

type GitHubActionsTileProps = {
  profileId?: string;
  tile: GitHubActionsDashboardTile;
  onRemove: () => void;
};

function GitHubActionsTile({
  profileId,
  tile,
  onRemove
}: GitHubActionsTileProps): ReactElement {
  const runsQuery = useGitHubActionsRuns(
    profileId
      ? {
          profileId,
          owner: tile.owner,
          repository: tile.repository,
          limit: tile.limit,
          filters: tile.filters
        }
      : undefined
  );
  const runs = runsQuery.data?.runs ?? [];
  const filterSummary = workflowRunFilterSummary(tile.filters);
  const isFiltered = hasWorkflowRunFilters(tile.filters);
  const searchLimitReached = runsQuery.data?.searchLimitReached === true;
  const searchedRunCount = runsQuery.data?.searchedRunCount ?? 0;
  const runPresentations = runs.map(workflowRunPresentation);
  const runningCount = runs.filter((run) => run.status === 'in-progress').length;
  const queuedCount = runPresentations.filter(
    (presentation) => presentation.label === 'Queued'
  ).length;
  const failedCount = runPresentations.filter(
    (presentation) => presentation.tone === 'danger'
  ).length;
  const unknownCount = runPresentations.filter(
    (presentation) => presentation.label === 'Unknown'
  ).length;

  return (
    <article
      className="actions-tile"
      aria-label={`${tile.owner}/${tile.repository} workflow runs, ${filterSummary}`}
    >
      <header className="actions-tile-header">
        <div className="actions-tile-identity">
          <span className="min-w-0">
            <strong>
              <span>{tile.owner}/</span>
              {tile.repository}
            </strong>
            <small title={`Run filters: ${filterSummary}`}>{filterSummary}</small>
          </span>
        </div>
        <div className="actions-tile-header-actions">
          {runningCount > 0 ? (
            <span className="actions-summary" data-tone="running">
              <Loader2 size={11} className="animate-spin" />
              {runningCount} Running
            </span>
          ) : queuedCount > 0 ? (
            <span className="actions-summary" data-tone="running">
              <Loader2 size={11} className="animate-spin" />
              {queuedCount} Queued
            </span>
          ) : failedCount > 0 ? (
            <span className="actions-summary" data-tone="danger">
              <XCircle size={11} />
              {failedCount} failed
            </span>
          ) : unknownCount > 0 ? (
            <span className="actions-summary">
              <CircleSlash2 size={11} />
              {unknownCount} Unknown
            </span>
          ) : runs.length > 0 ? (
            <span className="actions-summary" data-tone="success">
              <CheckCircle2 size={11} />
              Healthy
            </span>
          ) : null}
          <button
            className="actions-tile-remove icon-btn"
            type="button"
            aria-label={`Remove ${tile.owner}/${tile.repository} tile`}
            title="Remove tile"
            onClick={onRemove}
          >
            <X size={11} />
          </button>
        </div>
      </header>

      {!profileId ? (
        <div className="actions-tile-error" role="alert">
          <AlertTriangle size={13} />
          <span>Connect a GitHub account to refresh this tile.</span>
        </div>
      ) : runsQuery.error ? (
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
        <>
          <div className="workflow-run-list">
            {runs.map((run) => (
              <WorkflowRunRow key={run.id} run={run} />
            ))}
          </div>
          {searchLimitReached ? (
            <div className="actions-tile-search-note">
              Showing matches from the latest {searchedRunCount} runs.
            </div>
          ) : null}
        </>
      ) : profileId && !runsQuery.error ? (
        <div className="actions-tile-empty">
          <CircleSlash2 size={17} />
          <span>
            {searchLimitReached
              ? `No matches in the latest ${searchedRunCount} workflow runs.`
              : isFiltered
                ? 'No workflow runs match these filters.'
                : 'No workflow runs found.'}
          </span>
        </div>
      ) : null}
    </article>
  );
}

function WorkflowRunRow({ run }: { run: GitHubWorkflowRun }): ReactElement {
  const presentation = workflowRunPresentation(run);
  const triggeredRelativeTime = formatRelativeTime(run.createdAt);
  const startedRelativeTime = run.startedAt ? formatRelativeTime(run.startedAt) : undefined;
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
      aria-label={`${run.displayTitle}, ${presentation.label}, triggered ${triggeredRelativeTime}${
        startedRelativeTime ? `, started ${startedRelativeTime}` : ''
      }. Open workflow run in browser`}
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
        <small className="workflow-run-times">
          <time dateTime={run.createdAt} title={formatAbsoluteTime(run.createdAt)}>
            Triggered {triggeredRelativeTime}
          </time>
          {run.startedAt ? (
            <time dateTime={run.startedAt} title={formatAbsoluteTime(run.startedAt)}>
              Started {startedRelativeTime}
            </time>
          ) : null}
        </small>
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
  gitHubConnected: boolean;
  connections: PortainerConnection[];
  connectionsLoading: boolean;
  connectionsError?: string;
  catalog?: PortainerStackCatalog;
  catalogLoading: boolean;
  catalogError?: string;
  isSaving: boolean;
  errorMessage?: string;
  onChange: (dialog: DashboardDialog) => void;
  onConfigurePortainer: (connectionId?: string) => void;
  onOpenGitHubSettings: () => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

function DashboardDialogSurface({
  dialog,
  repositories,
  repositoriesLoading,
  repositoriesError,
  gitHubConnected,
  connections,
  connectionsLoading,
  connectionsError,
  catalog,
  catalogLoading,
  catalogError,
  isSaving,
  errorMessage,
  onChange,
  onConfigurePortainer,
  onOpenGitHubSettings,
  onClose,
  onSubmit
}: DashboardDialogSurfaceProps): ReactElement {
  const branchFilterError =
    dialog.kind === 'add-tile'
      ? workflowRunBranchFilterError(dialog.branches)
      : undefined;
  const selectedRepository =
    dialog.kind === 'add-tile'
      ? repositories.find(
          (repository) =>
            repository.fullName === (dialog.repository || repositories[0]?.fullName)
        )
      : undefined;
  const title =
    dialog.kind === 'create'
      ? 'Create dashboard'
      : dialog.kind === 'rename'
        ? 'Rename dashboard'
        : dialog.kind === 'add-tile'
          ? 'Add dashboard tile'
          : 'Delete dashboard';
  const description =
    dialog.kind === 'add-tile'
      ? 'Choose a live signal to keep in this dashboard.'
      : dialog.kind === 'delete'
        ? 'This removes the dashboard configuration and all of its tiles.'
        : 'Use a short name that describes the projects or delivery signal you monitor.';
  const selectedConnectionId =
    dialog.kind === 'add-tile'
      ? dialog.connectionId || connections[0]?.id || ''
      : '';
  const selectedEnvironment =
    dialog.kind === 'add-tile'
      ? catalog?.environments.find(
          (environment) => environment.id === dialog.endpointId
        ) ?? catalog?.environments[0]
      : undefined;
  const selectedStack =
    dialog.kind === 'add-tile'
      ? selectedEnvironment?.stacks.find((stack) => stack.id === dialog.stackId) ??
        selectedEnvironment?.stacks[0]
      : undefined;
  const addTileUnavailable =
    dialog.kind === 'add-tile' &&
    (dialog.tileKind === 'github-actions'
      ? !gitHubConnected || repositories.length === 0 || Boolean(branchFilterError)
      : !selectedConnectionId || !selectedEnvironment || !selectedStack);

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
                <span>Tile type</span>
                <select
                  data-modal-initial-focus="true"
                  value={dialog.tileKind}
                  onChange={(event) =>
                    onChange({
                      ...dialog,
                      tileKind: event.target.value as
                        | 'github-actions'
                        | 'portainer-swarm-stack'
                    })
                  }
                >
                  <option value="github-actions" disabled={!gitHubConnected}>
                    GitHub Actions
                  </option>
                  <option value="portainer-swarm-stack">Portainer Swarm stack</option>
                </select>
              </label>

              {dialog.tileKind === 'github-actions' ? (
                <>
                  {gitHubConnected ? (
                    <>
                      <label className="dashboard-field">
                        <span>GitHub project</span>
                        <select
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
                      <fieldset className="dashboard-filter-field">
                        <legend>Runs to include</legend>
                        <WorkflowBranchFilterField
                          value={dialog.branches}
                          placeholder={
                            selectedRepository?.defaultBranch ?? 'main, release/next'
                          }
                          onChange={(branches) => onChange({ ...dialog, branches })}
                        />
                        <div className="dashboard-filter-options">
                          <label className="dashboard-filter-option">
                            <input
                              type="checkbox"
                              checked={dialog.includeTags}
                              onChange={(event) =>
                                onChange({
                                  ...dialog,
                                  includeTags: event.target.checked
                                })
                              }
                            />
                            <span>
                              <strong>Tags</strong>
                              <small>Runs matching current repository tags.</small>
                            </span>
                          </label>
                          <label className="dashboard-filter-option">
                            <input
                              type="checkbox"
                              checked={dialog.includeMyPullRequests}
                              onChange={(event) =>
                                onChange({
                                  ...dialog,
                                  includeMyPullRequests: event.target.checked
                                })
                              }
                            />
                            <span>
                              <strong>My pull requests</strong>
                              <small>Runs linked to pull requests you authored.</small>
                            </span>
                          </label>
                        </div>
                        <p className="dashboard-filter-help">
                          Matches any selected filter. Leave everything empty to show all
                          runs.
                        </p>
                      </fieldset>
                      <div className="dashboard-dialog-note">
                        <Lock size={13} />
                        <span>Uses the GitHub CLI credentials attached to the active Git profile.</span>
                      </div>
                    </>
                  ) : (
                    <div className="dashboard-dialog-note">
                      <AlertTriangle size={13} />
                      <span>Connect a GitHub account before adding an Actions tile.</span>
                      <button
                        className="dashboard-note-action"
                        type="button"
                        onClick={onOpenGitHubSettings}
                      >
                        Open settings
                      </button>
                    </div>
                  )}

                  {repositoriesError ? (
                    <div className="dashboard-dialog-error" role="alert">
                      <AlertTriangle size={13} />
                      {repositoriesError}
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <div className="dashboard-field-with-action">
                    <label className="dashboard-field">
                      <span>Portainer connection</span>
                      <select
                        value={selectedConnectionId}
                        disabled={connectionsLoading || connections.length === 0}
                        onChange={(event) =>
                          onChange({
                            ...dialog,
                            connectionId: event.target.value,
                            endpointId: 0,
                            stackId: 0
                          })
                        }
                      >
                        {connectionsLoading ? <option value="">Loading connections…</option> : null}
                        {!connectionsLoading && connections.length === 0 ? (
                          <option value="">No Portainer connections configured</option>
                        ) : null}
                        {connections.map((connection) => (
                          <option key={connection.id} value={connection.id}>
                            {connection.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="btn-subtle"
                      type="button"
                      onClick={() => onConfigurePortainer(selectedConnectionId || undefined)}
                    >
                      <PlugZap size={13} />
                      {connections.length === 0 ? 'Configure' : 'Edit'}
                    </button>
                  </div>

                  <label className="dashboard-field">
                    <span>Swarm environment</span>
                    <select
                      value={selectedEnvironment?.id ?? ''}
                      disabled={
                        !selectedConnectionId ||
                        catalogLoading ||
                        !catalog ||
                        catalog.environments.length === 0
                      }
                      onChange={(event) =>
                        onChange({
                          ...dialog,
                          endpointId: Number(event.target.value),
                          stackId: 0
                        })
                      }
                    >
                      {catalogLoading ? <option value="">Loading environments…</option> : null}
                      {!catalogLoading && catalog?.environments.length === 0 ? (
                        <option value="">No Swarm environments available</option>
                      ) : null}
                      {catalog?.environments.map((environment) => (
                        <option key={environment.id} value={environment.id}>
                          {environment.name}
                          {environment.status === 'down' ? ' · Offline' : ''}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="dashboard-field">
                    <span>Stack</span>
                    <select
                      value={selectedStack?.id ?? ''}
                      disabled={!selectedEnvironment || selectedEnvironment.stacks.length === 0}
                      onChange={(event) =>
                        onChange({ ...dialog, stackId: Number(event.target.value) })
                      }
                    >
                      {selectedEnvironment?.stacks.length === 0 ? (
                        <option value="">No Swarm stacks available</option>
                      ) : null}
                      {selectedEnvironment?.stacks.map((stack) => (
                        <option key={stack.id} value={stack.id}>
                          {stack.name}
                          {stack.status === 'inactive' ? ' · Inactive' : ''}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="dashboard-dialog-note">
                    <Lock size={13} />
                    <span>
                      Monitors services, tasks, uptime, and Business Edition image
                      freshness using the selected connection.
                    </span>
                  </div>

                  {connectionsError || catalogError ? (
                    <div className="dashboard-dialog-error" role="alert">
                      <AlertTriangle size={13} />
                      {connectionsError ?? catalogError}
                    </div>
                  ) : null}
                </>
              )}
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
              addTileUnavailable
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

type WorkflowBranchFilterFieldProps = {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
};

export function WorkflowBranchFilterField({
  value,
  placeholder,
  onChange
}: WorkflowBranchFilterFieldProps): ReactElement {
  const error = workflowRunBranchFilterError(value);
  const describedBy = error
    ? 'dashboard-branch-filter-help dashboard-branch-filter-error'
    : 'dashboard-branch-filter-help';

  return (
    <>
      <label className="dashboard-field">
        <span>Branches</span>
        <input
          value={value}
          placeholder={placeholder}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          aria-errormessage={error ? 'dashboard-branch-filter-error' : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        <small id="dashboard-branch-filter-help">
          Exact branch names, separated by commas.
        </small>
      </label>
      {error ? (
        <div
          id="dashboard-branch-filter-error"
          className="dashboard-field-error"
          role="alert"
        >
          <AlertTriangle size={12} />
          {error}
        </div>
      ) : null}
    </>
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

function formatAbsoluteTime(isoDate: string): string {
  const date = new Date(isoDate);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : isoDate;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? cleanIpcErrorMessage(error.message)
    : 'An unexpected error occurred.';
}

function cleanIpcErrorMessage(message: string): string {
  return message.replace(
    /^Error invoking remote method '[^']+': Error: /,
    ''
  );
}
