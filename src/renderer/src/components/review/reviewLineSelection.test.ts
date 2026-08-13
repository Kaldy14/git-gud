import { describe, expect, it, vi } from 'vitest';

import {
  createReviewLineSelectionOptions,
  normalizeReviewLineSelection,
  REVIEW_LINE_SELECTION_CSS
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
    const options = createReviewLineSelectionOptions({}, true, onSelectLines);

    expect(options).toMatchObject({
      enableLineSelection: true,
      controlledSelection: false,
      lineHoverHighlight: 'both',
      enableGutterUtility: true
    });

    const range = { start: 8, end: 10, side: 'additions' as const };
    options.onLineSelected?.(range);
    options.onGutterUtilityClick?.(range);

    expect(onSelectLines).toHaveBeenNthCalledWith(1, range);
    expect(onSelectLines).toHaveBeenNthCalledWith(2, range);
  });

  it('places the blue gutter action inside the number column', () => {
    expect(REVIEW_LINE_SELECTION_CSS).toContain('background-color: #4c8dff');
    expect(REVIEW_LINE_SELECTION_CSS).toContain('margin-right: 0');
  });
});
