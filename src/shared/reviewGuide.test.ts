import { describe, expect, it } from 'vitest';
import { reviewGuidePatchAddsLine } from './reviewGuide';

describe('review guide line anchors', () => {
  it('recognizes increment expressions inside a hunk without treating file headers as code', () => {
    const patch = '--- a/counter.ts\n+++ b/counter.ts\n@@ -1,2 +1,3 @@\n let counter = 0;\n+++counter;\n use(counter);';
    expect(reviewGuidePatchAddsLine(patch, 2)).toBe(true);
    expect(reviewGuidePatchAddsLine(patch, 1)).toBe(false);
    expect(reviewGuidePatchAddsLine(patch, 3)).toBe(false);
  });
});
