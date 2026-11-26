import { describe, expect, it, vi } from 'vitest';

import {
  beginReviewSubmission,
  isReviewSubmissionInFlight,
  isReviewSummaryRequired,
  subscribeReviewSubmissions
} from './pullRequestReviewSubmission';

describe('pull request review submission', () => {
  it('allows requesting changes with draft comments and no summary', () => {
    expect(isReviewSummaryRequired('request-changes', 2)).toBe(false);
  });

  it('requires a summary when requesting changes without draft comments', () => {
    expect(isReviewSummaryRequired('request-changes', 0)).toBe(true);
  });

  it('keeps comment-only and approval summary requirements unchanged', () => {
    expect(isReviewSummaryRequired('comment', 0)).toBe(true);
    expect(isReviewSummaryRequired('comment', 1)).toBe(false);
    expect(isReviewSummaryRequired('approve', 0)).toBe(false);
  });
});

describe('review submissions in flight', () => {
  it('marks a draft key until its submission settles and tells subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeReviewSubmissions(listener);
    const end = beginReviewSubmission('drafts:a');
    expect(isReviewSubmissionInFlight('drafts:a')).toBe(true);
    expect(isReviewSubmissionInFlight('drafts:b')).toBe(false);
    end();
    expect(isReviewSubmissionInFlight('drafts:a')).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('stays in flight while another submission of the same key runs, and ends each once', () => {
    const first = beginReviewSubmission('drafts:a');
    const second = beginReviewSubmission('drafts:a');
    first();
    first();
    expect(isReviewSubmissionInFlight('drafts:a')).toBe(true);
    second();
    expect(isReviewSubmissionInFlight('drafts:a')).toBe(false);
  });
});
