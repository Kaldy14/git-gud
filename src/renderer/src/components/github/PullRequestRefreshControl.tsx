import { useEffect, useState, type ReactElement } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAnnounceOnChange } from '../../lib/announce';

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
  // What the control says never changes for a background poll: a poll is silent in every state.
  const state = errorMessage ? 'error' : hasNewActivity ? 'activity' : 'live';
  // Only a refresh the user asked for spins the button, and the dot sends one ring when that refresh
  // succeeds or when new activity arrives.
  const [manual, setManual] = useState(false);
  const [ping, setPing] = useState(0);
  const [pinging, setPinging] = useState(false);
  const [previous, setPrevious] = useState({ isRefreshing, hasNewActivity });
  if (previous.isRefreshing !== isRefreshing || previous.hasNewActivity !== hasNewActivity) {
    setPrevious({ isRefreshing, hasNewActivity });
    const finishedManual = previous.isRefreshing && !isRefreshing && manual;
    if (finishedManual) setManual(false);
    if ((finishedManual && !errorMessage) || (hasNewActivity && !previous.hasNewActivity)) {
      setPing(ping + 1);
      setPinging(true);
    }
  }
  // The ring is spent after its 360ms whether or not it was seen (reduced motion, or a label hidden beside
  // the docked list), so it can never play late.
  useEffect(() => {
    if (!pinging) return;
    const timer = window.setTimeout(() => setPinging(false), 400);
    return () => window.clearTimeout(timer);
  }, [pinging, ping]);
  // A click whose refresh never starts (offline, already fresh) must not arm the next poll.
  useEffect(() => {
    if (!manual || isRefreshing) return;
    const timer = window.setTimeout(() => setManual(false), 500);
    return () => window.clearTimeout(timer);
  }, [manual, isRefreshing]);
  const stateLabel = errorMessage ? 'Update failed' : hasNewActivity ? 'New activity' : 'Live';
  useAnnounceOnChange(state, errorMessage ? `Pull request update failed. ${errorMessage}` : hasNewActivity ? 'New pull request activity' : undefined);
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
        <i key={ping} data-pinged={pinging || undefined} aria-hidden="true" />
        {stateLabel}
      </span>
      <time dateTime={lastRefreshedAt} title={title}>
        {checkedLabel}
      </time>
      <button
        className={compact ? 'icon-btn icon-btn-regular shrink-0' : 'btn-subtle h-8 shrink-0 text-xs'}
        type="button"
        // aria-disabled keeps focus on the button while it is busy.
        onClick={() => {
          // Always ask on the first click: a poll already running may cover only part of what this button
          // refreshes. While that refresh runs the button is busy and a repeat click does nothing.
          if (isRefreshing && manual) return;
          setManual(true);
          onRefresh();
        }}
        aria-disabled={(isRefreshing && manual) || undefined}
        aria-label={isRefreshing && manual ? 'Refreshing pull requests' : 'Refresh pull requests now'}
        title={isRefreshing && manual ? 'Refreshing pull requests' : 'Refresh now'}
      >
        <span className={isRefreshing && manual ? 'pr-refresh-spin' : undefined} aria-hidden="true">
          <RefreshCw size={compact ? 16 : 14} />
        </span>
        {compact ? null : isRefreshing && manual ? 'Refreshing' : 'Refresh'}
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
