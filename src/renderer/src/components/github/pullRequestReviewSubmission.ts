import { useSyncExternalStore } from 'react';

import type { GitHubPullRequestReviewInput } from '@shared/types';

export function isReviewSummaryRequired(
  event: GitHubPullRequestReviewInput['event'],
  draftCount: number
): boolean {
  return event !== 'approve' && draftCount === 0;
}

// Draft storage keys with a review submission in flight. A submission outlives its view (the reader can
// leave and reopen the pull request while it runs); a reopened view loads the same drafts from storage,
// so it must not send them again, and reloads them once the first submission has cleaned storage.
const inFlightCounts = new Map<string, number>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Marks a submission of `storageKey`'s drafts as running; call the returned function when it settles. */
export function beginReviewSubmission(storageKey: string): () => void {
  inFlightCounts.set(storageKey, (inFlightCounts.get(storageKey) ?? 0) + 1);
  notify();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    const remaining = (inFlightCounts.get(storageKey) ?? 1) - 1;
    if (remaining > 0) inFlightCounts.set(storageKey, remaining);
    else inFlightCounts.delete(storageKey);
    notify();
  };
}

export function isReviewSubmissionInFlight(storageKey: string): boolean {
  return inFlightCounts.has(storageKey);
}

export function subscribeReviewSubmissions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReviewSubmissionInFlight(storageKey: string): boolean {
  return useSyncExternalStore(subscribeReviewSubmissions, () => isReviewSubmissionInFlight(storageKey));
}
