import { Bug } from 'lucide-react';
import { Tooltip } from 'radix-ui';
import { useBugFinder } from './useBugFinder';
import type { GitHubPullRequestLocator } from '@shared/types';

export function BugFinderButton({
  pullRequest,
  onOpen,
  inReview = false,
  active = false
}: {
  pullRequest: GitHubPullRequestLocator & { headSha?: string };
  onOpen: () => void;
  inReview?: boolean;
  active?: boolean;
}) {
  const { state, query, mutation } = useBugFinder(pullRequest);
  const status =
    mutation.isPending || state?.status === 'running'
      ? 'running'
      : mutation.isError || query.isError || state?.status === 'failed'
        ? 'failed'
        : !state
          ? 'loading'
          : state.headSha &&
              pullRequest.headSha &&
              state.headSha !== pullRequest.headSha
            ? 'stale'
            : state.status;
  const count =
    state?.findings.filter(
      (f) =>
        f.status === 'open' && !f.publication && f.headSha === state.headSha
    ).length ?? 0;
  const label =
    status === 'ready'
      ? `Bug finder ready. ${count} findings. Open bug finder`
      : status === 'running'
        ? 'Bug finder scanning in the background'
        : status === 'loading'
          ? 'Checking bug finder status'
          : status === 'stale'
            ? 'Bug finder is outdated. Run an update'
            : status === 'failed'
              ? `${mutation.error?.message ?? query.error?.message ?? state?.error ?? 'Bug scan failed'}. Click to retry`
              : 'No bug scan yet. Run in the background';
  return (
    <Tooltip.Provider delayDuration={350}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            className={`pr-row-guide pr-bug-finder-button${inReview ? ' pr-bug-finder-button-labelled' : ''}`}
            data-status={status}
            aria-label={inReview ? 'Bug finder' : label}
            aria-pressed={inReview ? active : undefined}
            aria-busy={status === 'running'}
            onClick={(event) => {
              event.stopPropagation();
              if (inReview || status === 'ready') onOpen();
              else if (status !== 'running' && status !== 'loading') {
                if (query.isError) void query.refetch();
                else mutation.mutate({ action: 'start' });
              }
            }}
          >
            <Bug size={14} aria-hidden="true" />
            {inReview ? <span>Bug finder</span> : null}
            <span className="pr-row-guide-dot" aria-hidden="true" />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="pr-row-guide-tooltip"
            side="top"
            sideOffset={8}
          >
            {label}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
