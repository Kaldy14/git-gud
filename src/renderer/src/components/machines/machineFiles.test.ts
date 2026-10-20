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
