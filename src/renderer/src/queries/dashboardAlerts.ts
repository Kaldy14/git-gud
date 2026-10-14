import { useEffect, useMemo } from 'react';
import { useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import {
  gitHubActionsRunsQueryKey,
  gitHubActionsRunsQueryOptions,
  gitHubActionsRunsRefetchInterval
} from '@renderer/queries/github';
import type {
  Dashboard,
  DashboardActionAlertState,
  GitHubActionsRuns,
  GitHubActionsRunsInput,
  GitHubWorkflowRun
} from '@shared/types';

export const dashboardActionAlertsQueryKey = (
  profileId: string
): readonly ['dashboard-action-alerts', string] => [
  'dashboard-action-alerts',
  profileId
];

export function useDashboardActionAlerts(profileId: string | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: profileId
      ? dashboardActionAlertsQueryKey(profileId)
      : ['dashboard-action-alerts', 'none'],
    queryFn: async (): Promise<DashboardActionAlertState> => {
      if (!profileId) {
        throw new Error('A dashboard profile scope is required.');
      }

      return window.api.getDashboardActionAlerts(profileId);
    },
    enabled: Boolean(profileId),
    staleTime: Number.POSITIVE_INFINITY
  });

  useEffect(
    () =>
      window.api.onDashboardActionAlertsChanged((state) => {
        queryClient.setQueryData(
          dashboardActionAlertsQueryKey(state.profileId),
          state
        );
      }),
    [queryClient]
  );

  return query;
}

/**
 * Polls every saved GitHub Actions tile and returns how many distinct workflow
 * runs are currently running across them.
 */
export function useDashboardActionsMonitor(
  profileId: string | undefined,
  dashboards: Dashboard[],
  isDashboardVisible: boolean
): number {
  const inputs = useMemo(
    () => dashboardActionMonitoringInputs(profileId, dashboards),
    [dashboards, profileId]
  );
  return useQueries({
    queries: inputs.map((input) => {
      const options = gitHubActionsRunsQueryOptions(
        input,
        isDashboardVisible ? 'interactive' : 'background-monitor'
      );
      if (isDashboardVisible) {
        return options;
      }

      // While a run is in progress, poll at the tile's interactive cadence so the
      // running badge clears soon after the run finishes.
      const activeRefetchInterval = gitHubActionsRunsRefetchInterval(input.filters);
      return {
        ...options,
        refetchInterval: (query: { state: { data?: GitHubActionsRuns } }) =>
          query.state.data?.runs.some(isWorkflowRunRunning)
            ? activeRefetchInterval
            : options.refetchInterval
      };
    }),
    combine: (results) =>
      countRunningDashboardWorkflowRuns(results.map((result) => result.data))
  });
}

export function isWorkflowRunRunning(run: Pick<GitHubWorkflowRun, 'status'>): boolean {
  return run.status === 'in-progress';
}

export function countRunningDashboardWorkflowRuns(
  results: ReadonlyArray<GitHubActionsRuns | undefined>
): number {
  const runningRunKeys = new Set<string>();

  for (const result of results) {
    if (!result) {
      continue;
    }

    for (const run of result.runs) {
      if (isWorkflowRunRunning(run)) {
        runningRunKeys.add(
          `${result.owner}/${result.repository}#${run.id}`.toLowerCase()
        );
      }
    }
  }

  return runningRunKeys.size;
}

export async function markDashboardActionAlertsRead(
  queryClient: QueryClient,
  profileId: string,
  alertIds: string[]
): Promise<DashboardActionAlertState> {
  const state = await window.api.markDashboardActionAlertsRead(
    profileId,
    alertIds
  );
  queryClient.setQueryData(dashboardActionAlertsQueryKey(profileId), state);
  return state;
}

export function dashboardActionMonitoringInputs(
  profileId: string | undefined,
  dashboards: Dashboard[]
): GitHubActionsRunsInput[] {
  if (!profileId) {
    return [];
  }

  const inputs = new Map<string, GitHubActionsRunsInput>();

  for (const dashboard of dashboards) {
    for (const tile of dashboard.tiles) {
      if (tile.kind !== 'github-actions') {
        continue;
      }

      const input: GitHubActionsRunsInput = {
        profileId,
        owner: tile.owner,
        repository: tile.repository,
        limit: tile.limit,
        view: tile.view,
        filters: tile.filters
      };
      inputs.set(JSON.stringify(gitHubActionsRunsQueryKey(input)), input);
    }
  }

  return [...inputs.values()];
}
