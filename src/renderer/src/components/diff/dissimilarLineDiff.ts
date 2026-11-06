import type { FileDiffOptions } from '@pierre/diffs';

const DISSIMILAR_ATTRIBUTE = 'data-dissimilar-change';
// Pierre pairs the n-th removed line with the n-th added line of a change block, even when they
// share nothing (code replaced by a comment). Below this word-level similarity the pair is two
// unrelated lines, so word emphasis would only paint confetti across both of them.
const MIN_SIMILARITY = 0.5;
const MAX_TOKENS = 400;

export const DISSIMILAR_LINE_DIFF_CSS = `
  [data-line][${DISSIMILAR_ATTRIBUTE}] [data-diff-span] {
    background-color: transparent;
  }
`;

/** Word-level similarity (0..1) of two lines: twice the longest common token run over both lengths. */
export function lineSimilarity(before: string, after: string): number {
  const a = tokenize(before);
  const b = tokenize(after);

  if (a.length === 0 && b.length === 0) {
    return 1;
  }

  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    return 1;
  }

  // Longest common subsequence over tokens, one row at a time.
  let previous = new Array<number>(b.length + 1).fill(0);

  for (const token of a) {
    const current = new Array<number>(b.length + 1).fill(0);

    for (let j = 0; j < b.length; j += 1) {
      current[j + 1] = token === b[j] ? previous[j] + 1 : Math.max(previous[j + 1], current[j]);
    }

    previous = current;
  }

  return (2 * previous[b.length]) / (a.length + b.length);
}

function tokenize(line: string): string[] {
  return line.match(/[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
}

export function createDissimilarLineDiffPostRender<LAnnotation>():
NonNullable<FileDiffOptions<LAnnotation>['onPostRender']> {
  return (node, _instance, phase) => {
    const root = node.shadowRoot;

    if (!root) {
      return;
    }

    for (const row of root.querySelectorAll<HTMLElement>(`[${DISSIMILAR_ATTRIBUTE}]`)) {
      row.removeAttribute(DISSIMILAR_ATTRIBUTE);
    }

    if (phase === 'unmount') {
      return;
    }

    const additions = new Map<string, HTMLElement>();

    for (const row of root.querySelectorAll<HTMLElement>('[data-line][data-line-type="change-addition"][data-line-index]')) {
      const splitIndex = row.dataset.lineIndex?.split(',').at(-1);

      if (splitIndex) {
        additions.set(splitIndex, row);
      }
    }

    for (const deletion of root.querySelectorAll<HTMLElement>('[data-line][data-line-type="change-deletion"][data-line-index]')) {
      const splitIndex = deletion.dataset.lineIndex?.split(',').at(-1);
      const addition = splitIndex ? additions.get(splitIndex) : undefined;

      if (!addition || !deletion.querySelector('[data-diff-span]')) {
        continue;
      }

      if (lineSimilarity(deletion.textContent ?? '', addition.textContent ?? '') < MIN_SIMILARITY) {
        markRows(root, deletion);
        markRows(root, addition);
      }
    }
  };
}

// Marks every rendered row of that line (code and gutter cells share its line index).
function markRows(root: ShadowRoot, contentRow: HTMLElement): void {
  const { lineIndex, lineType } = contentRow.dataset;

  if (!lineIndex || !lineType) {
    return;
  }

  for (const row of root.querySelectorAll<HTMLElement>(`[data-line-type="${lineType}"][data-line-index="${lineIndex}"]`)) {
    row.setAttribute(DISSIMILAR_ATTRIBUTE, '');
  }
}
