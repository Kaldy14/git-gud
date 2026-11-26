import type { ReactElement } from 'react';
import { ChevronRight } from 'lucide-react';

import type { PullRequestTour } from '@shared/pullRequestTour';
import { PullRequestRiskChip } from '../PullRequestRiskChip';
import { InlineCodeText, OverviewSection } from './overviewParts';

/**
 * The tour's behaviour steps (mechanical ones are left to the Tour); a row opens the Tour there. A tour
 * written before the latest push still lists them, with the risk chips muted like the Risk section's.
 */
export function OverviewBehaviorSection({ tour, isCurrent, onOpenTourStep }: {
  tour: PullRequestTour;
  isCurrent: boolean;
  onOpenTourStep: (index: number) => void;
}): ReactElement {
  const steps = tour.stops.flatMap((stop, index) => stop.kind === 'behavior' ? [{ stop, index }] : []);
  return (
    <OverviewSection id="pr-overview-behavior" title="Behavior changes" verdict={<span className="pr-overview-heading-count">{steps.length}</span>}>
      <div className="pr-overview-card pr-overview-behavior">
        {steps.length === 0 ? (
          <p className="pr-overview-empty">No behaviour changes: every step of the tour is mechanical.</p>
        ) : (
          <ul className="pr-overview-rows">
            {steps.map(({ stop, index }) => (
              <li key={index}>
                <button type="button" className="pr-overview-row-button" onClick={() => onOpenTourStep(index)} aria-label={`Step ${index + 1}: ${stop.title.replaceAll('`', '')}. Open in Tour`}>
                  <span className="pr-overview-behavior-risk">{stop.risk ? <PullRequestRiskChip risk={stop.risk} muted={!isCurrent} title={isCurrent ? undefined : 'Assessed before the latest push'} /> : null}</span>
                  <span className="pr-overview-behavior-title"><InlineCodeText text={stop.title} /></span>
                  <ChevronRight size={14} aria-hidden="true" className="pr-overview-chevron" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </OverviewSection>
  );
}
