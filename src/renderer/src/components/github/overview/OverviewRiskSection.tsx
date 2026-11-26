import { useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { CircleDotDashed } from 'lucide-react';

import { ReviewCommentBody } from '@renderer/components/review/ReviewCommentBody';
import type { GitHubPullRequestDetail } from '@shared/types';
import { PullRequestRiskChip } from '../PullRequestRiskChip';
import type { PullRequestTourQueryState } from '../tour/pullRequestTourQuery';
import { FailureDetails, InlineCodeText, OverviewSection, OverviewTourButton, RelativeTime } from './overviewParts';

/**
 * Risk level and a plain summary from the tour, or the author's description when there is no tour.
 * Tour text always ends with a muted provenance line so it never reads as a GitHub fact.
 */
export function OverviewRiskSection({ detail, tour: tourState, onOpenConversation }: {
  detail: GitHubPullRequestDetail;
  tour: PullRequestTourQueryState;
  onOpenConversation: () => void;
}): ReactElement | null {
  const { tour, isCurrent, isLoading } = tourState;
  // Read from disk in a moment; rendering "From the author" first would flash and jump.
  if (isLoading) return null;
  if (!tour) return <FromTheAuthor detail={detail} tour={tourState} onOpenConversation={onOpenConversation} />;

  const { overview } = tour;
  const risk = overview.risk;
  return (
    <OverviewSection
      id="pr-overview-risk"
      title="Risk level"
      verdict={risk
        ? <PullRequestRiskChip risk={risk} muted={!isCurrent} title={isCurrent ? undefined : 'Assessed before the latest push'} />
        : <span className="pr-overview-verdict" data-tone="muted">Not assessed</span>}
    >
      <div className="pr-overview-card pr-overview-risk">
        {overview.summary ? <p className="pr-overview-lead"><InlineCodeText text={overview.summary} /></p> : null}
        {overview.highlights.length ? (
          <ul className="pr-overview-highlights">
            {overview.highlights.slice(0, 4).map((highlight) => <li key={highlight}><InlineCodeText text={highlight} /></li>)}
          </ul>
        ) : null}
        {overview.partial ? <p className="pr-overview-note">{partialNote(detail)}</p> : null}
        <Provenance detail={detail} tour={tourState} />
      </div>
    </OverviewSection>
  );
}

function Provenance({ detail, tour: tourState }: { detail: GitHubPullRequestDetail; tour: PullRequestTourQueryState }): ReactElement {
  const { tour, isCurrent, running, failure } = tourState;
  return (
    <div className="pr-overview-provenance">
      <p>
        {running ? <CircleDotDashed size={12} aria-hidden="true" /> : null}
        <span>
          Written by the tour for <code>{tour!.headSha.slice(0, 7)}</code> · <RelativeTime value={tour!.generatedAt} />
          {!isCurrent ? <> · <strong>before the latest push</strong> ({detail.headSha.slice(0, 7)})</> : null}
          {running ? ' · rewriting now' : failure ? ' · the last rewrite failed' : null}
        </span>
      </p>
      {running ? null : <OverviewTourButton tour={tourState} label={failure ? 'Try again' : 'Rewrite'} compact />}
      {failure && !running ? <FailureDetails detail={failure} /> : null}
    </div>
  );
}

// Count files the prompt left out; a pull request can also be cut off by the prompt's size limit.
function partialNote(detail: GitHubPullRequestDetail): string {
  const omitted = new Set(detail.reviewPlan.units.flatMap((unit) => unit.chunks)
    .filter((chunk) => chunk.omittedReason && chunk.omittedReason !== 'binary')
    .map((chunk) => chunk.path)).size;
  return omitted > 0
    ? `Based on part of the diff: ${omitted} ${omitted === 1 ? 'file was' : 'files were'} too large to read.`
    : 'Based on part of the diff: the change was too large to read in full.';
}

function FromTheAuthor({ detail, tour, onOpenConversation }: {
  detail: GitHubPullRequestDetail;
  tour: PullRequestTourQueryState;
  onOpenConversation: () => void;
}): ReactElement {
  const body = detail.body.trim();
  const { running, failure, outdatedFormat } = tour;
  return (
    <OverviewSection id="pr-overview-risk" title="From the author">
      <div className="pr-overview-card pr-overview-author">
        {body ? (
          <>
            <ClampedDescription body={body} imageUrls={detail.bodyImageUrls} />
            <button type="button" className="pr-overview-link" onClick={onOpenConversation}>Read the full description</button>
          </>
        ) : <p className="pr-overview-empty">{detail.author} did not write a description.</p>}
        <div className="pr-overview-tour-row">
          <p>
            {running ? <CircleDotDashed size={14} aria-hidden="true" /> : null}
            {running
              ? 'Reading the change… A large one takes a few minutes.'
              : failure
                ? 'The tour could not be written.'
                : outdatedFormat
                  ? 'The tour was written in an older format.'
                  : 'Want a walkthrough of the change?'}
          </p>
          {running ? null : <OverviewTourButton tour={tour} label={failure ? 'Try again' : outdatedFormat ? 'Write it again' : 'Write tour'} compact />}
          {failure && !running ? <FailureDetails detail={failure} /> : null}
        </div>
      </div>
    </OverviewSection>
  );
}

// About six lines of the description; a fade marks the cut only when there is more to read.
function ClampedDescription({ body, imageUrls }: { body: string; imageUrls?: Record<string, string> }): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setClamped(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    // The box itself stops growing at the clamp, so watch the content too.
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [body]);
  return (
    <div ref={ref} className="pr-overview-description" data-clamped={clamped || undefined}>
      <ReviewCommentBody body={body} compact imageUrls={imageUrls} />
    </div>
  );
}
