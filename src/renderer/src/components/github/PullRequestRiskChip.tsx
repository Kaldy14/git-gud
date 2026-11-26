import type { ReactElement } from 'react';

import type { PullRequestTourRisk } from '@shared/pullRequestTour';

const LABELS = { low: 'Low risk', medium: 'Med risk', high: 'High risk' } as const;
const SPOKEN = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' } as const;
const BARS = { low: 1, medium: 2, high: 3 } as const;

/**
 * The tour's risk for a pull request or a step: signal bars plus a short label. Tones: low muted,
 * medium warning, high danger. `muted` drops the tone when the tour was written before the latest push.
 */
export function PullRequestRiskChip({ risk, muted = false, title }: {
  risk: PullRequestTourRisk;
  muted?: boolean;
  title?: string;
}): ReactElement {
  return (
    <span className="pr-risk-chip" data-risk={risk} data-muted={muted || undefined} title={title}>
      <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
        {[0, 1, 2].map((bar) => (
          <rect key={bar} x={1 + bar * 4} y={8 - bar * 3} width="2.4" height={3 + bar * 3} rx="0.6" data-on={bar < BARS[risk] || undefined} />
        ))}
      </svg>
      <span aria-hidden="true">{LABELS[risk]}</span>
      <span className="sr-only">{SPOKEN[risk]}</span>
    </span>
  );
}
