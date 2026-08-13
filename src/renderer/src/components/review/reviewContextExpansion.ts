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
    --review-context-border: color-mix(in srgb, var(--border) 72%, transparent);
    --review-context-surface: color-mix(in srgb, var(--diffs-bg) 94%, var(--text-3));
    height: 1lh;
    margin-block: 0;
    background: var(--diffs-bg);
  }

  [data-separator="line-info"] [data-separator-wrapper] {
    grid-template-columns: 28px minmax(0, 1fr);
    border-block: 1px solid var(--review-context-border);
    background: var(--review-context-surface);
    transition:
      background-color 120ms ease,
      border-color 120ms ease;
  }

  [data-separator="line-info"] [data-separator-content],
  [data-separator="line-info"] [data-expand-button] {
    border: 0;
    background: transparent;
    border-radius: 0;
    color: var(--text-3);
  }

  [data-separator="line-info"] [data-expand-button] {
    min-width: 28px;
    border-right: 1px solid var(--review-context-border);
    color: var(--accent-2);
    opacity: 0.78;
    transition:
      color 120ms ease,
      opacity 120ms ease;
  }

  [data-separator="line-info"] [data-separator-content] {
    padding-inline: 10px;
    font-size: 10px;
  }

  [data-separator="line-info"] [data-separator-wrapper]:hover {
    --review-context-border: color-mix(in srgb, var(--border-strong) 82%, transparent);
    --review-context-surface: color-mix(in srgb, var(--diffs-bg) 90%, var(--text-3));
  }

  [data-separator="line-info"] [data-separator-wrapper]:hover [data-expand-button] {
    color: var(--accent-2);
    opacity: 1;
  }

  [data-separator="line-info"][data-expand-index] [data-separator-content]:hover {
    text-decoration: none;
  }

  [data-separator="line-info"] [data-separator-content]:focus-visible,
  [data-separator="line-info"] [data-expand-button]:focus-visible {
    outline: 2px solid var(--accent-2);
    outline-offset: -2px;
  }

  [data-separator="line-info"] [data-unmodified-lines] {
    color: var(--text-3);
    font-weight: 600;
  }

  [data-separator="line-info"] [data-unmodified-lines]::after {
    content: "  ·  Expand block";
    color: var(--text-2);
    font-weight: 500;
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
  const contextPostRender = createReviewContextPostRender<LAnnotation>(diff, filePath);

  return {
    ...options,
    hunkSeparators: 'line-info',
    onPostRender: (node, instance, phase) => {
      options.onPostRender?.(node, instance, phase);
      contextPostRender(node, instance, phase);
    },
    unsafeCSS: `${options.unsafeCSS ?? ''}\n${REVIEW_CONTEXT_SEPARATOR_CSS}\n${continuationCSS}`
  };
}

export function shareReviewExpansionBoundary(
  previous: ExpandableReviewDiff | undefined,
  current: ExpandableReviewDiff | undefined
): boolean {
  if (!previous || !current ||
    previous.trailingContextLines.length === 0 || current.leadingContextLines.length === 0) {
    return false;
  }

  const previousStart = previous.trailingContextStartLine;
  const previousEnd = previousStart + previous.trailingContextLines.length;
  const currentStart = current.leadingContextStartLine;
  const currentEnd = currentStart + current.leadingContextLines.length;

  return previousStart === currentStart && previousEnd === currentEnd;
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

      const request = getReviewExpansionRequest(
        separator,
        interactiveTarget ?? undefined,
        diff,
        filePath
      );

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
    const request = getReviewExpansionRequest(separator, undefined, diff, filePath);

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
  control: Element | undefined,
  diff: ExpandableReviewDiff,
  filePath: string
): { hunkIndex: number; direction: 'up' | 'down'; lineCount: number } | undefined {
  const hunkIndex = Number.parseInt(separator.dataset.expandIndex ?? '', 10);
  const remainingLineCount = Number.parseInt(
    separator.querySelector('[data-unmodified-lines]')?.textContent ?? '',
    10
  );
  const direction = resolveReviewExpansionDirection({
    expandUp: control?.hasAttribute('data-expand-up') ?? false,
    expandDown: control?.hasAttribute('data-expand-down') ?? false,
    separatorFirst: separator.hasAttribute('data-separator-first'),
    separatorLast: separator.hasAttribute('data-separator-last')
  });

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

export function resolveReviewExpansionDirection({
  expandUp,
  expandDown,
  separatorFirst,
  separatorLast
}: {
  expandUp: boolean;
  expandDown: boolean;
  separatorFirst: boolean;
  separatorLast: boolean;
}): 'up' | 'down' | undefined {
  if (expandUp) {
    return 'up';
  }

  if (expandDown) {
    return 'down';
  }

  return separatorFirst ? 'down' : separatorLast ? 'up' : undefined;
}
