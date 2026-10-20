import { describe, expect, it } from 'vitest';

import type { GitFileChange } from '@shared/types';
import { machineFileGroups, selectMachineFileDiff } from './machineFiles';

describe('machine file groups', () => {
  it('keeps unmerged files selectable even though Git marks neither side staged nor unstaged', () => {
    const conflicted: GitFileChange = {
      path: 'conflicted.txt', status: 'conflicted', indexStatus: 'conflicted', worktreeStatus: 'conflicted',
      conflicted: true, staged: false, unstaged: false
    };
    expect(machineFileGroups([conflicted])).toEqual([
      { label: 'Conflicted', staged: false, untracked: false, files: [conflicted] }
    ]);
  });
});

it('selects a copied file without rendering a separate modification to its source', () => {
  const patch = [
    'diff --git a/old.txt b/old.txt', 'index 1111111..2222222 100644', '--- a/old.txt', '+++ b/old.txt',
    '@@ -1 +1 @@', '-original', '+modified',
    'diff --git a/old.txt b/new.txt', 'similarity index 100%', 'copy from old.txt', 'copy to new.txt', ''
  ].join('\n');
  expect(selectMachineFileDiff(patch, 'new.txt')).toMatchObject({ name: 'new.txt', prevName: 'old.txt' });
  expect(selectMachineFileDiff(patch, 'missing.txt')).toBeUndefined();
});

it.each([
  { path: 'café.txt', encoded: String.raw`caf\303\251.txt` },
  { path: 'tab\tquote".txt', encoded: String.raw`tab\tquote\".txt` },
  { path: 'line\nfeed.txt', encoded: String.raw`line\nfeed.txt` },
  { path: 'literal\\t.txt', encoded: String.raw`literal\\t.txt` }
])('matches Git-quoted patch names for $encoded', ({ path, encoded }) => {
  const patch = [
    `diff --git "a/${encoded}" "b/${encoded}"`, 'new file mode 100644',
    '--- /dev/null', `+++ "b/${encoded}"`, '@@ -0,0 +1 @@', '+content', ''
  ].join('\n');
  expect(selectMachineFileDiff(patch, path)?.name).toBe(path);
});

it('decodes the quoted source and destination of a pure rename', () => {
  const patch = [
    'diff --git "a/old\\t.txt" "b/new\\t.txt"', 'similarity index 100%',
    'rename from "old\\t.txt"', 'rename to "new\\t.txt"', ''
  ].join('\n');
  expect(selectMachineFileDiff(patch, 'new\t.txt')).toMatchObject({ name: 'new\t.txt', prevName: 'old\t.txt' });
});
