import type { FileDiffOptions, SelectedLineRange } from '@pierre/diffs';

export const REVIEW_LINE_SELECTION_CSS = `
[data-utility-button] {
  background-color: #4c8dff;
  color: #fff;
  margin-right: 0;
}
`;

export function createReviewLineSelectionOptions<TAnnotation>(
  options: FileDiffOptions<TAnnotation>,
  enableGutterUtility: boolean,
  onSelectLines: (range: SelectedLineRange | null) => void
): FileDiffOptions<TAnnotation> {
  return {
    ...options,
    unsafeCSS: `${options.unsafeCSS ?? ''}\n${REVIEW_LINE_SELECTION_CSS}`,
    enableLineSelection: true,
    controlledSelection: false,
    lineHoverHighlight: 'both',
    enableGutterUtility,
    onGutterUtilityClick: onSelectLines,
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
