import { describe, expect, it } from 'vitest';

import { isReviewSummaryRequired } from './pullRequestReviewSubmission';

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
