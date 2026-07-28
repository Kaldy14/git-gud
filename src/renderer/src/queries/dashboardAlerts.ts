import { useEffect, useMemo } from 'react';
import { useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import {
  gitHubActionsRunsQueryKey,
  gitHubActionsRunsQueryOptions
} from '@renderer/queries/github';
import type {
  Dashboard,
  DashboardActionAlertState,
  GitHubActionsRunsInput
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

export function useDashboardActionsMonitor(
  profileId: string | undefined,
  dashboards: Dashboard[]
): void {
  const queryClient = useQueryClient();
  const inputs = useMemo(
    () => dashboardActionMonitoringInputs(profileId, dashboards),
    [dashboards, profileId]
  );
  const queries = useQueries({
    queries: inputs.map((input) => gitHubActionsRunsQueryOptions(input))
  });
  const loadedSignature = queries
    .map((query) => query.data?.loadedAt ?? '')
    .join('\n');
  const hasLoadedData = queries.some((query) => Boolean(query.data));

  useEffect(() => {
    if (!profileId || !hasLoadedData) {
      return;
    }

    void queryClient.invalidateQueries({
      queryKey: dashboardActionAlertsQueryKey(profileId)
    });
  }, [hasLoadedData, loadedSignature, profileId, queryClient]);
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
