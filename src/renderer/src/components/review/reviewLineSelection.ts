import type { FileDiffOptions, SelectedLineRange } from '@pierre/diffs';

import { REVIEW_LINE_CURSOR_CSS } from './reviewLineCursor';

export const REVIEW_LINE_SELECTION_CSS = `
  [data-column-number] {
    padding-left: max(2ch, 24px);
  }

  /* An annotation is not part of the selected code range. Keep the editor's
     gutter neutral instead of extending the line highlight down its full height. */
  [data-line-annotation][data-selected-line],
  [data-gutter-buffer="annotation"][data-selected-line] {
    --diffs-line-bg: var(--diffs-bg);
  }

  [data-column-number][data-selected-line] {
    color: var(--diffs-fg);
  }

  [data-gutter-utility-slot] {
    z-index: 2;
    left: 0;
    right: auto;
    justify-content: flex-start;
  }

@media (pointer: fine) {
  [data-interactive-line-numbers] [data-column-number] {
    cursor: pointer;
  }
}
`;

export function createReviewLineSelectionOptions<TAnnotation>(
  options: FileDiffOptions<TAnnotation>,
  onSelectLines: (range: SelectedLineRange | null) => void,
  hasOpenComposer = false
): FileDiffOptions<TAnnotation> {
  return {
    ...options,
    unsafeCSS: `${options.unsafeCSS ?? ''}\n${REVIEW_LINE_SELECTION_CSS}\n${REVIEW_LINE_CURSOR_CSS}`,
    enableLineSelection: !hasOpenComposer,
    controlledSelection: false,
    lineHoverHighlight: 'disabled',
    enableGutterUtility: !hasOpenComposer,
    onLineSelected: hasOpenComposer ? undefined : onSelectLines
  };
}

export function normalizeReviewLineSelection(range: SelectedLineRange | null): {
  startLine?: number;
  startSide: 'left' | 'right';
  line: number;
  side: 'left' | 'right';
} | undefined {
  if (!range?.side) {
    return undefined;
  }

  const startSide = range.side === 'additions' ? 'right' : 'left';
  const endSide = (range.endSide ?? range.side) === 'additions' ? 'right' : 'left';

  if (range.start > range.end) {
    return {
      startLine: range.end,
      startSide: endSide,
      line: range.start,
      side: startSide
    };
  }

  return {
    startLine: range.start === range.end ? undefined : range.start,
    startSide,
    line: range.end,
    side: endSide
  };
}
