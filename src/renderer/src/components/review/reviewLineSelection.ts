import type { FileDiffOptions, SelectedLineRange } from '@pierre/diffs';

export const REVIEW_LINE_SELECTION_CSS = `
@media (pointer: fine) {
  [data-interactive-line-numbers] [data-column-number] {
    cursor: pointer;
  }

  [data-interactive-line-numbers] [data-column-number]:hover::after {
    content: '+';
    position: absolute;
    inset-block: 0;
    inset-inline-end: 0;
    display: grid;
    width: 1lh;
    height: 1lh;
    place-items: center;
    background-color: #4c8dff;
    color: #fff;
    border-radius: 4px;
    font-family: system-ui, sans-serif;
    font-size: 14px;
    font-weight: 600;
    line-height: 1;
    pointer-events: none;
    z-index: 4;
  }
}
`;

export function createReviewLineSelectionOptions<TAnnotation>(
  options: FileDiffOptions<TAnnotation>,
  onSelectLines: (range: SelectedLineRange | null) => void
): FileDiffOptions<TAnnotation> {
  return {
    ...options,
    unsafeCSS: `${options.unsafeCSS ?? ''}\n${REVIEW_LINE_SELECTION_CSS}`,
    enableLineSelection: true,
    controlledSelection: false,
    lineHoverHighlight: 'disabled',
    enableGutterUtility: false,
    onLineSelected: onSelectLines
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
