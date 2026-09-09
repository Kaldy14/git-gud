import { describe, expect, it } from 'vitest';
import { parsePatchFiles } from '@pierre/diffs';
import { bugFinderPatch } from './bugFinderPatch';

describe('bug finder patch context', () => {
  const patch = 'diff --git a/old.ts b/new.ts\n--- a/old.ts\n+++ b/new.ts\n@@ -1 +1 @@\n-old\n+new\n@@ -20,2 +20,2 @@\n-const before = 1;\n+const after = 2;\n context\n';
  it('passes only the finding hunk to the PR renderer with original paths and coordinates', () => {
    for (const side of ['left', 'right'] as const) {
      const selected = bugFinderPatch(patch, { path: 'new.ts', side, line: 20, endLine: 20 })!;
      expect(selected).toContain('--- a/old.ts\n+++ b/new.ts');
      expect(selected).not.toContain('@@ -1 +1 @@');
      expect(selected).toContain('@@ -20,2 +20,2 @@');
      const diff = parsePatchFiles(selected)[0]!.files[0]!;
      expect(diff.hunks).toHaveLength(1);
      expect(diff.name).toBe('new.ts');
    }
  });
  it('does not show unrelated code when the finding line is absent', () => {
    expect(bugFinderPatch(patch, { path: 'new.ts', side: 'right', line: 100, endLine: 100 })).toBeUndefined();
  });
});
