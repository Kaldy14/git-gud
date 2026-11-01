const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const dayFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fullFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** Short status-bar label for when the repository last fetched from its remotes. */
export function formatFetchedAgo(lastFetchedAt: string | undefined, now: number): { label: string; title: string } {
  const fetchedAt = lastFetchedAt ? Date.parse(lastFetchedAt) : Number.NaN;

  if (Number.isNaN(fetchedAt)) {
    return {
      label: 'Not fetched yet',
      title: 'Git Gud has not fetched this repository. Ahead and behind counts use the last known remote state.'
    };
  }

  const elapsed = Math.max(0, now - fetchedAt);
  const label = elapsed < MINUTE_MS
    ? 'Fetched just now'
    : elapsed < HOUR_MS
      ? `Fetched ${Math.floor(elapsed / MINUTE_MS)} min ago`
      : elapsed < DAY_MS
        ? `Fetched ${Math.floor(elapsed / HOUR_MS)} h ago`
        : `Fetched ${dayFormatter.format(fetchedAt)}`;

  return { label, title: `Last fetched ${fullFormatter.format(fetchedAt)}` };
}
