import { describe, expect, it } from 'vitest';
import { reviewGuidePatchAddsLine, reviewGuidePatchChangesRange, reviewGuidePatchContainsLine, reviewGuidePatchLines } from './reviewGuide';

describe('review guide line anchors', () => {
  it('keeps deleted and added ranges on their own side and within one hunk', () => {
    const patch = '@@ -3,2 +3,2 @@\n-old\n+new\n context\n@@ -20 +20 @@\n-before\n+after\n';
    expect(reviewGuidePatchChangesRange(patch, 3, 3, 'left')).toBe(true);
    expect(reviewGuidePatchChangesRange(patch, 3, 20, 'right')).toBe(false);
    expect(reviewGuidePatchChangesRange(patch, 4, 4, 'right')).toBe(false);
    expect(reviewGuidePatchChangesRange(patch, 3, 4, 'right')).toBe(true);
    expect(reviewGuidePatchContainsLine(patch, 4, 'right')).toBe(true);
    expect(reviewGuidePatchContainsLine(patch, 5, 'right')).toBe(false);
  });
  it('keeps coordinates on their own side and ignores no-newline markers and trailing empty rows', () => {
    const patch = '@@ -8,2 +8 @@\n-heading\n-removed\n+replacement\n\\ No newline at end of file\n';
    expect(reviewGuidePatchLines(patch)).toEqual([
      { hunk: 1, left: 8, text: '-heading' },
      { hunk: 1, left: 9, text: '-removed' },
      { hunk: 1, right: 8, text: '+replacement' }
    ]);
    expect(reviewGuidePatchContainsLine(patch, 9, 'right')).toBe(false);
    expect(reviewGuidePatchChangesRange(patch, 8, 9, 'right')).toBe(false);
  });
  it('recognizes increment expressions inside a hunk without treating file headers as code', () => {
    const patch = '--- a/counter.ts\n+++ b/counter.ts\n@@ -1,2 +1,3 @@\n let counter = 0;\n+++counter;\n use(counter);';
    expect(reviewGuidePatchAddsLine(patch, 2)).toBe(true);
    expect(reviewGuidePatchAddsLine(patch, 1)).toBe(false);
    expect(reviewGuidePatchAddsLine(patch, 3)).toBe(false);
  });
});
