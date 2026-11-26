import type { ReactElement } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import type { PullRequestTourStop } from '@shared/pullRequestTour';

import { plainTourText } from './tourText';

/**
 * The Tour's progress strip: "Step N of M", one segment per step (current teal and taller, reviewed dimmed
 * teal, ahead slate; mechanical steps quieter) and previous / next. Every segment is a button named by its step.
 */
export function TourProgress({ stops, step, reviewed, onGo }: {
  stops: readonly Pick<PullRequestTourStop, 'title' | 'kind'>[];
  step: number;
  reviewed: readonly number[];
  onGo: (step: number) => void;
}): ReactElement {
  const count = stops.length;
  return (
    <nav className="pr-tour-progress" aria-label="Tour steps">
      <span className="pr-tour-progress-text">Step {step + 1} of {count}</span>
      <ol className="pr-tour-progress-segments">
        {stops.map((stop, index) => {
          const isReviewed = reviewed.includes(index);
          const title = `Step ${index + 1}: ${plainTourText(stop.title)}${isReviewed ? ' (reviewed)' : ''}`;
          return (
            <li key={index}>
              <button
                type="button"
                className="pr-tour-segment"
                data-current={index === step || undefined}
                data-reviewed={isReviewed || undefined}
                data-kind={stop.kind}
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
