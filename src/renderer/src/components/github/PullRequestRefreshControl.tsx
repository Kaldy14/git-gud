import type { ReactElement } from 'react';
import { RefreshCw } from 'lucide-react';

type PullRequestRefreshControlProps = {
  lastRefreshedAt?: string;
  isRefreshing: boolean;
  hasNewActivity?: boolean;
  errorMessage?: string;
  compact?: boolean;
  onRefresh: () => void;
};

export function PullRequestRefreshControl({
  lastRefreshedAt,
  isRefreshing,
  hasNewActivity = false,
  errorMessage,
  compact = false,
  onRefresh
}: PullRequestRefreshControlProps): ReactElement {
  const state = isRefreshing
    ? 'refreshing'
    : errorMessage
      ? 'error'
      : hasNewActivity
        ? 'activity'
        : 'live';
  const stateLabel = errorMessage ? 'Update failed' : hasNewActivity ? 'New activity' : 'Live';
  const checkedLabel = lastRefreshedAt
    ? `Checked ${formatRefreshTime(lastRefreshedAt)}`
    : 'Waiting for first update';
  const title = errorMessage
    ? `${errorMessage} · Auto-refresh will retry`
    : lastRefreshedAt
      ? `Auto-refresh is on · Last checked ${formatExactTime(lastRefreshedAt)}`
      : 'Auto-refresh is on';

  return (
    <div className="pr-refresh-control" data-compact={compact} data-state={state}>
      <span className="pr-refresh-live" title={title}>
        <i aria-hidden="true" />
        {stateLabel}
      </span>
      <time dateTime={lastRefreshedAt} title={title}>
        {checkedLabel}
      </time>
      <button
        className={compact ? 'icon-btn icon-btn-regular shrink-0' : 'btn-subtle h-8 shrink-0 text-xs'}
        type="button"
        onClick={onRefresh}
        disabled={isRefreshing}
        aria-label={isRefreshing ? 'Refreshing pull requests' : 'Refresh pull requests now'}
        title={isRefreshing ? 'Refreshing pull requests' : 'Refresh now'}
      >
        <span className={isRefreshing ? 'animate-spin' : undefined} aria-hidden="true">
          <RefreshCw size={13} />
        </span>
        {compact ? null : isRefreshing ? 'Refreshing' : 'Refresh'}
      </button>
    </div>
  );
}

function formatRefreshTime(value: string): string {
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1_000));

  if (elapsedSeconds < 60) {
    return 'just now';
  }

  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  return `${elapsedMinutes}m ago`;
}

function formatExactTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(value));
}
