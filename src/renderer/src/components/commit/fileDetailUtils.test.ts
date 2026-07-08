import { describe, expect, it } from 'vitest';

import { findAdjacentFilePath } from './fileDetailUtils';
import type { GitFileChangeDetail } from '@shared/types';

describe('findAdjacentFilePath', () => {
  const files = [
    file('apps/admin/src/a.ts'),
    file('apps/admin/src/b.ts'),
    file('apps/admin/src/c.ts')
  ];

  it('finds the next file', () => {
    expect(findAdjacentFilePath(files, 'apps/admin/src/a.ts', 1)).toBe('apps/admin/src/b.ts');
  });

  it('finds the previous file', () => {
    expect(findAdjacentFilePath(files, 'apps/admin/src/c.ts', -1)).toBe('apps/admin/src/b.ts');
  });

  it('returns undefined at list edges', () => {
    expect(findAdjacentFilePath(files, 'apps/admin/src/a.ts', -1)).toBeUndefined();
    expect(findAdjacentFilePath(files, 'apps/admin/src/c.ts', 1)).toBeUndefined();
  });

  it('falls back to the nearest edge when the selection is missing', () => {
    expect(findAdjacentFilePath(files, undefined, 1)).toBe('apps/admin/src/a.ts');
    expect(findAdjacentFilePath(files, 'apps/admin/src/missing.ts', -1)).toBe('apps/admin/src/c.ts');
  });
});

function file(path: string): GitFileChangeDetail {
  return {
    path,
    status: 'modified',
    staged: false,
    unstaged: false,
    conflicted: false
  };
}
