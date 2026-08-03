import { describe, expect, it } from 'vitest';

import type { ExpandableReviewDiff } from './reviewContextDiff';
import {
  createReviewContextOptions,
  isReviewExpansionKey,
  resolveReviewExpansionDirection,
  shareReviewExpansionBoundary
} from './reviewContextExpansion';

describe('review context expansion', () => {
  it('keeps expandable separators at the normal diff line height', () => {
    const options = createReviewContextOptions(
      { unsafeCSS: '[data-line] { color: inherit; }' },
      {} as ExpandableReviewDiff,
      'src/example.ts'
    );

    expect(options.unsafeCSS).toContain('[data-line] { color: inherit; }');
    expect(options.unsafeCSS).toMatch(
      /\[data-separator="line-info"\]\s*\{[^}]*height:\s*1lh;/
    );
    expect(options.unsafeCSS).toMatch(/border-block:\s*1px solid var\(--review-context-border\)/);
    expect(options.unsafeCSS).toMatch(/background:\s*var\(--review-context-surface\)/);
    expect(options.unsafeCSS).toContain('content: "  ·  Expand block"');
    expect(options.unsafeCSS).toContain('text-decoration: none');
    expect(options.unsafeCSS).toContain(':focus-visible');
  });

  it('keeps leading separators visible for grouped continuation chunks', () => {
    const options = createReviewContextOptions({}, {} as ExpandableReviewDiff, 'src/example.ts');

    expect(options.unsafeCSS).not.toContain('display: none');
  });

  it('hides a duplicate leading separator only when the preceding chunk owns the same gap', () => {
    const previous = expandable({
      trailingContextStartLine: 20,
      trailingContextLines: ['20\n', '21\n']
    });
    const current = expandable({
      leadingContextStartLine: 20,
      leadingContextLines: ['20\n', '21\n']
    });

    expect(shareReviewExpansionBoundary(previous, current)).toBe(true);
    expect(shareReviewExpansionBoundary(undefined, current)).toBe(false);
    expect(shareReviewExpansionBoundary(previous, expandable({
      leadingContextStartLine: 30,
      leadingContextLines: ['30\n']
    }))).toBe(false);
  });

  it('activates expansion from Enter and Space only', () => {
    expect(isReviewExpansionKey('Enter')).toBe(true);
    expect(isReviewExpansionKey(' ')).toBe(true);
    expect(isReviewExpansionKey('ArrowDown')).toBe(false);
  });

  it('uses the clicked control direction before separator position', () => {
    expect(resolveReviewExpansionDirection({
      expandUp: true,
      expandDown: false,
      separatorFirst: true,
      separatorLast: false
    })).toBe('up');
    expect(resolveReviewExpansionDirection({
      expandUp: false,
      expandDown: true,
      separatorFirst: false,
      separatorLast: true
    })).toBe('down');
    expect(resolveReviewExpansionDirection({
      expandUp: false,
      expandDown: false,
      separatorFirst: true,
      separatorLast: false
    })).toBe('down');
  });
});

function expandable(
  overrides: Partial<ExpandableReviewDiff>
): ExpandableReviewDiff {
  return {
    fileDiff: {} as ExpandableReviewDiff['fileDiff'],
    leadingContextLines: [],
    trailingContextLines: [],
    leadingContextStartLine: 1,
    trailingContextStartLine: 1,
    syntaxNodes: [],
    ...overrides
  };
}
