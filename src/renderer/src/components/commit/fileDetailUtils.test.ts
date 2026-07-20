import { describe, expect, it } from 'vitest';

import { createDiffRequest, fileChangeIconKind, findAdjacentFilePath } from './fileDetailUtils';
import type { CommitGraphRow, GitFileChangeDetail } from '@shared/types';

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

describe('createDiffRequest', () => {
  it('requests the combined diff for a multi-commit selection', () => {
    const selectedFile = { ...file('src/app.ts'), originalPath: 'src/old-app.ts' };

    expect(createDiffRequest(commitRow('newest'), selectedFile, 'unstaged', ['newest', 'older'])).toEqual({
      kind: 'selection',
      shas: ['newest', 'older'],
      path: 'src/app.ts',
      originalPath: 'src/old-app.ts'
    });
  });
});

describe('fileChangeIconKind', () => {
  it.each([
    ['modified', 'modified'],
    ['conflicted', 'modified'],
    ['added', 'added'],
    ['untracked', 'added'],
    ['deleted', 'deleted'],
    ['renamed', 'renamed'],
    ['copied', 'renamed']
  ] as const)('maps %s files to the %s header icon', (status, iconKind) => {
    expect(fileChangeIconKind(status)).toBe(iconKind);
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

function commitRow(sha: string): CommitGraphRow {
  return {
    sha,
    parentShas: [],
    subject: sha,
    author: { name: 'Test', initials: 'T', color: '#ffffff' },
    dateLabel: 'now',
    node: { lane: 0, kind: 'commit' },
    rails: [],
    files: []
  };
}
