import type { ReactElement } from 'react';

import type { GitHubPullRequestSummary } from '@shared/types';

export function PullRequestLineStats({
  additions,
  deletions
}: Pick<GitHubPullRequestSummary, 'additions' | 'deletions'>): ReactElement {
  const added = additions.toLocaleString();
  const deleted = deletions.toLocaleString();
  const label = `${added} lines added, ${deleted} lines deleted`;

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-mono text-[11px] tabular-nums"
      role="img"
      aria-label={label}
      title={label}
    >
      <span className="text-[var(--success-text)]" aria-hidden="true">+{added}</span>
      <span className="text-[var(--danger-text)]" aria-hidden="true">−{deleted}</span>
    </span>
  );
}
