import { describe, expect, it } from 'vitest';

import { retainUnsubmittedOrFailedDrafts } from './pullRequestReviewDrafts';

describe('pull request review draft submission', () => {
  it('removes only successful drafts from the submitted snapshot', () => {
    const drafts = [
      { id: 'submitted-success' },
      { id: 'submitted-failure' },
      { id: 'added-while-submitting' }
    ];

    expect(
      retainUnsubmittedOrFailedDrafts(
        drafts,
        new Set(['submitted-success', 'submitted-failure']),
        new Set(['submitted-failure'])
      )
    ).toEqual([
      { id: 'submitted-failure' },
      { id: 'added-while-submitting' }
    ]);
  });
});
