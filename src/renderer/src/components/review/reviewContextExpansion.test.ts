import { describe, expect, it } from 'vitest';

import type { ExpandableReviewDiff } from './reviewContextDiff';
import { createReviewContextOptions } from './reviewContextExpansion';

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
  });
});
