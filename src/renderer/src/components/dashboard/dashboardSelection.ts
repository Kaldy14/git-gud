import type { Dashboard } from '@shared/types';

export function resolveActiveDashboard(
  dashboards: Dashboard[],
  requestedDashboardId: string | undefined,
  persistedDashboardId: string | undefined
): Dashboard | undefined {
  return (
    dashboards.find((dashboard) => dashboard.id === requestedDashboardId) ??
    dashboards.find((dashboard) => dashboard.id === persistedDashboardId) ??
    dashboards[0]
  );
}
