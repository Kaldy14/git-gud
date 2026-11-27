import type { ReactElement, ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import type { PullRequestTourStop } from '@shared/pullRequestTour';

import { plainTourText } from './tourText';

const RISK_LABELS = { medium: 'medium risk', high: 'high risk' } as const;

/**
 * The Tour's progress strip: "Step N of M", one segment per step (current teal and taller, reviewed dimmed
 * teal, ahead slate; mechanical steps quieter) and previous / next. A segment's width follows the step's
 * changed lines, an amber or red underline marks medium or high risk, and a copper mark a step with a
 * call to make. Every segment is a button named by its step and those facts.
 */
export function TourProgress({ stops, step, reviewed, weights, lead, onGo }: {
  stops: readonly Pick<PullRequestTourStop, 'title' | 'kind' | 'risk' | 'attention'>[];
  step: number;
  reviewed: readonly number[];
  // Flex weight per step (`tourSegmentWeight`).
  weights: readonly number[];
  // Before the step count, such as the step map's toggle.
  lead?: ReactNode;
  onGo: (step: number) => void;
}): ReactElement {
  const count = stops.length;
  return (
    <nav className="pr-tour-progress" aria-label="Tour steps">
      {lead}
      <span className="pr-tour-progress-text">Step {step + 1} of {count}</span>
      <ol className="pr-tour-progress-segments">
        {stops.map((stop, index) => {
          const isReviewed = reviewed.includes(index);
          const facts = [
            stop.risk === 'medium' || stop.risk === 'high' ? RISK_LABELS[stop.risk] : '',
            stop.attention ? 'a call to make' : '',
            isReviewed ? 'reviewed' : ''
          ].filter(Boolean);
          const title = `Step ${index + 1}: ${plainTourText(stop.title)}${facts.length ? ` (${facts.join(', ')})` : ''}`;
          return (
            <li key={index} style={{ flexGrow: weights[index] ?? 1 }}>
              <button
                type="button"
                className="pr-tour-segment"
                data-current={index === step || undefined}
                data-reviewed={isReviewed || undefined}
                data-kind={stop.kind}
                data-risk={stop.risk === 'medium' || stop.risk === 'high' ? stop.risk : undefined}
                data-attention={stop.attention ? '' : undefined}
                aria-current={index === step ? 'step' : undefined}
                aria-label={title}
                title={title}
                onClick={() => onGo(index)}
              >
                <i aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>
      <span className="pr-tour-progress-nav">
        <button type="button" className="icon-btn icon-btn-compact" aria-label="Previous step" title="Previous step (←)"
          aria-keyshortcuts="ArrowLeft" aria-disabled={step === 0 || undefined} onClick={() => { if (step > 0) onGo(step - 1); }}>
          <ChevronLeft size={14} aria-hidden="true" />
        </button>
        <button type="button" className="icon-btn icon-btn-compact" aria-label="Next step" title="Next step (→)"
          aria-keyshortcuts="ArrowRight" aria-disabled={step === count - 1 || undefined} onClick={() => { if (step < count - 1) onGo(step + 1); }}>
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </span>
    </nav>
  );
}
