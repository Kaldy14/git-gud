import type { SelectedLineRange } from '@pierre/diffs';

/**
 * Keyboard line cursor for pull-request diffs. Pierre's gutter utility is off for large-review
 * performance, so instead of per-line hover controls the cursor marks lines inside each chunk's
 * shadow root and C opens the normal line composer for them.
 */
export type ReviewLineCursor = {
  chunkId: string;
  /** Index into the chunk's rendered `[data-line]` rows, in DOM order. */
  index: number;
  /** Where a Shift+arrow selection started; equals `index` for a single line. */
  anchor: number;
};

export const REVIEW_LINE_CURSOR_ATTRIBUTE = 'data-gg-cursor';

export const REVIEW_LINE_CURSOR_CSS = `
[${REVIEW_LINE_CURSOR_ATTRIBUTE}] {
  background-color: rgb(95 214 195 / 0.14);
}
`;

function chunkRoot(chunkElement: Element): ShadowRoot | null {
  return chunkElement.querySelector('diffs-container')?.shadowRoot ?? null;
}

export function reviewChunkLines(chunkElement: Element): HTMLElement[] {
  return [...(chunkRoot(chunkElement)?.querySelectorAll<HTMLElement>('[data-line]') ?? [])];
}

export function reviewChunkElements(container: ParentNode): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.review-chunk[data-review-chunk-id]')]
    .filter((element) => chunkRoot(element) !== null);
}

/** Moves the cursor one line, crossing into the neighbouring chunk at either end. */
export function moveReviewLineCursor(
  container: ParentNode,
  cursor: ReviewLineCursor | undefined,
  direction: 1 | -1,
  extend: boolean,
  startChunkId?: string
): ReviewLineCursor | undefined {
  const chunks = reviewChunkElements(container);
  if (chunks.length === 0) return undefined;
  if (!cursor) {
    const start = chunks.find((chunk) => chunk.dataset.reviewChunkId === startChunkId) ?? chunks[0];
    return { chunkId: start.dataset.reviewChunkId!, index: 0, anchor: 0 };
  }
  const chunkIndex = chunks.findIndex((chunk) => chunk.dataset.reviewChunkId === cursor.chunkId);
  if (chunkIndex === -1) return moveReviewLineCursor(container, undefined, direction, false, startChunkId);
  const lines = reviewChunkLines(chunks[chunkIndex]);
  const next = cursor.index + direction;
  if (next >= 0 && next < lines.length) {
    return { chunkId: cursor.chunkId, index: next, anchor: extend ? cursor.anchor : next };
  }
  // A selection stays inside one chunk: GitHub comments target a single hunk.
  if (extend) return cursor;
  const neighbour = chunks[chunkIndex + direction];
  if (!neighbour) return cursor;
  const neighbourLines = reviewChunkLines(neighbour);
  const index = direction === 1 ? 0 : Math.max(0, neighbourLines.length - 1);
  return { chunkId: neighbour.dataset.reviewChunkId!, index, anchor: index };
}

/** Marks the cursor rows and scrolls the active one into view. */
export function paintReviewLineCursor(container: ParentNode, cursor: ReviewLineCursor | undefined): void {
  for (const chunk of reviewChunkElements(container)) {
    const root = chunkRoot(chunk);
    root?.querySelectorAll(`[${REVIEW_LINE_CURSOR_ATTRIBUTE}]`).forEach((row) => row.removeAttribute(REVIEW_LINE_CURSOR_ATTRIBUTE));
    if (!root || !cursor || chunk.dataset.reviewChunkId !== cursor.chunkId) continue;
    const lines = reviewChunkLines(chunk);
    const [from, to] = cursor.anchor <= cursor.index ? [cursor.anchor, cursor.index] : [cursor.index, cursor.anchor];
    for (const line of lines.slice(from, to + 1)) {
      line.setAttribute(REVIEW_LINE_CURSOR_ATTRIBUTE, '');
      // The number gutter is a sibling row sharing the line index.
      root.querySelector(`[data-column-number][data-line-index="${line.dataset.lineIndex}"]`)?.setAttribute(REVIEW_LINE_CURSOR_ATTRIBUTE, '');
    }
    lines[cursor.index]?.scrollIntoView({ block: 'nearest' });
  }
}

/** The line range the cursor covers, in the shape Pierre's line selection reports. */
export function reviewLineCursorRange(container: ParentNode, cursor: ReviewLineCursor): SelectedLineRange | null {
  const chunk = reviewChunkElements(container).find((element) => element.dataset.reviewChunkId === cursor.chunkId);
  if (!chunk) return null;
  const lines = reviewChunkLines(chunk);
  const startLine = lines[Math.min(cursor.anchor, cursor.index)];
  const endLine = lines[Math.max(cursor.anchor, cursor.index)];
  if (!startLine || !endLine) return null;
  const side = (line: HTMLElement) => line.dataset.lineType === 'change-deletion' ? 'deletions' as const : 'additions' as const;
  const start = Number(startLine.dataset.line);
  const end = Number(endLine.dataset.line);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end, side: side(startLine), endSide: side(endLine) };
}
