import { describe, expect, it } from 'vitest';

import type { GitFileChange } from '@shared/types';
import { machineFileGroups } from './machineFiles';

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
