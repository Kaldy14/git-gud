import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import Store from 'electron-store';

import type {
  AppSettings,
  AppSettingsInput,
  DashboardActionAlertState,
  DashboardActionFailureAlert,
  Dashboard,
  DashboardInput,
  DashboardState,
  DashboardTile,
  GitProfile,
  GitHubActionsRuns,
  GitHubActionsRunsInput,
  GitHubActionsRunFilters,
  GitHubActionsTileView,
  GitHubWorkflowRun,
  GitHubWorkflowRunConclusion,
  RepositorySummary,
  WorkspaceState
} from '@shared/types';
import { createDefaultAppSettings, normalizeAppSettings } from '@shared/settings';
import {
  activateRepositoryTab,
  assignRepositoryProfile,
  closeRepositoryTab,
  createDefaultWorkspaceState,
  normalizeWorkspaceState,
  partitionWorkspaceByProfile,
  profileWorkspaceKey,
  reorderRepositoryTab,
  replaceRepositoryTab,
  selectRepositoryCommit,
  selectRepositoryFile,
  setDetailPanelCollapsed,
  setDetailPanelWidth,
  setSidebarCollapsed,
  setSidebarWidth,
  upsertRepositoryTab
} from '@shared/workspace';

import { listProfiles } from './profiles';

type StoreShape = {
  workspace: WorkspaceState;
  workspacesByProfile: Record<string, WorkspaceState>;
  activeProfileId?: string;
  settings: AppSettings;
  dashboards: Dashboard[];
  selectedDashboardIds: Record<string, string>;
  dashboardActionAlerts: StoredDashboardActionAlerts;
  repositoryFetchTimestamps: Record<string, string>;
};

type StoredDashboardActionRun = {
  failed: boolean;
  updatedAt: string;
};

type StoredDashboardActionSource = {
  lastObservedAt: string;
  runs: Record<string, StoredDashboardActionRun>;
};

type StoredDashboardActionAlerts = {
  alerts: DashboardActionFailureAlert[];
  sources: Record<string, StoredDashboardActionSource>;
};

export type DashboardActionRunsRecordResult = {
  state: DashboardActionAlertState;
  newAlerts: DashboardActionFailureAlert[];
  notify: boolean;
};

const store = new Store<StoreShape>({
  name: 'git-gud-workspace',
  clearInvalidConfig: true,
  ...testStoreDirectory('workspace'),
  defaults: {
    workspace: createDefaultWorkspaceState(),
    workspacesByProfile: {},
    settings: createDefaultAppSettings(),
    dashboards: [],
    selectedDashboardIds: {},
    dashboardActionAlerts: {
      alerts: [],
      sources: {}
    },
    repositoryFetchTimestamps: {}
  }
});

const SELECTION_PERSIST_DELAY_MS = 150;
const DASHBOARD_ACTION_ALERT_LIMIT = 250;
const pendingWorkspaceWrites = new Map<string, WorkspaceState>();
const pendingWorkspaceWriteTimers = new Map<string, ReturnType<typeof setTimeout>>();
const observedDashboardActionSourcesThisSession = new Set<string>();

export function getWorkspace(): WorkspaceState {
  const workspacesByProfile = getProfileWorkspaces();
  const activeProfileId = getActiveProfileId();
  const storedWorkspace = workspacesByProfile[profileWorkspaceKey(activeProfileId)];
  const workspace = normalizeWorkspaceState(storedWorkspace ?? createDefaultWorkspaceState(activeProfileId));

  return workspaceForProfile(workspace, activeProfileId);
}

export function getRepositoryLastFetchedAt(commonDir: string): string | undefined {
  return store.get('repositoryFetchTimestamps')?.[commonDir];
}

export function recordRepositoryFetch(
  commonDir: string,
  fetchedAt = new Date().toISOString()
): void {
  store.set('repositoryFetchTimestamps', {
    ...(store.get('repositoryFetchTimestamps') ?? {}),
    [commonDir]: fetchedAt
  });
}

export function activateWorkspaceProfile(profileId: string | undefined): WorkspaceState {
  getProfileWorkspaces();
  setActiveProfileId(profileId);
  return getWorkspace();
}

export function openWorkspaceRepository(repository: RepositorySummary): WorkspaceState {
  const workspace = getWorkspace();
  const opened = upsertRepositoryTab(workspace, repository);
  return saveWorkspace(assignRepositoryProfile(opened, repository.path, workspace.activeProfileId));
}

export function replaceWorkspaceRepository(tabId: string, repository: RepositorySummary): WorkspaceState {
  const workspace = getWorkspace();
  return saveWorkspace(replaceRepositoryTab(workspace, tabId, repository));
}

export function activateWorkspaceTab(tabId: string): WorkspaceState {
  return saveWorkspace(activateRepositoryTab(getWorkspace(), tabId));
}

export function reorderWorkspaceTab(tabId: string, targetIndex: number): WorkspaceState {
  return saveWorkspace(reorderRepositoryTab(getWorkspace(), tabId, targetIndex));
}

export function closeWorkspaceTab(tabId: string): WorkspaceState {
  return saveWorkspace(closeRepositoryTab(getWorkspace(), tabId));
}

export function selectWorkspaceCommit(tabId: string, selectedCommit: string | undefined): WorkspaceState {
  return saveWorkspace(selectRepositoryCommit(getWorkspace(), tabId, selectedCommit), true);
}

export function selectWorkspaceFile(tabId: string, selectedFile: string | undefined): WorkspaceState {
  return saveWorkspace(selectRepositoryFile(getWorkspace(), tabId, selectedFile), true);
}

export function updateSidebarCollapsed(collapsed: boolean): WorkspaceState {
  return saveWorkspace(setSidebarCollapsed(getWorkspace(), collapsed));
}

export function updateSidebarWidth(width: number): WorkspaceState {
  return saveWorkspace(setSidebarWidth(getWorkspace(), width));
}

export function updateDetailPanelCollapsed(collapsed: boolean): WorkspaceState {
  return saveWorkspace(setDetailPanelCollapsed(getWorkspace(), collapsed));
}

export function updateDetailPanelWidth(width: number): WorkspaceState {
  return saveWorkspace(setDetailPanelWidth(getWorkspace(), width));
}

export function assignWorkspaceProfile(repoPath: string, profileId: string | undefined): WorkspaceState {
  return saveWorkspace(assignRepositoryProfile(getWorkspace(), repoPath, profileId));
}

export function getAppSettings(): AppSettings {
  return normalizeAppSettings(store.get('settings', createDefaultAppSettings()));
}

export function updateAppSettings(settings: AppSettingsInput): AppSettings {
  const nextSettings = normalizeAppSettings(settings, getAppSettings());
  store.set('settings', nextSettings);
  return nextSettings;
}

export function getDashboards(profileId: string): DashboardState {
  const dashboards = normalizeDashboards(store.get('dashboards', []))
    .filter((dashboard) => dashboard.profileId === profileId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const selectedDashboardIds = normalizeSelectedDashboardIds(
    store.get('selectedDashboardIds', {})
  );
  const persistedDashboardId = selectedDashboardIds[profileId];

  return {
    profileId,
    dashboards,
    selectedDashboardId:
      dashboards.find((dashboard) => dashboard.id === persistedDashboardId)?.id ??
      dashboards[0]?.id
  };
}

export function saveDashboard(input: DashboardInput): DashboardState {
  const dashboards = normalizeDashboards(store.get('dashboards', []));
  const existing = input.id
    ? dashboards.find(
        (dashboard) => dashboard.id === input.id && dashboard.profileId === input.profileId
      )
    : undefined;
  const now = new Date().toISOString();
  const dashboard: Dashboard = {
    id: existing?.id ?? randomUUID(),
    profileId: input.profileId,
    name: input.name.trim(),
    tiles: input.tiles.map((tile) =>
      tile.kind === 'github-actions'
        ? {
            id: tile.id || randomUUID(),
            kind: tile.kind,
            owner: tile.owner.trim(),
            repository: tile.repository.trim(),
            limit: tile.limit,
            view: normalizeGitHubActionsTileView(tile.view),
            filters: normalizeGitHubActionsRunFilters(tile.filters)
          }
        : {
            id: tile.id || randomUUID(),
            kind: tile.kind,
            connectionId: tile.connectionId,
            endpointId: tile.endpointId,
            stackId: tile.stackId,
            stackName: tile.stackName.trim(),
            environmentName: tile.environmentName.trim()
          }
    ),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  const nextDashboards = existing
    ? dashboards.map((candidate) => (candidate.id === existing.id ? dashboard : candidate))
    : [...dashboards, dashboard];

  store.set('dashboards', nextDashboards);

  const selectedDashboardIds = normalizeSelectedDashboardIds(
    store.get('selectedDashboardIds', {})
  );

  if (!selectedDashboardIds[input.profileId]) {
    store.set('selectedDashboardIds', {
      ...selectedDashboardIds,
      [input.profileId]: dashboard.id
    });
  }

  return getDashboards(input.profileId);
}

export function deleteDashboard(profileId: string, dashboardId: string): DashboardState {
  const dashboards = normalizeDashboards(store.get('dashboards', []));
  store.set(
    'dashboards',
    dashboards.filter(
      (dashboard) => dashboard.id !== dashboardId || dashboard.profileId !== profileId
    )
  );
  const state = getDashboards(profileId);
  const selectedDashboardIds = normalizeSelectedDashboardIds(
    store.get('selectedDashboardIds', {})
  );

  if (selectedDashboardIds[profileId] === dashboardId) {
    if (state.selectedDashboardId) {
      store.set('selectedDashboardIds', {
        ...selectedDashboardIds,
        [profileId]: state.selectedDashboardId
      });
    } else {
      const remainingDashboardIds = Object.fromEntries(
        Object.entries(selectedDashboardIds).filter(([candidateProfileId]) => candidateProfileId !== profileId)
      );
      store.set('selectedDashboardIds', remainingDashboardIds);
    }
  }

  return state;
}

export function selectDashboard(profileId: string, dashboardId: string): DashboardState {
  const state = getDashboards(profileId);

  if (!state.dashboards.some((dashboard) => dashboard.id === dashboardId)) {
    throw new Error('The selected dashboard does not exist for this profile.');
  }

  store.set('selectedDashboardIds', {
    ...normalizeSelectedDashboardIds(store.get('selectedDashboardIds', {})),
    [profileId]: dashboardId
  });

  return {
    ...state,
    selectedDashboardId: dashboardId
  };
}

export function getDashboardActionAlerts(profileId: string): DashboardActionAlertState {
  const stored = normalizeDashboardActionAlerts(store.get('dashboardActionAlerts'));
  const alerts = stored.alerts
    .filter((alert) => alert.profileId === profileId)
    .sort((left, right) => right.detectedAt.localeCompare(left.detectedAt));

  return {
    profileId,
    alerts,
    unreadCount: alerts.filter((alert) => !alert.readAt).length
  };
}

export function recordDashboardActionRuns(
  input: GitHubActionsRunsInput,
  result: GitHubActionsRuns
): DashboardActionRunsRecordResult {
  const stored = normalizeDashboardActionAlerts(store.get('dashboardActionAlerts'));
  const sourceKey = dashboardActionSourceKey(input);
  const previousSource = stored.sources[sourceKey];
  const observedThisSession = observedDashboardActionSourcesThisSession.has(sourceKey);
  const existingAlertIds = new Set(stored.alerts.map((alert) => alert.id));
  const detectedAt = result.loadedAt;
  const newAlerts = previousSource
    ? result.runs.flatMap<DashboardActionFailureAlert>((run) => {
        const previousRun = previousSource.runs[String(run.id)];
        const newlyFailed =
          isFailedDashboardActionRun(run) &&
          ((previousRun && !previousRun.failed) ||
            (!previousRun && isAfter(run.updatedAt, previousSource.lastObservedAt)));
        const alertId = dashboardActionAlertId(input, run.id);

        if (!newlyFailed || existingAlertIds.has(alertId) || !run.conclusion) {
          return [];
        }

        existingAlertIds.add(alertId);
        return [
          {
            id: alertId,
            profileId: input.profileId,
            owner: input.owner,
            repository: input.repository,
            runId: run.id,
            runNumber: run.runNumber,
            workflowName: run.name,
            displayTitle: run.displayTitle,
            ...(run.branch ? { branch: run.branch } : {}),
            conclusion: run.conclusion,
            url: run.url,
            failedAt: run.updatedAt,
            detectedAt
          }
        ];
      })
    : [];
  const alerts = retainDashboardActionAlerts([...newAlerts, ...stored.alerts]);
  const sources = {
    ...stored.sources,
    [sourceKey]: {
      lastObservedAt: result.loadedAt,
      runs: Object.fromEntries(
        result.runs.map((run) => [
          String(run.id),
          {
            failed: isFailedDashboardActionRun(run),
            updatedAt: run.updatedAt
          }
        ])
      )
    }
  };

  store.set('dashboardActionAlerts', { alerts, sources });
  observedDashboardActionSourcesThisSession.add(sourceKey);

  return {
    state: getDashboardActionAlerts(input.profileId),
    newAlerts,
    notify: observedThisSession && newAlerts.length > 0
  };
}

export function markDashboardActionAlertsRead(
  profileId: string,
  alertIds: string[],
  readAt = new Date().toISOString()
): DashboardActionAlertState {
  const stored = normalizeDashboardActionAlerts(store.get('dashboardActionAlerts'));
  const requestedIds = new Set(alertIds);
  const markAll = requestedIds.size === 0;
  const alerts = stored.alerts.map((alert) =>
    alert.profileId === profileId &&
    !alert.readAt &&
    (markAll || requestedIds.has(alert.id))
      ? { ...alert, readAt }
      : alert
  );

  store.set('dashboardActionAlerts', {
    ...stored,
    alerts
  });

  return getDashboardActionAlerts(profileId);
}

export function flushPendingWorkspaceWrites(): void {
  if (pendingWorkspaceWrites.size === 0) {
    return;
  }

  for (const timer of pendingWorkspaceWriteTimers.values()) {
    clearTimeout(timer);
  }

  pendingWorkspaceWriteTimers.clear();
  const stored = normalizeStoredProfileWorkspaces(store.get('workspacesByProfile', {}));
  store.set('workspacesByProfile', {
    ...stored,
    ...Object.fromEntries(pendingWorkspaceWrites)
  });
  pendingWorkspaceWrites.clear();
}

function normalizeDashboards(value: unknown): Dashboard[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap<Dashboard>((dashboard) => {
    if (!dashboard || typeof dashboard !== 'object') {
      return [];
    }

    const candidate = dashboard as Partial<Dashboard>;

    if (
      typeof candidate.id !== 'string' ||
      typeof candidate.profileId !== 'string' ||
      typeof candidate.name !== 'string' ||
      typeof candidate.createdAt !== 'string' ||
      typeof candidate.updatedAt !== 'string' ||
      !Array.isArray(candidate.tiles)
    ) {
      return [];
    }

    const tiles = candidate.tiles.flatMap<DashboardTile>((tile) => {
      if (!tile || typeof tile !== 'object') {
        return [];
      }

      if (
        tile.kind === 'github-actions' &&
        typeof tile.id === 'string' &&
        typeof tile.owner === 'string' &&
        typeof tile.repository === 'string' &&
        typeof tile.limit === 'number' &&
        Number.isInteger(tile.limit) &&
        tile.limit >= 1 &&
        tile.limit <= 20
      ) {
        return [
          {
            id: tile.id,
            kind: tile.kind,
            owner: tile.owner,
            repository: tile.repository,
            limit: tile.limit,
            view: normalizeGitHubActionsTileView(
              (tile as { view?: unknown }).view
            ),
            filters: normalizeGitHubActionsRunFilters(
              (tile as { filters?: unknown }).filters
            )
          }
        ];
      }

      if (
        tile.kind === 'portainer-swarm-stack' &&
        typeof tile.id === 'string' &&
        typeof tile.connectionId === 'string' &&
        typeof tile.endpointId === 'number' &&
        Number.isInteger(tile.endpointId) &&
        tile.endpointId > 0 &&
        typeof tile.stackId === 'number' &&
        Number.isInteger(tile.stackId) &&
        tile.stackId > 0 &&
        typeof tile.stackName === 'string' &&
        typeof tile.environmentName === 'string'
      ) {
        return [
          {
            id: tile.id,
            kind: tile.kind,
            connectionId: tile.connectionId,
            endpointId: tile.endpointId,
            stackId: tile.stackId,
            stackName: tile.stackName,
            environmentName: tile.environmentName
          }
        ];
      }

      return [];
    });

    return [
      {
        id: candidate.id,
        profileId: candidate.profileId,
        name: candidate.name,
        tiles,
        createdAt: candidate.createdAt,
        updatedAt: candidate.updatedAt
      }
    ];
  });
}

function normalizeGitHubActionsRunFilters(value: unknown): GitHubActionsRunFilters {
  if (!value || typeof value !== 'object') {
    return {
      branches: [],
      includeTags: false,
      includeMyPullRequests: false
    };
  }

  const candidate = value as Partial<GitHubActionsRunFilters>;
  const branches = Array.isArray(candidate.branches)
    ? candidate.branches.flatMap((branch) => {
        if (typeof branch !== 'string') {
          return [];
        }

        const normalized = branch.trim();
        return normalized && normalized.length <= 255 ? [normalized] : [];
      })
    : [];

  return {
    branches: [...new Set(branches)].slice(0, 20),
    includeTags: candidate.includeTags === true,
    includeMyPullRequests: candidate.includeMyPullRequests === true
  };
}

function normalizeGitHubActionsTileView(value: unknown): GitHubActionsTileView {
  return value === 'pull-requests' ? 'pull-requests' : 'runs';
}

function normalizeDashboardActionAlerts(value: unknown): StoredDashboardActionAlerts {
  if (!isRecord(value)) {
    return {
      alerts: [],
      sources: {}
    };
  }

  const alerts = Array.isArray(value.alerts)
    ? value.alerts.flatMap<DashboardActionFailureAlert>((alert) => {
        if (!isRecord(alert)) {
          return [];
        }

        const conclusion = normalizeFailureConclusion(alert.conclusion);

        if (
          typeof alert.id !== 'string' ||
          typeof alert.profileId !== 'string' ||
          typeof alert.owner !== 'string' ||
          typeof alert.repository !== 'string' ||
          typeof alert.runId !== 'number' ||
          !Number.isInteger(alert.runId) ||
          typeof alert.runNumber !== 'number' ||
          !Number.isInteger(alert.runNumber) ||
          typeof alert.workflowName !== 'string' ||
          typeof alert.displayTitle !== 'string' ||
          typeof alert.url !== 'string' ||
          typeof alert.failedAt !== 'string' ||
          typeof alert.detectedAt !== 'string' ||
          !conclusion
        ) {
          return [];
        }

        return [
          {
            id: alert.id,
            profileId: alert.profileId,
            owner: alert.owner,
            repository: alert.repository,
            runId: alert.runId,
            runNumber: alert.runNumber,
            workflowName: alert.workflowName,
            displayTitle: alert.displayTitle,
            ...(typeof alert.branch === 'string' ? { branch: alert.branch } : {}),
            conclusion,
            url: alert.url,
            failedAt: alert.failedAt,
            detectedAt: alert.detectedAt,
            ...(typeof alert.readAt === 'string' ? { readAt: alert.readAt } : {})
          }
        ];
      })
    : [];
  const sources = isRecord(value.sources)
    ? Object.fromEntries(
        Object.entries(value.sources).flatMap(([sourceKey, source]) => {
          if (!isRecord(source) || typeof source.lastObservedAt !== 'string') {
            return [];
          }

          const runs = isRecord(source.runs)
            ? Object.fromEntries(
                Object.entries(source.runs).flatMap(([runId, run]) =>
                  isRecord(run) &&
                  typeof run.failed === 'boolean' &&
                  typeof run.updatedAt === 'string'
                    ? [[runId, { failed: run.failed, updatedAt: run.updatedAt }]]
                    : []
                )
              )
            : {};

          return [[sourceKey, { lastObservedAt: source.lastObservedAt, runs }]];
        })
      )
    : {};

  return {
    alerts: retainDashboardActionAlerts(alerts),
    sources
  };
}

function dashboardActionSourceKey(input: GitHubActionsRunsInput): string {
  return JSON.stringify([
    input.profileId,
    input.owner,
    input.repository,
    input.limit,
    input.view,
    [...input.filters.branches].sort(),
    input.filters.includeTags,
    input.filters.includeMyPullRequests
  ]);
}

function dashboardActionAlertId(input: GitHubActionsRunsInput, runId: number): string {
  return JSON.stringify([
    input.profileId,
    input.owner,
    input.repository,
    runId
  ]);
}

function isFailedDashboardActionRun(run: GitHubWorkflowRun): boolean {
  return run.status === 'completed' && Boolean(normalizeFailureConclusion(run.conclusion));
}

function normalizeFailureConclusion(
  value: unknown
): GitHubWorkflowRunConclusion | undefined {
  return value === 'failure' ||
    value === 'timed-out' ||
    value === 'action-required' ||
    value === 'stale' ||
    value === 'startup-failure'
    ? value
    : undefined;
}

function isAfter(candidate: string, baseline: string): boolean {
  const candidateTime = Date.parse(candidate);
  const baselineTime = Date.parse(baseline);

  return !Number.isNaN(candidateTime) &&
    !Number.isNaN(baselineTime) &&
    candidateTime > baselineTime;
}

function retainDashboardActionAlerts(
  alerts: DashboardActionFailureAlert[]
): DashboardActionFailureAlert[] {
  const sorted = [...alerts].sort((left, right) =>
    right.detectedAt.localeCompare(left.detectedAt)
  );
  const unread = sorted.filter((alert) => !alert.readAt);
  const read = sorted.filter((alert) => alert.readAt);

  return [...unread, ...read].slice(0, Math.max(DASHBOARD_ACTION_ALERT_LIMIT, unread.length));
}

function saveWorkspace(workspace: WorkspaceState, deferPersistence = false): WorkspaceState {
  const workspacesByProfile = getProfileWorkspaces();
  const activeProfileId = getActiveProfileId();
  const workspaceKey = profileWorkspaceKey(activeProfileId);
  const normalized = workspaceForProfile(normalizeWorkspaceState(workspace), activeProfileId);

  if (deferPersistence) {
    scheduleWorkspaceWrite(workspaceKey, normalized);
    return normalized;
  }

  cancelPendingWorkspaceWrite(workspaceKey);
  store.set('workspacesByProfile', {
    ...workspacesByProfile,
    [workspaceKey]: normalized
  });
  return normalized;
}

function getProfileWorkspaces(): Record<string, WorkspaceState> {
  const stored = normalizeStoredProfileWorkspaces(store.get('workspacesByProfile', {}));

  if (Object.keys(stored).length > 0) {
    return overlayPendingWorkspaceWrites(stored);
  }

  const profiles = listProfiles();
  const migrated = partitionWorkspaceByProfile(
    store.get('workspace', createDefaultWorkspaceState()),
    (repoPath, assignedProfileId) => resolveLegacyWorkspaceProfile(repoPath, assignedProfileId, profiles)
  );
  store.set('workspacesByProfile', migrated.workspacesByProfile);
  setActiveProfileId(migrated.activeProfileId);
  return overlayPendingWorkspaceWrites(migrated.workspacesByProfile);
}

function scheduleWorkspaceWrite(workspaceKey: string, workspace: WorkspaceState): void {
  pendingWorkspaceWrites.set(workspaceKey, workspace);
  const previousTimer = pendingWorkspaceWriteTimers.get(workspaceKey);

  if (previousTimer) {
    clearTimeout(previousTimer);
  }

  const timer = setTimeout(() => {
    pendingWorkspaceWriteTimers.delete(workspaceKey);
    const latestWorkspace = pendingWorkspaceWrites.get(workspaceKey);

    if (!latestWorkspace) {
      return;
    }

    pendingWorkspaceWrites.delete(workspaceKey);
    const stored = normalizeStoredProfileWorkspaces(store.get('workspacesByProfile', {}));
    store.set('workspacesByProfile', {
      ...stored,
      [workspaceKey]: latestWorkspace
    });
  }, SELECTION_PERSIST_DELAY_MS);
  timer.unref();
  pendingWorkspaceWriteTimers.set(workspaceKey, timer);
}

function cancelPendingWorkspaceWrite(workspaceKey: string): void {
  const timer = pendingWorkspaceWriteTimers.get(workspaceKey);

  if (timer) {
    clearTimeout(timer);
    pendingWorkspaceWriteTimers.delete(workspaceKey);
  }

  pendingWorkspaceWrites.delete(workspaceKey);
}

function overlayPendingWorkspaceWrites(
  workspacesByProfile: Record<string, WorkspaceState>
): Record<string, WorkspaceState> {
  if (pendingWorkspaceWrites.size === 0) {
    return workspacesByProfile;
  }

  return {
    ...workspacesByProfile,
    ...Object.fromEntries(pendingWorkspaceWrites)
  };
}

function normalizeStoredProfileWorkspaces(value: unknown): Record<string, WorkspaceState> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, workspace]) => [key, normalizeWorkspaceState(workspace)])
  );
}

function resolveLegacyWorkspaceProfile(
  repoPath: string,
  assignedProfileId: string | undefined,
  profiles: GitProfile[]
): string | undefined {
  const matchingProfile = profiles.find((profile) =>
    profile.remoteUrlPatterns?.some((pattern) => repoPath.includes(pattern))
  );
  return matchingProfile?.id ?? assignedProfileId;
}

function workspaceForProfile(workspace: WorkspaceState, activeProfileId: string | undefined): WorkspaceState {
  return {
    ...workspace,
    activeProfileId,
    tabs: workspace.tabs.map((tab) => ({
      ...tab,
      assignedProfileId: activeProfileId
    }))
  };
}

function getActiveProfileId(): string | undefined {
  const value: unknown = store.get('activeProfileId');
  return typeof value === 'string' && value ? value : undefined;
}

function setActiveProfileId(profileId: string | undefined): void {
  if (profileId) {
    store.set('activeProfileId', profileId);
    return;
  }

  store.delete('activeProfileId');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSelectedDashboardIds(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0
    )
  );
}

function testStoreDirectory(name: string): { cwd: string } | Record<string, never> {
  if (process.env.NODE_ENV !== 'test') {
    return {};
  }

  return {
    cwd: join(tmpdir(), 'git-gud-vitest-store', name)
  };
}
