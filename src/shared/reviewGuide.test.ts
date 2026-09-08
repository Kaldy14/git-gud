import { describe, expect, it } from 'vitest';
import { reviewGuidePatchAddsLine, reviewGuidePatchChangesRange } from './reviewGuide';

describe('review guide line anchors', () => {
  it('keeps deleted and added ranges on their own side and within one hunk', () => {
    const patch = '@@ -3,2 +3,2 @@\n-old\n+new\n context\n@@ -20 +20 @@\n-before\n+after\n';
    expect(reviewGuidePatchChangesRange(patch, 3, 3, 'left')).toBe(true);
    expect(reviewGuidePatchChangesRange(patch, 3, 20, 'right')).toBe(false);
    expect(reviewGuidePatchChangesRange(patch, 4, 4, 'right')).toBe(false);
  });
  it('recognizes increment expressions inside a hunk without treating file headers as code', () => {
    const patch = '--- a/counter.ts\n+++ b/counter.ts\n@@ -1,2 +1,3 @@\n let counter = 0;\n+++counter;\n use(counter);';
    expect(reviewGuidePatchAddsLine(patch, 2)).toBe(true);
    expect(reviewGuidePatchAddsLine(patch, 1)).toBe(false);
    expect(reviewGuidePatchAddsLine(patch, 3)).toBe(false);
  });
});
