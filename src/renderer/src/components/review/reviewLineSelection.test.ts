import { describe, expect, it, vi } from 'vitest';

import {
  createReviewLineSelectionOptions,
  normalizeReviewLineSelection
} from './reviewLineSelection';

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

describe('createReviewLineSelectionOptions', () => {
  it('keeps selection rendering local while a line range is being dragged', () => {
    const onSelectLines = vi.fn();
    const options = createReviewLineSelectionOptions({}, onSelectLines);

    expect(options).toMatchObject({
      enableLineSelection: true,
      controlledSelection: false,
      lineHoverHighlight: 'disabled',
      enableGutterUtility: true
    });
    expect(options.onGutterUtilityClick).toBeUndefined();

    const range = { start: 8, end: 10, side: 'additions' as const };
    options.onLineSelected?.(range);

    expect(onSelectLines).toHaveBeenCalledOnce();
    expect(onSelectLines).toHaveBeenCalledWith(range);
  });

  it('prevents a new selection from replacing an open comment target', () => {
    const options = createReviewLineSelectionOptions({}, vi.fn(), true);
    expect(options.enableLineSelection).toBe(false);
    expect(options.enableGutterUtility).toBe(false);
    expect(options.onLineSelected).toBeUndefined();
  });
});
