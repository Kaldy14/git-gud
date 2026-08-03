import { describe, expect, it } from 'vitest';

import type { ExpandableReviewDiff } from './reviewContextDiff';
import {
  createReviewContextOptions,
  isReviewExpansionKey
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
    expect(options.unsafeCSS).toMatch(/border:\s*1px solid var\(--select-border\)/);
    expect(options.unsafeCSS).toMatch(/background:\s*var\(--select-bg\)/);
    expect(options.unsafeCSS).toContain(':focus-visible');
  });

  it('hides only the leading separator for a continuation chunk', () => {
    const options = createReviewContextOptions(
      {},
      {} as ExpandableReviewDiff,
      'src/example.ts',
      true
    );

    expect(options.unsafeCSS).toContain(
      '[data-separator="line-info"][data-separator-first] { display: none; }'
    );
    expect(options.unsafeCSS).not.toContain('[data-separator-last] { display: none; }');
  });

  it('activates expansion from Enter and Space only', () => {
    expect(isReviewExpansionKey('Enter')).toBe(true);
    expect(isReviewExpansionKey(' ')).toBe(true);
    expect(isReviewExpansionKey('ArrowDown')).toBe(false);
  });
});
