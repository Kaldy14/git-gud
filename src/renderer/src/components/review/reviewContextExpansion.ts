import type { FileDiffOptions } from '@pierre/diffs';

import {
  getSmartExpansionLineCount,
  getSyntaxExpansionLineCount,
  type ExpandableReviewDiff
} from './reviewContextDiff';

type ReviewExpansionListener = {
  root: ShadowRoot;
  handler: EventListener;
};

const reviewExpansionListeners = new WeakMap<HTMLElement, ReviewExpansionListener>();

const REVIEW_CONTEXT_SEPARATOR_CSS = `
  [data-separator="line-info"] {
    margin-block: 0;
  }

  [data-separator="line-info"] [data-separator-content],
  [data-separator="line-info"] [data-expand-button] {
    background: #282828;
    border-radius: 0;
  }

  [data-separator="line-info"] [data-unmodified-lines]::after {
    content: " · Expand nearby block";
    color: #53d6c7;
    font-size: 10px;
    font-weight: 600;
  }
`;

export function createReviewContextOptions(
  options: FileDiffOptions<undefined>,
  diff: ExpandableReviewDiff,
  filePath: string
): FileDiffOptions<undefined> {
  return {
    ...options,
    hunkSeparators: 'line-info',
    onPostRender: createReviewContextPostRender(diff, filePath),
    unsafeCSS: `${options.unsafeCSS ?? ''}\n${REVIEW_CONTEXT_SEPARATOR_CSS}`
  };
}

function createReviewContextPostRender(
  diff: ExpandableReviewDiff,
  filePath: string
): NonNullable<FileDiffOptions<undefined>['onPostRender']> {
  return (node, instance, phase) => {
    const previousListener = reviewExpansionListeners.get(node);

    if (previousListener) {
      previousListener.root.removeEventListener('click', previousListener.handler, true);
      reviewExpansionListeners.delete(node);
    }

    const root = node.shadowRoot;

    if (phase === 'unmount' || !root) {
      return;
    }

    const handler: EventListener = (event) => {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      const interactiveTarget = target.closest('[data-expand-button], [data-separator-content]');
      const separator = interactiveTarget?.closest<HTMLElement>('[data-separator][data-expand-index]');

      if (!separator) {
        return;
      }

      const request = getReviewExpansionRequest(separator, diff, filePath);

      if (!request) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      instance.expandHunk(request.hunkIndex, request.direction, request.lineCount);
    };

    root.addEventListener('click', handler, true);
    reviewExpansionListeners.set(node, { root, handler });
    decorateReviewContextSeparators(root, diff, filePath);
  };
}

function decorateReviewContextSeparators(
  root: ShadowRoot,
  diff: ExpandableReviewDiff,
  filePath: string
): void {
  for (const separator of root.querySelectorAll<HTMLElement>('[data-separator][data-expand-index]')) {
    const request = getReviewExpansionRequest(separator, diff, filePath);

    if (!request) {
      continue;
    }

    const title = `Expand ${request.lineCount} nearby line${request.lineCount === 1 ? '' : 's'} as one code block`;
    const content = separator.querySelector<HTMLElement>('[data-separator-content]');

    content?.setAttribute('title', title);
    content?.setAttribute('aria-label', title);
    for (const button of separator.querySelectorAll<HTMLElement>('[data-expand-button]')) {
      button.setAttribute('title', title);
      button.setAttribute('aria-label', title);
    }
  }
}

function getReviewExpansionRequest(
  separator: HTMLElement,
  diff: ExpandableReviewDiff,
  filePath: string
): { hunkIndex: number; direction: 'up' | 'down'; lineCount: number } | undefined {
  const hunkIndex = Number.parseInt(separator.dataset.expandIndex ?? '', 10);
  const remainingLineCount = Number.parseInt(
    separator.querySelector('[data-unmodified-lines]')?.textContent ?? '',
    10
  );
  const direction = separator.hasAttribute('data-separator-first')
    ? 'down'
    : separator.hasAttribute('data-separator-last')
      ? 'up'
      : undefined;

  if (Number.isNaN(hunkIndex) || Number.isNaN(remainingLineCount) || remainingLineCount <= 0 || !direction) {
    return undefined;
  }

  const isLeading = direction === 'down';
  const contextLines = isLeading ? diff.leadingContextLines : diff.trailingContextLines;
  const boundedLineCount = Math.min(remainingLineCount, contextLines.length);
  const hiddenLines = isLeading
    ? contextLines.slice(0, boundedLineCount)
    : contextLines.slice(contextLines.length - boundedLineCount);
  const syntaxDirection = isLeading ? 'before' : 'after';
  const boundaryLine = isLeading
    ? diff.leadingContextStartLine + remainingLineCount
    : diff.trailingContextStartLine + (contextLines.length - remainingLineCount);
  const syntaxLineCount = getSyntaxExpansionLineCount(
    diff.syntaxNodes,
    syntaxDirection,
    boundaryLine,
    boundedLineCount
  );
  const lineCount = Math.max(
    syntaxLineCount ?? getSmartExpansionLineCount(hiddenLines, syntaxDirection, filePath),
    1
  );

  return { hunkIndex, direction, lineCount };
}
