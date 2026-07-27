import type { GitProfile } from './types';

export const GLOBAL_DASHBOARD_PROFILE_ID = 'dashboard:global';

export function dashboardProfileId(
  profile: Pick<GitProfile, 'id'> | undefined
): string {
  return profile?.id ?? GLOBAL_DASHBOARD_PROFILE_ID;
}
