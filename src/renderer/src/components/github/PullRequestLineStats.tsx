import type { ReactElement } from 'react';
import { Tooltip } from 'radix-ui';

import type { LineBreakdownRow } from '@shared/lineBreakdown';
import type { GitHubPullRequestSummary } from '@shared/types';

type LineTotals = Pick<GitHubPullRequestSummary, 'additions' | 'deletions'>;

function lineLabel({ additions, deletions }: LineTotals): string {
  return `${additions.toLocaleString()} lines added, ${deletions.toLocaleString()} lines deleted`;
}

function Counts({ additions, deletions }: LineTotals): ReactElement {
  return (
    <>
      <span className="text-[var(--success-text)]" aria-hidden="true">+{additions.toLocaleString()}</span>
      <span className="text-[var(--danger-text)]" aria-hidden="true">−{deletions.toLocaleString()}</span>
    </>
  );
}

/** Total line counts. With a breakdown, hovering or focusing them shows lines per kind. */
export function PullRequestLineStats({
  additions,
  deletions,
  breakdown
}: LineTotals & { breakdown?: LineBreakdownRow[] }): ReactElement {
  const label = lineLabel({ additions, deletions });
  const className = 'pr-line-stats inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-mono text-[11px] tabular-nums';

  if (!breakdown?.length) {
    return (
      <span className={className} role="img" aria-label={label} title={label}>
        <Counts additions={additions} deletions={deletions} />
      </span>
    );
  }

  return (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button type="button" className={`${className} pr-line-stats-trigger`} aria-label={`${label}. Show breakdown by kind`}>
            <Counts additions={additions} deletions={deletions} />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content className="pr-line-breakdown" side="bottom" align="end" sideOffset={6} collisionPadding={12}>
            <PullRequestLineBreakdownTable rows={breakdown} additions={additions} deletions={deletions} />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

function PullRequestLineBreakdownTable({ rows, additions, deletions }: LineTotals & { rows: LineBreakdownRow[] }): ReactElement {
  return (
    <table>
      <tbody>
        {rows.map((row) => (
          <tr key={row.kind} title={row.kind === 'unlisted' ? 'Files beyond the first 100 GitHub lists for this view' : undefined}>
            <th scope="row">{row.label}</th>
            <td className="pr-line-breakdown-files">{row.files.toLocaleString()} {row.files === 1 ? 'file' : 'files'}</td>
            <td className="text-[var(--success-text)]">+{row.additions.toLocaleString()}</td>
            <td className="text-[var(--danger-text)]">−{row.deletions.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
      {rows.length > 1 ? (
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td className="pr-line-breakdown-files" />
            <td className="text-[var(--success-text)]">+{additions.toLocaleString()}</td>
            <td className="text-[var(--danger-text)]">−{deletions.toLocaleString()}</td>
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}
