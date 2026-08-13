import type {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement
} from 'react';
import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleSlash2,
  Copy,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  GripVertical,
  LayoutDashboard,
  Loader2,
  Lock,
  Pencil,
  PlugZap,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Workflow,
  X,
  XCircle
} from 'lucide-react';
import { ContextMenu as ContextMenuPrimitive } from 'radix-ui';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';

import { ModalSurface } from '@renderer/components/accessibility/ModalSurface';
import { openContextMenuFromKeyboard } from '@renderer/components/accessibility/menuKeyboard';
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
  DashboardActionFailureAlert,
  DashboardTile,
  GitHubActionsDashboardTile,
  GitHubActionsPullRequestGroup,
  GitHubRepositorySummary,
  GitHubWorkflowRun,
  GitProfile,
  PortainerConnection,
  PortainerStackCatalog
} from '@shared/types';

import { PortainerConnectionDialog } from './PortainerConnectionDialog';
import { PortainerStackTile } from './PortainerStackTile';
import { dashboardRepositoryOptions } from './dashboardRepositoryOptions';
import { resolveActiveDashboard } from './dashboardSelection';
import {
  dashboardTileRows,
  dashboardTileDropPositionForPointer,
  moveDashboardTile,
  moveDashboardTileToNewRow,
  reorderDashboardTiles,
  type DashboardTileDropPosition
} from './dashboardTileLayout';
import {
  hasWorkflowRunFilters,
  parseWorkflowRunBranches,
  workflowRunBranchFilterError,
  workflowRunFilterSummary
} from './workflowRunFilters';
import { workflowRunPresentation } from './workflowRunPresentation';
import {
  copyWorkflowRunFailure,
  sendWorkflowRunFailureToCodex
} from './workflowRunFailureActions';

type WorkflowRunNotice = {
  tone: 'progress' | 'success' | 'danger';
  message: string;
};

type DashboardViewProps = {
  profile?: GitProfile;
  requestedDashboardId?: string;
  actionAlerts?: DashboardActionFailureAlert[];
  onMarkActionAlertsRead?: (alertIds: string[]) => void;
  onSelectDashboard: (dashboardId: string | undefined) => void;
  onOpenWorkflowRun: (input: {
    owner: string;
    repository: string;
    run: GitHubWorkflowRun;
  }) => void;
  onOpenProfileSettings: () => void;
  onClose: () => void;
  resolveRepositoryPath?: (repository: {
    host: string;
    owner: string;
    name: string;
  }) => string | undefined;
  chooseRepositoryPathForCodex?: (repository: {
    host: string;
    owner: string;
    name: string;
  }) => Promise<string | undefined>;
};

type DashboardTileDialogFields = {
  tileKind: 'github-actions' | 'portainer-swarm-stack';
  repository: string;
  limit: number;
  view: 'runs' | 'pull-requests';
  branches: string;
  includeTags: boolean;
  includeMyPullRequests: boolean;
  connectionId: string;
  endpointId: number;
  stackId: number;
};

type DashboardTileDialog =
  | ({ kind: 'add-tile' } & DashboardTileDialogFields)
  | ({ kind: 'edit-tile'; tileId: string } & DashboardTileDialogFields);

type DashboardDialog =
  | { kind: 'create'; name: string }
  | { kind: 'rename'; name: string }
  | DashboardTileDialog
  | { kind: 'delete' };

type DashboardTileDragSession = {
  tileId: string;
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
};

type DashboardTileDropTarget =
  | {
      kind: 'tile';
      tileId: string;
      position: DashboardTileDropPosition;
    }
  | {
      kind: 'new-row';
    };

function isTileDialog(
  dialog: DashboardDialog | undefined
): dialog is DashboardTileDialog {
  return dialog?.kind === 'add-tile' || dialog?.kind === 'edit-tile';
}

export function DashboardView({
  profile,
  requestedDashboardId,
  actionAlerts = [],
  onMarkActionAlertsRead,
  onSelectDashboard,
  onOpenWorkflowRun,
  onOpenProfileSettings,
  onClose,
  resolveRepositoryPath,
  chooseRepositoryPathForCodex
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
  const [workflowRunNotice, setWorkflowRunNotice] =
    useState<WorkflowRunNotice>();
  const [draggedTileId, setDraggedTileId] = useState<string>();
  const [dropTarget, setDropTarget] = useState<DashboardTileDropTarget>();
  const [tileOrderAnnouncement, setTileOrderAnnouncement] = useState('');
  const tileDragSessionRef = useRef<DashboardTileDragSession | undefined>(undefined);
  const tileDropTargetRef = useRef<DashboardTileDropTarget | undefined>(undefined);
  const dashboards = dashboardsQuery.data?.dashboards ?? [];
  const activeDashboard = resolveActiveDashboard(
    dashboards,
    requestedDashboardId,
    dashboardsQuery.data?.selectedDashboardId
  );
  const editingTileId = dialog?.kind === 'edit-tile' ? dialog.tileId : undefined;
  const availableRepositories = useMemo(
    () =>
      dashboardRepositoryOptions(
        repositoriesQuery.data ?? [],
        activeDashboard,
        editingTileId
      ),
    [activeDashboard, editingTileId, repositoriesQuery.data]
  );
  const selectedConnectionId =
    isTileDialog(dialog) && dialog.tileKind === 'portainer-swarm-stack'
      ? dialog.connectionId || connectionsQuery.data?.[0]?.id
      : undefined;
  const catalogQuery = usePortainerStackCatalog(
    selectedConnectionId,
    isTileDialog(dialog) && dialog.tileKind === 'portainer-swarm-stack'
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
  const unreadActionAlerts = actionAlerts.filter((alert) => !alert.readAt);

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
      } else if (isTileDialog(dialog) && activeDashboard) {
        let nextTile: DashboardTile;

        if (dialog.tileKind === 'github-actions') {
          const repository = availableRepositories.find(
            (candidate) =>
              candidate.fullName ===
              (dialog.repository || availableRepositories[0]?.fullName)
          );

          if (!repository) {
            throw new Error('Select a GitHub project.');
          }

          nextTile = {
            id: dialog.kind === 'edit-tile' ? dialog.tileId : '',
            kind: 'github-actions',
            owner: repository.owner,
            repository: repository.name,
            limit: dialog.limit,
            view: dialog.view,
            filters: {
              branches: parseWorkflowRunBranches(dialog.branches),
              includeTags: dialog.includeTags,
              includeMyPullRequests: dialog.includeMyPullRequests
            }
          };
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
            throw new Error('Select a Portainer stack.');
          }

          nextTile = {
            id: dialog.kind === 'edit-tile' ? dialog.tileId : '',
            kind: 'portainer-swarm-stack',
            connectionId,
            endpointId: environment.id,
            stackId: stack.id,
            stackName: stack.name,
            environmentName: environment.name
          };
        }

        await persistDashboard({
          ...activeDashboard,
          tiles:
            dialog.kind === 'edit-tile'
              ? activeDashboard.tiles.map((tile) =>
                  tile.id === dialog.tileId ? nextTile : tile
                )
              : [...activeDashboard.tiles, nextTile]
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
      tileKind: gitHubProfileId ? 'github-actions' : 'portainer-swarm-stack',
      repository: availableRepositories[0]?.fullName ?? '',
      limit: 10,
      view: 'runs',
      branches: '',
      includeTags: false,
      includeMyPullRequests: false,
      connectionId: connectionsQuery.data?.[0]?.id ?? '',
      endpointId: 0,
      stackId: 0
    });
  }

  function openEditTileDialog(tile: DashboardTile): void {
    setMutationError(undefined);

    if (tile.kind === 'github-actions') {
      setDialog({
        kind: 'edit-tile',
        tileId: tile.id,
        tileKind: tile.kind,
        repository: `${tile.owner}/${tile.repository}`,
        limit: tile.limit,
        view: tile.view,
        branches: tile.filters.branches.join(', '),
        includeTags: tile.filters.includeTags,
        includeMyPullRequests: tile.filters.includeMyPullRequests,
        connectionId: connectionsQuery.data?.[0]?.id ?? '',
        endpointId: 0,
        stackId: 0
      });
      return;
    }

    setDialog({
      kind: 'edit-tile',
      tileId: tile.id,
      tileKind: tile.kind,
      repository: availableRepositories[0]?.fullName ?? '',
      limit: 10,
      view: 'runs',
      branches: '',
      includeTags: false,
      includeMyPullRequests: false,
      connectionId: tile.connectionId,
      endpointId: tile.endpointId,
      stackId: tile.stackId
    });
  }

  function finishTileDrag(): void {
    tileDragSessionRef.current = undefined;
    tileDropTargetRef.current = undefined;
    setDraggedTileId(undefined);
    setDropTarget(undefined);
  }

  function handleTilePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    tileId: string
  ): void {
    if (event.button !== 0 || isSaving || (activeDashboard?.tiles.length ?? 0) < 2) {
      return;
    }

    tileDragSessionRef.current = {
      tileId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false
    };
    tileDropTargetRef.current = undefined;
    setDropTarget(undefined);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleTilePointerMove(event: ReactPointerEvent<HTMLButtonElement>): void {
    const session = tileDragSessionRef.current;

    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    const movement = Math.max(
      Math.abs(event.clientX - session.startX),
      Math.abs(event.clientY - session.startY)
    );

    if (!session.dragging && movement < 5) {
      return;
    }

    if (!session.dragging) {
      session.dragging = true;
      setDraggedTileId(session.tileId);
    }

    event.preventDefault();
    const targetElement = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>(
        '[data-dashboard-tile-id], [data-dashboard-new-row]'
      );

    if (targetElement?.dataset.dashboardNewRow !== undefined) {
      const nextDropTarget = { kind: 'new-row' } as const;
      tileDropTargetRef.current = nextDropTarget;
      setDropTarget((current) =>
        current?.kind === 'new-row' ? current : nextDropTarget
      );
      return;
    }

    const targetTileId = targetElement?.dataset.dashboardTileId;

    if (!targetElement || !targetTileId) {
      tileDropTargetRef.current = undefined;
      setDropTarget(undefined);
      return;
    }

    const grid = targetElement.parentElement;
    const gridColumnCount = grid
      ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length
      : 1;
    const position = dashboardTileDropPositionForPointer(
      event.clientX,
      event.clientY,
      targetElement.getBoundingClientRect(),
      gridColumnCount
    );
    const nextDropTarget = {
      kind: 'tile',
      tileId: targetTileId,
      position
    } as const;
    tileDropTargetRef.current = nextDropTarget;
    setDropTarget((current) =>
      current?.kind === 'tile' &&
      current.tileId === targetTileId &&
      current.position === position
        ? current
        : nextDropTarget
    );
  }

  function handleTilePointerUp(event: ReactPointerEvent<HTMLButtonElement>): void {
    const session = tileDragSessionRef.current;

    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    const target = tileDropTargetRef.current;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    finishTileDrag();

    if (!session.dragging || !activeDashboard || !target) {
      return;
    }

    event.preventDefault();
    const reorderedTiles =
      target.kind === 'new-row'
        ? moveDashboardTileToNewRow(activeDashboard.tiles, session.tileId)
        : reorderDashboardTiles(
            activeDashboard.tiles,
            session.tileId,
            target.tileId,
            target.position
          );
    void persistReorderedTiles(activeDashboard, reorderedTiles, session.tileId);
  }

  function handleTileReorderKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    tileId: string
  ): void {
    const offset =
      event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? -1
        : event.key === 'ArrowRight' || event.key === 'ArrowDown'
          ? 1
          : undefined;

    if (!offset || !activeDashboard || isSaving) {
      return;
    }

    event.preventDefault();
    const reorderedTiles = moveDashboardTile(activeDashboard.tiles, tileId, offset);
    void persistReorderedTiles(activeDashboard, reorderedTiles, tileId);
  }

  async function persistReorderedTiles(
    dashboard: Dashboard,
    reorderedTiles: DashboardTile[],
    movedTileId: string
  ): Promise<void> {
    if (reorderedTiles === dashboard.tiles) {
      return;
    }

    try {
      await persistDashboard({ ...dashboard, tiles: reorderedTiles });
      const movedTileIndex = reorderedTiles.findIndex((tile) => tile.id === movedTileId);
      setTileOrderAnnouncement(
        `Tile moved to position ${movedTileIndex + 1} of ${reorderedTiles.length}.`
      );
    } catch {
      // The persisted order remains visible and the dashboard header shows the error.
    }
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
            {workflowRunNotice ? (
              <div
                className="dashboard-workflow-notice"
                data-tone={workflowRunNotice.tone}
                role="status"
                aria-live="polite"
              >
                {workflowRunNotice.tone === 'progress' ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : workflowRunNotice.tone === 'success' ? (
                  <CheckCircle2 size={13} />
                ) : (
                  <AlertTriangle size={13} />
                )}
                <span>{workflowRunNotice.message}</span>
                <button
                  className="icon-btn"
                  type="button"
                  aria-label="Dismiss workflow action message"
                  onClick={() => setWorkflowRunNotice(undefined)}
                >
                  <X size={12} />
                </button>
              </div>
            ) : null}
            {unreadActionAlerts.length > 0 ? (
              <DashboardFailureAlerts
                alerts={unreadActionAlerts}
                onMarkRead={(alertIds) => onMarkActionAlertsRead?.(alertIds)}
              />
            ) : null}
            <p className="sr-only" aria-live="polite">
              {tileOrderAnnouncement}
            </p>

            {activeDashboard.tiles.length > 0 ? (
              <div className="dashboard-grid">
                {dashboardTileRows(activeDashboard.tiles).map((row, rowIndex) => (
                  <div
                    className="dashboard-grid-row"
                    key={`row:${row[0]?.id ?? rowIndex}`}
                  >
                    {row.map((tile) => {
                      const tileIndex = activeDashboard.tiles.findIndex(
                        (candidate) => candidate.id === tile.id
                      );
                      const tileLabel =
                        tile.kind === 'github-actions'
                          ? `${tile.owner}/${tile.repository}`
                          : `${tile.environmentName}/${tile.stackName}`;
                      const dragHandle = (
                        <TileDragHandle
                          label={tileLabel}
                          position={tileIndex + 1}
                          tileCount={activeDashboard.tiles.length}
                          isDragging={draggedTileId === tile.id}
                          isDisabled={isSaving}
                          onPointerDown={(event) =>
                            handleTilePointerDown(event, tile.id)
                          }
                          onPointerMove={handleTilePointerMove}
                          onPointerUp={handleTilePointerUp}
                          onPointerCancel={finishTileDrag}
                          onKeyDown={(event) =>
                            handleTileReorderKeyDown(event, tile.id)
                          }
                        />
                      );

                      return (
                        <div
                          className="dashboard-tile-slot"
                          key={tile.id}
                          data-dashboard-tile-id={tile.id}
                          data-dragging={draggedTileId === tile.id}
                          data-drop-position={
                            dropTarget?.kind === 'tile' &&
                            dropTarget.tileId === tile.id &&
                            draggedTileId !== tile.id
                              ? dropTarget.position
                              : undefined
                          }
                        >
                          {tile.kind === 'github-actions' ? (
                            <GitHubActionsTile
                              profileId={gitHubProfileId}
                              tile={tile}
                              codexRepoPath={resolveRepositoryPath?.({
                                host: profile?.githubHost || 'github.com',
                                owner: tile.owner,
                                name: tile.repository
                              })}
                              chooseCodexRepoPath={
                                chooseRepositoryPathForCodex
                                  ? () =>
                                      chooseRepositoryPathForCodex({
                                        host: profile?.githubHost || 'github.com',
                                        owner: tile.owner,
                                        name: tile.repository
                                      })
                                  : undefined
                              }
                              dragHandle={dragHandle}
                              isSaving={isSaving}
                              onWorkflowRunNotice={setWorkflowRunNotice}
                              onOpenWorkflowRun={(run) =>
                                onOpenWorkflowRun({
                                  owner: tile.owner,
                                  repository: tile.repository,
                                  run
                                })
                              }
                              onEdit={() => openEditTileDialog(tile)}
                              onRemove={() => void handleRemoveTile(tile.id)}
                            />
                          ) : (
                            <PortainerStackTile
                              tile={tile}
                              dragHandle={dragHandle}
                              isSaving={isSaving}
                              onEdit={() => openEditTileDialog(tile)}
                              onRemove={() => void handleRemoveTile(tile.id)}
                            />
                          )}
                        </div>
                      );
                    })}
                    {Array.from({
                      length: activeDashboard.tiles.length - row.length
                    }).map((_, placeholderIndex) => (
                      <span
                        aria-hidden="true"
                        className="dashboard-grid-placeholder"
                        key={`placeholder:${placeholderIndex}`}
                      />
                    ))}
                  </div>
                ))}
                {draggedTileId ? (
                  <div
                    className="dashboard-new-row-drop-zone"
                    data-dashboard-new-row="true"
                    data-drop-active={dropTarget?.kind === 'new-row'}
                  >
                    <LayoutDashboard size={14} />
                    <span>Drop into a new row</span>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="dashboard-empty">
                <div className="dashboard-empty-icon">
                  <Workflow size={22} />
                </div>
                <h3>Add your first monitor</h3>
                <p>
                  Choose a GitHub project or Portainer stack and keep its live
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
                isTileDialog(current)
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

function DashboardFailureAlerts({
  alerts,
  onMarkRead
}: {
  alerts: DashboardActionFailureAlert[];
  onMarkRead: (alertIds: string[]) => void;
}): ReactElement {
  const visibleAlerts = alerts.slice(0, 5);

  return (
    <section
      className="dashboard-failure-alerts"
      aria-label="Unread workflow failures"
    >
      <header>
        <span>
          <BellRing size={13} />
          <strong>
            {alerts.length} unread workflow {alerts.length === 1 ? 'failure' : 'failures'}
          </strong>
        </span>
        <button
          className="btn-subtle"
          type="button"
          onClick={() => onMarkRead(alerts.map((alert) => alert.id))}
        >
          Mark all read
        </button>
      </header>
      <div>
        {visibleAlerts.map((alert) => (
          <a
            key={alert.id}
            href={alert.url}
            target="_blank"
            rel="noreferrer"
            onClick={() => onMarkRead([alert.id])}
          >
            <XCircle size={13} />
            <span>
              <strong>{alert.displayTitle}</strong>
              <small>
                {alert.owner}/{alert.repository} · {alert.workflowName} #{alert.runNumber}
                {alert.branch ? ` · ${alert.branch}` : ''}
              </small>
            </span>
            <time
              dateTime={alert.failedAt}
              title={formatAbsoluteTime(alert.failedAt)}
            >
              Failed {formatRelativeTime(alert.failedAt)}
            </time>
            <ExternalLink size={11} />
          </a>
        ))}
      </div>
      {alerts.length > visibleAlerts.length ? (
        <p>{alerts.length - visibleAlerts.length} more unread failures</p>
      ) : null}
    </section>
  );
}

function dashboardTabDomId(dashboardId: string): string {
  return `dashboard-tab-${dashboardId.replace(/[^\dA-Za-z_-]/g, '-')}`;
}

type TileDragHandleProps = {
  label: string;
  position: number;
  tileCount: number;
  isDragging: boolean;
  isDisabled: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
};

function TileDragHandle({
  label,
  position,
  tileCount,
  isDragging,
  isDisabled,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onKeyDown
}: TileDragHandleProps): ReactElement {
  const isReorderable = tileCount > 1 && !isDisabled;

  return (
    <button
      className="dashboard-tile-drag-handle icon-btn"
      type="button"
      disabled={!isReorderable}
      aria-label={`Reorder ${label} tile, position ${position} of ${tileCount}. Drag or use arrow keys.`}
      title={
        tileCount > 1
          ? 'Drag to reorder · Arrow keys also move this tile'
          : 'Add another tile to reorder'
      }
      data-dragging={isDragging}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
    >
      <GripVertical size={12} />
    </button>
  );
}

type GitHubActionsTileProps = {
  profileId?: string;
  tile: GitHubActionsDashboardTile;
  codexRepoPath?: string;
  chooseCodexRepoPath?: () => Promise<string | undefined>;
  dragHandle: ReactElement;
  isSaving: boolean;
  onWorkflowRunNotice: (notice: WorkflowRunNotice | undefined) => void;
  onOpenWorkflowRun: (run: GitHubWorkflowRun) => void;
  onEdit: () => void;
  onRemove: () => void;
};

function GitHubActionsTile({
  profileId,
  tile,
  codexRepoPath,
  chooseCodexRepoPath,
  dragHandle,
  isSaving,
  onWorkflowRunNotice,
  onOpenWorkflowRun,
  onEdit,
  onRemove
}: GitHubActionsTileProps): ReactElement {
  const runsQuery = useGitHubActionsRuns(
    profileId
      ? {
          profileId,
          owner: tile.owner,
          repository: tile.repository,
          limit: tile.limit,
          view: tile.view,
          filters: tile.filters
        }
      : undefined
  );
  const runs = runsQuery.data?.runs ?? [];
  const pullRequests = runsQuery.data?.pullRequests;
  const [pullRequestExpansionOverrides, setPullRequestExpansionOverrides] =
    useState<Map<number, boolean>>(() => new Map());
  const pullRequestCount = pullRequests?.length ?? 0;
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
  const tileSubtitle =
    tile.view === 'pull-requests'
      ? `my open PRs${runsQuery.data ? ` · ${pullRequestCount} ${
          pullRequestCount === 1 ? 'PR' : 'PRs'
        }` : ''}`
      : filterSummary;

  return (
    <article
      className="actions-tile"
      aria-label={`${tile.owner}/${tile.repository} ${
        tile.view === 'pull-requests' ? 'open pull requests' : 'workflow runs'
      }, ${tileSubtitle}`}
    >
      <header className="actions-tile-header">
        <div className="actions-tile-identity">
          <span className="min-w-0">
            <strong>
              <span>{tile.owner}/</span>
              {tile.repository}
            </strong>
            <small
              title={
                tile.view === 'pull-requests'
                  ? 'Open pull requests authored by you'
                  : `Run filters: ${filterSummary}`
              }
            >
              {tileSubtitle}
            </small>
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
            className="actions-tile-edit icon-btn"
            type="button"
            disabled={isSaving}
            aria-label={`Edit ${tile.owner}/${tile.repository} tile`}
            title="Edit tile"
            onClick={onEdit}
          >
            <Pencil size={11} />
          </button>
          {dragHandle}
          <button
            className="actions-tile-remove icon-btn"
            type="button"
            disabled={isSaving}
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
          <span>
            {tile.view === 'pull-requests'
              ? 'Loading open pull requests…'
              : 'Loading workflow runs…'}
          </span>
        </div>
      ) : tile.view === 'pull-requests' && pullRequests && pullRequests.length > 0 ? (
        <>
          <div className="pull-request-workflow-list">
            {pullRequests.map((pullRequest, index) => {
              const expanded =
                pullRequestExpansionOverrides.get(pullRequest.number) ??
                isPullRequestExpandedByDefault(pullRequest, index);

              return (
                <PullRequestWorkflowGroup
                  key={pullRequest.number}
                  pullRequest={pullRequest}
                  failureActions={{
                    profileId,
                    owner: tile.owner,
                    repository: tile.repository,
                    codexRepoPath,
                    chooseCodexRepoPath,
                    onNotice: onWorkflowRunNotice
                  }}
                  onOpenWorkflowRun={onOpenWorkflowRun}
                  expanded={expanded}
                  onToggle={() =>
                    setPullRequestExpansionOverrides((current) => {
                      const next = new Map(current);
                      next.set(pullRequest.number, !expanded);
                      return next;
                    })
                  }
                />
              );
            })}
          </div>
          {searchLimitReached ? (
            <div className="actions-tile-search-note">
              Grouped from the latest {searchedRunCount} workflow runs.
            </div>
          ) : null}
        </>
      ) : runs.length > 0 ? (
        <>
          <div className="workflow-run-list">
            {runs.map((run) => (
              <WorkflowRunRow
                key={run.id}
                run={run}
                failureActions={{
                  profileId,
                  owner: tile.owner,
                  repository: tile.repository,
                  codexRepoPath,
                  chooseCodexRepoPath,
                  onNotice: onWorkflowRunNotice
                }}
                onOpenWorkflowRun={onOpenWorkflowRun}
              />
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
          {tile.view === 'pull-requests' ? (
            <GitPullRequest size={17} />
          ) : (
            <CircleSlash2 size={17} />
          )}
          <span>
            {tile.view === 'pull-requests'
              ? 'No open pull requests authored by you.'
              : searchLimitReached
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

function PullRequestWorkflowGroup({
  pullRequest,
  failureActions,
  onOpenWorkflowRun,
  expanded,
  onToggle
}: {
  pullRequest: GitHubActionsPullRequestGroup;
  failureActions: WorkflowRunFailureActionsContext;
  onOpenWorkflowRun: (run: GitHubWorkflowRun) => void;
  expanded: boolean;
  onToggle: () => void;
}): ReactElement {
  const presentation = pullRequestGroupPresentation(pullRequest);
  const updatedRelativeTime = formatRelativeTime(pullRequest.updatedAt);

  return (
    <section className="pull-request-workflow-group">
      <header>
        <button
          className="pull-request-workflow-toggle icon-btn"
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} pull request #${pullRequest.number}`}
          onClick={onToggle}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <a
          className="pull-request-workflow-identity"
          href={pullRequest.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open pull request #${pullRequest.number}: ${pullRequest.title}`}
        >
          <strong title={`#${pullRequest.number} ${pullRequest.title}`}>
            <span>#{pullRequest.number}</span> {pullRequest.title}
          </strong>
          <small>
            <GitBranch size={9} />
            <span title={pullRequest.headRefName}>{pullRequest.headRefName}</span>
            <span aria-hidden="true">→</span>
            <span title={pullRequest.baseRefName}>{pullRequest.baseRefName}</span>
            <span aria-hidden="true">·</span>
            <time
              dateTime={pullRequest.updatedAt}
              title={formatAbsoluteTime(pullRequest.updatedAt)}
            >
              updated {updatedRelativeTime}
            </time>
          </small>
        </a>
        <span
          className="pull-request-workflow-summary"
          data-tone={presentation.tone}
        >
          {presentation.icon === 'running' ? (
            <Loader2 size={10} className="animate-spin" />
          ) : presentation.icon === 'success' ? (
            <CheckCircle2 size={10} />
          ) : presentation.icon === 'failure' ? (
            <XCircle size={10} />
          ) : (
            <CircleSlash2 size={10} />
          )}
          {presentation.label}
        </span>
      </header>
      {expanded ? (
        pullRequest.runs.length > 0 ? (
          <div className="pull-request-workflow-runs">
            {pullRequest.runs.map((run) => (
              <PullRequestWorkflowRow
                key={run.id}
                run={run}
                failureActions={failureActions}
                onOpenWorkflowRun={onOpenWorkflowRun}
              />
            ))}
          </div>
        ) : (
          <div className="pull-request-workflow-empty">
            No recent workflow runs.
          </div>
        )
      ) : null}
    </section>
  );
}

function PullRequestWorkflowRow({
  run,
  failureActions,
  onOpenWorkflowRun
}: {
  run: GitHubWorkflowRun;
  failureActions: WorkflowRunFailureActionsContext;
  onOpenWorkflowRun: (run: GitHubWorkflowRun) => void;
}): ReactElement {
  const presentation = workflowRunPresentation(run);
  const statusIcon =
    presentation.icon === 'running' ? (
      <Loader2 size={11} className="animate-spin" />
    ) : presentation.icon === 'success' ? (
      <CheckCircle2 size={11} />
    ) : presentation.icon === 'failure' ? (
      <XCircle size={11} />
    ) : (
      <CircleSlash2 size={11} />
    );

  const hasFailureActions =
    presentation.tone === 'danger' && Boolean(failureActions.profileId);
  const row = (
    <button
      className="pull-request-workflow-run"
      type="button"
      onClick={() => onOpenWorkflowRun(run)}
      aria-haspopup={hasFailureActions ? 'menu' : undefined}
      title={
        hasFailureActions
          ? 'Open workflow run · right-click for failure actions'
          : undefined
      }
      onKeyDown={
        hasFailureActions ? openContextMenuFromKeyboard : undefined
      }
      aria-label={`${run.name}, ${presentation.label}. Open workflow run in Git Gud`}
    >
      <span data-tone={presentation.tone}>{statusIcon}</span>
      <strong title={run.name}>{run.name}</strong>
      <span data-tone={presentation.tone}>{presentation.label}</span>
      <ChevronRight size={10} aria-hidden="true" />
    </button>
  );

  return (
    <WorkflowRunFailureContextMenu
      run={run}
      actions={failureActions}
    >
      {row}
    </WorkflowRunFailureContextMenu>
  );
}

type WorkflowRunFailureActionsContext = {
  profileId?: string;
  owner: string;
  repository: string;
  codexRepoPath?: string;
  chooseCodexRepoPath?: () => Promise<string | undefined>;
  onNotice: (notice: WorkflowRunNotice | undefined) => void;
};

function WorkflowRunFailureContextMenu({
  run,
  actions,
  children
}: {
  run: GitHubWorkflowRun;
  actions: WorkflowRunFailureActionsContext;
  children: ReactElement;
}): ReactElement {
  const failedLogPromiseRef = useRef<Promise<string> | undefined>(undefined);
  const profileId = actions.profileId;
  const isFailure =
    workflowRunPresentation(run).tone === 'danger' && Boolean(profileId);

  if (!isFailure || !profileId) {
    return children;
  }
  const connectedProfileId = profileId;

  function loadFailedLog(): Promise<string> {
    if (!failedLogPromiseRef.current) {
      failedLogPromiseRef.current = window.api
        .getGitHubWorkflowRunFailedLog({
          profileId: connectedProfileId,
          owner: actions.owner,
          repository: actions.repository,
          runId: run.id
        })
        .catch((error: unknown) => {
          failedLogPromiseRef.current = undefined;
          throw error;
        });
    }

    return failedLogPromiseRef.current;
  }

  async function copyFailure(): Promise<void> {
    actions.onNotice({
      tone: 'progress',
      message: `Loading the failed log for ${run.name} #${run.runNumber}…`
    });

    try {
      const failedLog = await loadFailedLog();
      await copyWorkflowRunFailure(failedLog, navigator.clipboard);
      actions.onNotice({
        tone: 'success',
        message: `Copied the error from ${run.name} #${run.runNumber}.`
      });
    } catch (error) {
      actions.onNotice({
        tone: 'danger',
        message: `Could not copy the workflow error: ${errorMessage(error)}`
      });
    }
  }

  async function sendFailureToCodex(): Promise<void> {
    actions.onNotice({
      tone: 'progress',
      message: actions.codexRepoPath
        ? `Loading the failed log for ${run.name} #${run.runNumber}…`
        : `Choose the local checkout for ${actions.owner}/${actions.repository}…`
    });

    try {
      const result = await sendWorkflowRunFailureToCodex(
        {
          owner: actions.owner,
          repository: actions.repository,
          run
        },
        {
          repoPath: actions.codexRepoPath,
          chooseRepositoryPath: actions.chooseCodexRepoPath,
          loadFailedLog,
          openCodexTask: window.api.openCodexTask
        }
      );

      if (result === 'cancelled') {
        actions.onNotice(undefined);
        return;
      }

      actions.onNotice({
        tone: 'success',
        message: `Opened a Codex task for ${run.name} #${run.runNumber}.`
      });
    } catch (error) {
      actions.onNotice({
        tone: 'danger',
        message: `Could not send the workflow error to Codex: ${errorMessage(error)}`
      });
    }
  }

  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>
        {children}
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          className="context-menu-surface workflow-run-context-menu"
          collisionPadding={8}
          aria-label={`Failure actions for ${run.name} #${run.runNumber}`}
        >
          <ContextMenuPrimitive.Label className="workflow-run-context-menu-label">
            Workflow failure
          </ContextMenuPrimitive.Label>
          <ContextMenuPrimitive.Item
            className="menu-row"
            onSelect={() => void copyFailure()}
          >
            <Copy size={13} />
            <span>Copy error</span>
          </ContextMenuPrimitive.Item>
          <ContextMenuPrimitive.Item
            className="menu-row"
            title={
              actions.codexRepoPath
                ? 'Open a new Codex task with the failed log'
                : `Choose the local checkout for ${actions.owner}/${actions.repository}, then open a Codex task with the failed log`
            }
            onSelect={() => void sendFailureToCodex()}
          >
            <Sparkles size={13} />
            <span>Send error to Codex</span>
          </ContextMenuPrimitive.Item>
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}

function pullRequestGroupPresentation(
  pullRequest: GitHubActionsPullRequestGroup
): {
  label: string;
  tone: 'running' | 'success' | 'danger' | 'muted';
  icon: 'running' | 'success' | 'failure' | 'cancelled';
} {
  const presentations = pullRequest.runs.map(workflowRunPresentation);
  const failedCount = presentations.filter(
    (presentation) => presentation.tone === 'danger'
  ).length;

  if (failedCount > 0) {
    return {
      label: `${failedCount} failed`,
      tone: 'danger',
      icon: 'failure'
    };
  }

  const runningCount = presentations.filter(
    (presentation) => presentation.tone === 'running'
  ).length;

  if (runningCount > 0) {
    return {
      label: `${runningCount} running`,
      tone: 'running',
      icon: 'running'
    };
  }

  if (presentations.length === 0) {
    return {
      label: 'No runs',
      tone: 'muted',
      icon: 'cancelled'
    };
  }

  if (presentations.some((presentation) => presentation.tone === 'muted')) {
    return {
      label: 'Unknown',
      tone: 'muted',
      icon: 'cancelled'
    };
  }

  return {
    label: 'Healthy',
    tone: 'success',
    icon: 'success'
  };
}

function isPullRequestExpandedByDefault(
  pullRequest: GitHubActionsPullRequestGroup,
  index: number
): boolean {
  return index === 0 || pullRequestGroupPresentation(pullRequest).tone === 'danger';
}

function WorkflowRunRow({
  run,
  failureActions,
  onOpenWorkflowRun
}: {
  run: GitHubWorkflowRun;
  failureActions: WorkflowRunFailureActionsContext;
  onOpenWorkflowRun: (run: GitHubWorkflowRun) => void;
}): ReactElement {
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

  const hasFailureActions =
    presentation.tone === 'danger' && Boolean(failureActions.profileId);
  const row = (
    <button
      className="workflow-run-row"
      type="button"
      onClick={() => onOpenWorkflowRun(run)}
      aria-haspopup={hasFailureActions ? 'menu' : undefined}
      title={
        hasFailureActions
          ? 'Open workflow run · right-click for failure actions'
          : undefined
      }
      onKeyDown={
        hasFailureActions ? openContextMenuFromKeyboard : undefined
      }
      aria-label={`${run.displayTitle}, ${presentation.label}, triggered ${triggeredRelativeTime}${
        startedRelativeTime ? `, started ${startedRelativeTime}` : ''
      }. Open workflow run in Git Gud`}
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
      <ChevronRight size={12} className="workflow-run-external" aria-hidden="true" />
    </button>
  );

  return (
    <WorkflowRunFailureContextMenu
      run={run}
      actions={failureActions}
    >
      {row}
    </WorkflowRunFailureContextMenu>
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

export function DashboardDialogSurface({
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
  const branchFilterError = isTileDialog(dialog)
    ? workflowRunBranchFilterError(dialog.branches)
    : undefined;
  const selectedRepository =
    isTileDialog(dialog)
      ? repositories.find(
          (repository) =>
            repository.fullName === (dialog.repository || repositories[0]?.fullName)
        )
      : undefined;
  const canConfigureGitHubTile =
    gitHubConnected ||
    (dialog.kind === 'edit-tile' && dialog.tileKind === 'github-actions');
  const title =
    dialog.kind === 'create'
      ? 'Create dashboard'
      : dialog.kind === 'rename'
        ? 'Rename dashboard'
        : dialog.kind === 'add-tile'
          ? 'Add dashboard tile'
          : dialog.kind === 'edit-tile'
            ? 'Edit dashboard tile'
            : 'Delete dashboard';
  const description =
    dialog.kind === 'add-tile'
      ? 'Choose a live signal to keep in this dashboard.'
      : dialog.kind === 'edit-tile'
        ? 'Update this tile without changing its position in the dashboard.'
      : dialog.kind === 'delete'
        ? 'This removes the dashboard configuration and all of its tiles.'
        : 'Use a short name that describes the projects or delivery signal you monitor.';
  const selectedConnectionId =
    isTileDialog(dialog)
      ? dialog.connectionId || connections[0]?.id || ''
      : '';
  const selectedEnvironment =
    isTileDialog(dialog)
      ? catalog?.environments.find(
          (environment) => environment.id === dialog.endpointId
        ) ?? catalog?.environments[0]
      : undefined;
  const selectedStack =
    isTileDialog(dialog)
      ? selectedEnvironment?.stacks.find((stack) => stack.id === dialog.stackId) ??
        selectedEnvironment?.stacks[0]
      : undefined;
  const tileSaveUnavailable =
    isTileDialog(dialog) &&
    (dialog.tileKind === 'github-actions'
      ? !canConfigureGitHubTile ||
        repositories.length === 0 ||
        Boolean(branchFilterError)
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
          ) : isTileDialog(dialog) ? (
            <>
              <label className="dashboard-field">
                <span>Tile type</span>
                <select
                  data-modal-initial-focus={
                    dialog.kind === 'add-tile' ? 'true' : undefined
                  }
                  value={dialog.tileKind}
                  disabled={dialog.kind === 'edit-tile'}
                  onChange={(event) =>
                    onChange({
                      ...dialog,
                      tileKind: event.target.value as
                        | 'github-actions'
                        | 'portainer-swarm-stack'
                    })
                  }
                >
                  <option value="github-actions" disabled={!canConfigureGitHubTile}>
                    GitHub Actions
                  </option>
                  <option value="portainer-swarm-stack">Portainer stack</option>
                </select>
              </label>

              {dialog.tileKind === 'github-actions' ? (
                <>
                  {canConfigureGitHubTile ? (
                    <>
                      <label className="dashboard-field">
                        <span>GitHub project</span>
                        <select
                          data-modal-initial-focus={
                            dialog.kind === 'edit-tile' ? 'true' : undefined
                          }
                          value={dialog.repository || repositories[0]?.fullName || ''}
                          required
                          disabled={repositoriesLoading || repositories.length === 0}
                          onChange={(event) =>
                            onChange({ ...dialog, repository: event.target.value })
                          }
                        >
                          {repositoriesLoading ? <option value="">Loading projects…</option> : null}
                          {!repositoriesLoading && repositories.length === 0 ? (
                            <option value="">No projects available</option>
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
                        <span>View</span>
                        <select
                          value={dialog.view}
                          onChange={(event) => {
                            const view = event.target.value as
                              | 'runs'
                              | 'pull-requests';
                            onChange({
                              ...dialog,
                              view,
                              branches: view === 'pull-requests' ? '' : dialog.branches,
                              includeTags:
                                view === 'pull-requests'
                                  ? false
                                  : dialog.includeTags,
                              includeMyPullRequests: view === 'pull-requests'
                            });
                          }}
                        >
                          <option value="runs">Recent workflow runs</option>
                          <option value="pull-requests">My open pull requests</option>
                        </select>
                      </label>
                      <label className="dashboard-field">
                        <span>
                          {dialog.view === 'pull-requests'
                            ? 'Pull requests to show'
                            : 'Workflow runs to show'}
                        </span>
                        <select
                          value={dialog.limit}
                          onChange={(event) =>
                            onChange({ ...dialog, limit: Number(event.target.value) })
                          }
                        >
                          {[5, 10, 15, 20].map((limit) => (
                            <option key={limit} value={limit}>
                              {dialog.view === 'pull-requests'
                                ? `Last ${limit} open PRs`
                                : `Last ${limit} runs`}
                            </option>
                          ))}
                        </select>
                      </label>
                      {dialog.view === 'pull-requests' ? (
                        <div className="dashboard-pr-view-note">
                          <GitPullRequest size={13} />
                          <span>
                            Groups open PRs you authored and shows the latest attempt of
                            each workflow.
                          </span>
                        </div>
                      ) : (
                        <fieldset className="dashboard-filter-field">
                          <legend>Runs to include</legend>
                          <WorkflowBranchFilterField
                            value={dialog.branches}
                            placeholder={
                              selectedRepository?.defaultBranch || 'main, release/next'
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
                            Matches any selected filter. Leave everything empty to show
                            all runs.
                          </p>
                        </fieldset>
                      )}
                      <div className="dashboard-dialog-note">
                        {gitHubConnected ? (
                          <>
                            <Lock size={13} />
                            <span>
                              Uses the GitHub CLI credentials attached to the active Git
                              profile.
                            </span>
                          </>
                        ) : (
                          <>
                            <AlertTriangle size={13} />
                            <span>
                              Settings can be saved, but runs will not refresh until GitHub
                              is reconnected.
                            </span>
                            <button
                              className="dashboard-note-action"
                              type="button"
                              onClick={onOpenGitHubSettings}
                            >
                              Open settings
                            </button>
                          </>
                        )}
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
                        data-modal-initial-focus={
                          dialog.kind === 'edit-tile' ? 'true' : undefined
                        }
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
                    <span>Portainer environment</span>
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
                        <option value="">No Docker environments available</option>
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
                        <option value="">No Portainer stacks available</option>
                      ) : null}
                      {selectedEnvironment?.stacks.map((stack) => (
                        <option key={stack.id} value={stack.id}>
                          {stack.name}
                          {` · ${stack.stackType === 'swarm' ? 'Swarm' : 'Compose'}`}
                          {stack.status === 'inactive' ? ' · Inactive' : ''}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="dashboard-dialog-note">
                    <Lock size={13} />
                    <span>
                      Monitors services or containers, runtime health, and Business Edition
                      image freshness using the selected connection.
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
              tileSaveUnavailable
            }
          >
            {isSaving ? <Loader2 size={13} className="animate-spin" /> : null}
            {dialog.kind === 'create'
              ? 'Create dashboard'
              : dialog.kind === 'rename'
                ? 'Save name'
                : dialog.kind === 'add-tile'
                  ? 'Add tile'
                  : dialog.kind === 'edit-tile'
                    ? 'Save tile'
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
