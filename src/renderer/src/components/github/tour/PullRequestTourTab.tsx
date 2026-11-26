import { useState, type ReactElement } from 'react';
import { CircleDotDashed, Loader2, Route, TriangleAlert } from 'lucide-react';

import { useAnnounceOnChange } from '@renderer/lib/announce';
import { BackgroundJobConfirm } from '../BackgroundJobConfirm';
import type { PullRequestTourQueryState } from './pullRequestTourQuery';

/**
 * The Tour tab while there is no usable tour: none yet, writing, failed, or stored in an older format.
 * A usable tour is walked on the shared diff surface instead (`useTourDiffSurface`).
 */
export function PullRequestTourTab({ tour: tourState }: { tour: PullRequestTourQueryState }): ReactElement {
  const { tour, running, failure, outdatedFormat, isLoading } = tourState;
  const phase = running ? 'running' : failure ? 'failed' : tour ? `ready:${tour.generatedAt}` : 'empty';
  useAnnounceOnChange(phase, running ? 'Writing the tour' : failure ? `The tour could not be written. ${failure}` : tour ? 'Tour ready' : undefined);

  if (isLoading) {
    return <div className="pr-tour-empty"><Loader2 size={16} className="animate-spin" aria-label="Loading tour" /></div>;
  }
  // A stored tour with no steps has nothing to walk; offer to write it again.
  const empty = tour !== null && tour.stops.length === 0;
  return (
    <div className="pr-tour-empty">
      <span className="pr-tour-empty-icon" data-tone={running ? 'pending' : failure ? 'danger' : undefined} aria-hidden="true">
        {running ? <CircleDotDashed size={20} /> : failure ? <TriangleAlert size={20} /> : <Route size={20} />}
      </span>
      <p className="pr-tour-empty-title">
        {running ? 'Writing a tour' : failure ? 'Could not write a tour' : outdatedFormat ? 'Written in an older format' : empty ? 'This tour has no steps' : 'No tour yet'}
      </p>
      <p className="pr-tour-empty-body">
        {running
          ? 'Reading the change. A large one takes a few minutes; you can keep reviewing in the other tabs.'
          : outdatedFormat
            ? 'This pull request has a tour from an earlier version of Git Gud, which this version no longer shows. Write it again to read it here.'
            : 'A tour walks through the change step by step: what each part now does, where its effect stops, and the calls only a maintainer can make.'}
      </p>
      <WriteTourButton tour={tourState} label={failure ? 'Try again' : outdatedFormat || empty ? 'Write it again' : 'Write tour'} />
      {failure && !running ? <FailureDetails detail={failure} /> : null}
    </div>
  );
}

/** AI never starts from one click: the button opens a confirmation first. */
export function WriteTourButton({ tour, label }: { tour: PullRequestTourQueryState; label: string }): ReactElement {
  const [isConfirming, setIsConfirming] = useState(false);
  return (
    <BackgroundJobConfirm
      open={isConfirming}
      onOpenChange={setIsConfirming}
      title={tour.tour || tour.outdatedFormat ? 'Write the tour again?' : 'Write a tour?'}
      detail="Reads the change with AI and writes a tour of it. Takes a few minutes and runs in the background."
      actionLabel="Write tour"
      onConfirm={tour.write}
    >
      <button
        type="button"
        className="btn-subtle btn-regular"
        aria-disabled={tour.running || undefined}
        onClick={() => { if (!tour.running) setIsConfirming(true); }}
      >
        {tour.running ? <CircleDotDashed size={14} aria-hidden="true" /> : <Route size={14} aria-hidden="true" />}
        {tour.running ? 'Reading the change…' : label}
      </button>
    </BackgroundJobConfirm>
  );
}

function FailureDetails({ detail }: { detail: string }): ReactElement {
  return (
    <details className="pr-tour-failure">
      <summary>Technical details</summary>
      <pre>{detail}</pre>
    </details>
  );
}
