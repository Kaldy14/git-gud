import { Bug } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { Tooltip } from 'radix-ui';
import { useBugFinder } from './useBugFinder';
import type { GitHubPullRequestLocator } from '@shared/types';

export function BugFinderButton({
  pullRequest,
  onOpen,
  inReview = false,
  iconOnly = false,
  active = false
}: {
  pullRequest: GitHubPullRequestLocator & { headSha?: string };
  onOpen: () => void;
  inReview?: boolean;
  iconOnly?: boolean;
  active?: boolean;
}) {
  const { state, query, mutation } = useBugFinder(pullRequest);
  const activation = useMutation({
    // Resolves to true when the view should open: a finished report or a failure to explain.
    // Starting a scan stays in the background; the view only opens once there is something to show.
    mutationFn: async () => {
      // Recheck before starting so a transient read failure does not rerun a completed scan.
      let current = state;
      if (query.isError) {
        const result = await query.refetch();
        if (result.isError) throw result.error;
        current = result.data?.state;
      }
      if (current?.status === 'running') return false;
      if (current?.status === 'failed') return true;
      if (current?.status === 'ready' &&
        !(current.headSha && pullRequest.headSha && current.headSha !== pullRequest.headSha)) return true;
      await mutation.mutateAsync({ action: 'start' });
      return false;
    }
  });
  const status =
    activation.isPending || state?.status === 'running'
      ? 'running'
      : activation.isError || query.isError || state?.status === 'failed'
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
        ? 'Bug finder scanning in the background. The report opens from here when ready'
        : status === 'loading'
          ? 'Checking bug finder status'
          : status === 'stale'
            ? 'Bug finder is outdated. Run an update'
            : status === 'failed'
              ? state?.status === 'failed' ? 'Bug scan failed. Open bug finder to see why and retry' : `${activation.error?.message ?? query.error?.message ?? 'Bug scan failed'}. Click to retry`
              : 'No bug scan yet. Run in the background';
  return (
    <Tooltip.Provider delayDuration={350}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            className={`pr-row-guide pr-bug-finder-button${inReview && !iconOnly ? ' pr-bug-finder-button-labelled' : ''}${iconOnly ? ' review-sidebar-tool' : ''}`}
            data-status={status}
            aria-label={inReview ? 'Bug finder' : label}
            aria-pressed={inReview ? active : undefined}
            aria-busy={status === 'running'}
            onClick={(event) => {
              event.stopPropagation();
              if (activation.isPending || status === 'loading' || status === 'running') return;
              activation.mutate(undefined, { onSuccess: (open) => { if (open) onOpen(); } });
            }}
          >
            <Bug size={14} aria-hidden="true" />
            {inReview && !iconOnly ? <span>Bug finder</span> : null}
            <span className="pr-row-guide-dot" aria-hidden="true" />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="pr-row-guide-tooltip"
            side={iconOnly ? 'bottom' : 'top'}
            sideOffset={8}
          >
            {inReview ? <><strong>Bug finder</strong><br />Generate an AI bug report, or open the existing scan and its findings.<br /></> : null}
            {label}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
