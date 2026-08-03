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
    height: 1lh;
    margin-block: 0;
  }

  [data-separator="line-info"] [data-separator-content],
  [data-separator="line-info"] [data-expand-button] {
    border: 1px solid var(--select-border);
    background: var(--select-bg);
    border-radius: 0;
    color: var(--diffs-modified-base);
  }

  [data-separator="line-info"] [data-separator-content]:focus-visible,
  [data-separator="line-info"] [data-expand-button]:focus-visible {
    outline: 2px solid var(--diffs-modified-base);
    outline-offset: -2px;
  }

  [data-separator="line-info"] [data-unmodified-lines]::after {
    content: " · Expand nearby block";
    color: var(--diffs-modified-base);
    font-size: 10px;
    font-weight: 600;
  }
`;

export function createReviewContextOptions<LAnnotation>(
  options: FileDiffOptions<LAnnotation>,
  diff: ExpandableReviewDiff,
  filePath: string,
  hideLeadingSeparator = false
): FileDiffOptions<LAnnotation> {
  const continuationCSS = hideLeadingSeparator
    ? '[data-separator="line-info"][data-separator-first] { display: none; }'
    : '';

  return {
    ...options,
    hunkSeparators: 'line-info',
    onPostRender: createReviewContextPostRender(diff, filePath),
    unsafeCSS: `${options.unsafeCSS ?? ''}\n${REVIEW_CONTEXT_SEPARATOR_CSS}\n${continuationCSS}`
  };
}

function createReviewContextPostRender<LAnnotation>(
  diff: ExpandableReviewDiff,
  filePath: string
): NonNullable<FileDiffOptions<LAnnotation>['onPostRender']> {
  return (node, instance, phase) => {
    const previousListener = reviewExpansionListeners.get(node);

    if (previousListener) {
      previousListener.root.removeEventListener('click', previousListener.handler, true);
      previousListener.root.removeEventListener('keydown', previousListener.handler, true);
      reviewExpansionListeners.delete(node);
    }

    const root = node.shadowRoot;

    if (phase === 'unmount' || !root) {
      return;
    }

    const handler: EventListener = (event) => {
      if (event instanceof KeyboardEvent) {
        if (!isReviewExpansionKey(event.key)) {
          return;
        }
        if (event.target instanceof Element && event.target.matches('button, input')) {
          return;
        }
      }
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
    root.addEventListener('keydown', handler, true);
    reviewExpansionListeners.set(node, { root, handler });
    decorateReviewContextSeparators(root, diff, filePath);
  };
}

export function isReviewExpansionKey(key: string): boolean {
  return key === 'Enter' || key === ' ';
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
    const buttons = separator.querySelectorAll<HTMLElement>('[data-expand-button]');

    content?.setAttribute('title', title);
    content?.setAttribute('aria-label', title);
    if (content && buttons.length === 0) {
      content.setAttribute('role', 'button');
      content.tabIndex = 0;
    }
    for (const button of buttons) {
      button.setAttribute('title', title);
      button.setAttribute('aria-label', title);
      button.tabIndex = 0;
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
