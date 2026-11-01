import { describe, expect, it } from 'vitest';

import { formatFetchedAgo } from './fetchedAgo';

const now = Date.parse('2026-11-01T12:00:00Z');

describe('formatFetchedAgo', () => {
  it('uses short relative labels for recent fetches', () => {
    expect(formatFetchedAgo('2026-11-01T11:59:40Z', now).label).toBe('Fetched just now');
    expect(formatFetchedAgo('2026-11-01T11:55:00Z', now).label).toBe('Fetched 5 min ago');
    expect(formatFetchedAgo('2026-11-01T09:00:00Z', now).label).toBe('Fetched 3 h ago');
  });

  it('switches to a date after a day and explains a missing fetch', () => {
    expect(formatFetchedAgo('2026-10-28T12:00:00Z', now).label).toMatch(/^Fetched \D+ 28$|^Fetched 28 \D+$/);
    expect(formatFetchedAgo(undefined, now).label).toBe('Not fetched yet');
    expect(formatFetchedAgo('not a date', now).label).toBe('Not fetched yet');
  });

  it('never reports a negative age when clocks disagree', () => {
    expect(formatFetchedAgo('2026-11-01T12:05:00Z', now).label).toBe('Fetched just now');
  });
});
