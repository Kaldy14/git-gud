import { useState, type ReactElement, type ReactNode } from 'react';
import { CircleDotDashed, Route } from 'lucide-react';

import { BackgroundJobConfirm } from '../BackgroundJobConfirm';
import type { PullRequestTourQueryState } from '../tour/pullRequestTourQuery';

/** A section: a 15px heading with its verdict inline, trailing actions, then one card. */
export function OverviewSection({ id, title, verdict, actions, children }: {
  id: string;
  title: string;
  verdict?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="pr-overview-section" aria-labelledby={id}>
      <header className="pr-overview-section-head">
        <h2 id={id}>{title}</h2>
        {verdict}
        {actions ? <span className="pr-overview-section-actions">{actions}</span> : null}
      </header>
      {children}
    </section>
  );
}

/** Text with `inline code` spans rendered as code (tour titles are written that way). */
export function InlineCodeText({ text }: { text: string }): ReactElement {
  const parts = text.split(/(`[^`]+`)/u);
  return (
    <>
      {parts.map((part, index) => part.length > 2 && part.startsWith('`') && part.endsWith('`')
        ? <code key={index}>{part.slice(1, -1)}</code>
        : part)}
    </>
  );
}

function formatRelativeTime(value: string, now = Date.now()): string {
  const minutes = Math.round((Date.parse(value) - now) / 60_000);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (Math.abs(minutes) < 60) return format.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return format.format(hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return format.format(days, 'day');
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function RelativeTime({ value }: { value: string }): ReactElement {
  return <time dateTime={value} title={new Date(value).toLocaleString()}>{formatRelativeTime(value)}</time>;
}

/**
 * Starts (or restarts) the tour through the shared confirmation: AI never starts from one click.
 * While a run is in progress it stays focusable but inert (`aria-disabled`).
 */
export function OverviewTourButton({ tour, label, compact = false }: {
  tour: PullRequestTourQueryState;
  label: string;
  compact?: boolean;
}): ReactElement {
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
        className={`btn-subtle ${compact ? 'btn-compact' : 'btn-regular'}`}
        aria-disabled={tour.running || undefined}
        onClick={() => { if (!tour.running) setIsConfirming(true); }}
      >
        {tour.running ? <CircleDotDashed aria-hidden="true" /> : <Route aria-hidden="true" />}
        {tour.running ? 'Reading the change…' : label}
      </button>
    </BackgroundJobConfirm>
  );
}

export function FailureDetails({ detail }: { detail: string }): ReactElement {
  return (
    <details className="pr-overview-failure">
      <summary>Technical details</summary>
      <pre>{detail}</pre>
    </details>
  );
}
