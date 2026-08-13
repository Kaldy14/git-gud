import type { FileDiffOptions } from '@pierre/diffs';

const WHITESPACE_ONLY_ATTRIBUTE = 'data-whitespace-only-change';

export const WHITESPACE_ONLY_DIFF_CSS = `
  [data-diff-type="single"] [${WHITESPACE_ONLY_ATTRIBUTE}="deletion"] {
    display: none;
  }

  [data-diff-type="single"] [${WHITESPACE_ONLY_ATTRIBUTE}="addition"]:not([data-selected-line]) {
    --diffs-computed-diff-line-bg: var(--diffs-bg);
    --diffs-computed-selected-line-bg: var(--diffs-bg);
    --diffs-line-bg: var(--diffs-bg);
  }

  [data-diff-type="single"] [${WHITESPACE_ONLY_ATTRIBUTE}="addition"][data-column-number] {
    color: var(--diffs-fg-number);
  }

  [data-diff-type="single"] [${WHITESPACE_ONLY_ATTRIBUTE}="addition"] [data-diff-span] {
    background-color: light-dark(
      color-mix(in lab, var(--diffs-bg) 65%, var(--diffs-addition-base)),
      color-mix(in lab, var(--diffs-bg) 58%, var(--diffs-addition-base))
    );
  }
`;

export function createWhitespaceOnlyDiffPostRender<LAnnotation>():
NonNullable<FileDiffOptions<LAnnotation>['onPostRender']> {
  return (node, _instance, phase) => {
    const root = node.shadowRoot;

    if (!root) {
      return;
    }

    for (const row of root.querySelectorAll<HTMLElement>(`[${WHITESPACE_ONLY_ATTRIBUTE}]`)) {
      row.removeAttribute(WHITESPACE_ONLY_ATTRIBUTE);
    }

    if (phase === 'unmount' || !root.querySelector('[data-diff-type="single"]')) {
      return;
    }

    const additionsBySplitIndex = new Map<string, HTMLElement>();
    const additionRows = root.querySelectorAll<HTMLElement>(
      '[data-line][data-line-type="change-addition"][data-line-index]'
    );

    for (const addition of additionRows) {
      const splitIndex = getSplitLineIndex(addition);

      if (splitIndex) {
        additionsBySplitIndex.set(splitIndex, addition);
      }
    }

    const deletionRows = root.querySelectorAll<HTMLElement>(
      '[data-line][data-line-type="change-deletion"][data-line-index]'
    );

    for (const deletion of deletionRows) {
      const splitIndex = getSplitLineIndex(deletion);
      const addition = splitIndex ? additionsBySplitIndex.get(splitIndex) : undefined;

      if (!addition || !isWhitespaceOnlyLineChange(deletion.textContent ?? '', addition.textContent ?? '')) {
        continue;
      }

      markRenderedRow(root, deletion, 'deletion');
      markRenderedRow(root, addition, 'addition');
    }
  };
}

export function isWhitespaceOnlyLineChange(before: string, after: string): boolean {
  return before !== after && removeWhitespace(before) === removeWhitespace(after);
}

function removeWhitespace(value: string): string {
  return value.replace(/\s/gu, '');
}

function getSplitLineIndex(row: HTMLElement): string | undefined {
  return row.dataset.lineIndex?.split(',').at(-1);
}

function markRenderedRow(
  root: ShadowRoot,
  contentRow: HTMLElement,
  kind: 'addition' | 'deletion'
): void {
  const lineIndex = contentRow.dataset.lineIndex;

  if (!lineIndex) {
    return;
  }

  const lineType = `change-${kind}`;

  for (const row of root.querySelectorAll<HTMLElement>(
    `[data-line-type="${lineType}"][data-line-index]`
  )) {
    if (row.dataset.lineIndex === lineIndex) {
      row.setAttribute(WHITESPACE_ONLY_ATTRIBUTE, kind);
    }
  }
}
