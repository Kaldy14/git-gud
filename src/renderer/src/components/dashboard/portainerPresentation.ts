import type {
  PortainerImageFreshness,
  PortainerServiceHealth,
  PortainerStackHealth
} from '@shared/types';

export type PortainerStatusTone = 'success' | 'running' | 'danger' | 'neutral';

export function portainerStackHealthPresentation(
  health: PortainerStackHealth
): { label: string; tone: PortainerStatusTone } {
  switch (health) {
    case 'healthy':
      return { label: 'Healthy', tone: 'success' };
    case 'updating':
      return { label: 'Updating', tone: 'running' };
    case 'degraded':
      return { label: 'Degraded', tone: 'danger' };
    case 'stopped':
      return { label: 'Stopped', tone: 'neutral' };
    case 'unavailable':
      return { label: 'Unavailable', tone: 'danger' };
  }
}

export function portainerServiceHealthPresentation(
  health: PortainerServiceHealth
): { label: string; tone: PortainerStatusTone } {
  switch (health) {
    case 'healthy':
      return { label: 'Healthy', tone: 'success' };
    case 'updating':
      return { label: 'Updating', tone: 'running' };
    case 'degraded':
      return { label: 'Degraded', tone: 'danger' };
    case 'stopped':
      return { label: 'Stopped', tone: 'neutral' };
  }
}

export function portainerImagePresentation(
  freshness: PortainerImageFreshness
): { label: string; tone: PortainerStatusTone } {
  switch (freshness) {
    case 'up-to-date':
      return { label: 'Up to date', tone: 'success' };
    case 'update-available':
      return { label: 'Update available', tone: 'running' };
    case 'checking':
      return { label: 'Checking image', tone: 'neutral' };
    case 'unknown':
      return { label: 'Image unknown', tone: 'neutral' };
  }
}

export function portainerImageSummary(
  freshness: PortainerImageFreshness[],
  state: { loading: boolean; error: boolean }
): {
  value: string;
  detail?: string;
  tone: PortainerStatusTone;
} {
  if (state.error) {
    return { value: 'Unknown', detail: 'unavailable', tone: 'neutral' };
  }

  if (state.loading) {
    return { value: 'Checking', tone: 'neutral' };
  }

  const updateCount = freshness.filter(
    (status) => status === 'update-available'
  ).length;

  if (updateCount > 0) {
    return {
      value: `${updateCount} update${updateCount === 1 ? '' : 's'}`,
      tone: 'running'
    };
  }

  if (freshness.length > 0 && freshness.every((status) => status === 'up-to-date')) {
    return { value: 'Current', tone: 'success' };
  }

  if (freshness.some((status) => status === 'checking')) {
    return { value: 'Checking', tone: 'neutral' };
  }

  return { value: 'Unknown', detail: 'not reported', tone: 'neutral' };
}

export function formatRunningAge(
  runningSince: string | undefined,
  now = Date.now()
): string {
  if (!runningSince) {
    return 'not running';
  }

  const elapsedMs = now - new Date(runningSince).getTime();

  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    return 'just started';
  }

  const minutes = Math.floor(elapsedMs / 60_000);

  if (minutes < 1) {
    return 'just started';
  }

  if (minutes < 60) {
    return `running ${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `running ${hours}h`;
  }

  return `running ${Math.floor(hours / 24)}d`;
}
