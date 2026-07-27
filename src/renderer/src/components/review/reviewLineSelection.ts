import type { SelectedLineRange } from '@pierre/diffs';

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
