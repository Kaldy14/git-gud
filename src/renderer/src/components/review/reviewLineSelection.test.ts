import { describe, expect, it } from 'vitest';

import { normalizeReviewLineSelection } from './reviewLineSelection';

describe('normalizeReviewLineSelection', () => {
  it('orders a reverse drag before creating a GitHub line range', () => {
    expect(normalizeReviewLineSelection({
      start: 10,
      end: 8,
      side: 'additions',
      endSide: 'additions'
    })).toEqual({
      startLine: 8,
      startSide: 'right',
      line: 10,
      side: 'right'
    });
  });

  it('preserves the sides associated with reversed range endpoints', () => {
    expect(normalizeReviewLineSelection({
      start: 10,
      end: 8,
      side: 'additions',
      endSide: 'deletions'
    })).toEqual({
      startLine: 8,
      startSide: 'left',
      line: 10,
      side: 'right'
    });
  });
});
