import { describe, expect, it } from 'vitest';

import {
  buildChangedFileTree,
  createDiffOptionsBase,
  createDiffRequest,
  expandFileTreePathAncestors,
  fileChangeIconKind,
  fileTreeAncestorPaths,
  findAdjacentFilePath,
  toggleFileTreePath
} from './fileDetailUtils';
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

describe('buildChangedFileTree', () => {
  it('keeps every directory segment and groups directories before files', () => {
    const tree = buildChangedFileTree([
      file('README.md'),
      file('apps/storefront/src/index.ts'),
      file('apps/brand-store/src/components/checkout/checkout-wizard.tsx')
    ]);

    expect(tree.map((node) => [node.kind, node.path])).toEqual([
      ['directory', 'apps'],
      ['file', 'README.md']
    ]);

    const apps = tree[0];
    expect(apps?.kind).toBe('directory');

    if (apps?.kind !== 'directory') {
      throw new Error('Expected apps directory.');
    }

    expect(apps.children.map((node) => node.path)).toEqual([
      'apps/brand-store',
      'apps/storefront'
    ]);

    const brandStore = apps.children[0];
    expect(brandStore?.kind === 'directory' ? brandStore.children[0]?.path : undefined).toBe('apps/brand-store/src');
  });

  it('aggregates change counts for collapsed directory summaries', () => {
    const tree = buildChangedFileTree([
      file('apps/storefront/src/modified.ts'),
      { ...file('apps/storefront/src/added.ts'), status: 'added' },
      { ...file('apps/storefront/src/deleted.ts'), status: 'deleted' }
    ]);

    expect(tree[0]).toMatchObject({
      kind: 'directory',
      path: 'apps',
      counts: {
        modified: 1,
        added: 1,
        deleted: 1,
        renamed: 0,
        conflicted: 0
      }
    });
  });
});

describe('fileTreeAncestorPaths', () => {
  it('returns every parent path without the file itself', () => {
    expect(fileTreeAncestorPaths('apps/storefront/src/index.ts')).toEqual([
      'apps',
      'apps/storefront',
      'apps/storefront/src'
    ]);
  });

  it('allows a selected ancestor to collapse and expand again', () => {
    const selectedPath = 'apps/storefront/src/index.ts';
    const initial = new Set(fileTreeAncestorPaths(selectedPath));
    const collapsed = toggleFileTreePath(initial, 'apps/storefront');

    expect(collapsed.has('apps/storefront')).toBe(false);
    expect(toggleFileTreePath(collapsed, 'apps/storefront').has('apps/storefront')).toBe(true);
  });

  it('reveals a newly selected file without discarding manual expansion', () => {
    const expanded = new Set(['packages', 'packages/api']);
    const next = expandFileTreePathAncestors(expanded, 'apps/storefront/src/index.ts');

    expect([...next]).toEqual([
      'packages',
      'packages/api',
      'apps',
      'apps/storefront',
      'apps/storefront/src'
    ]);
  });
});

describe('createDiffOptionsBase', () => {
  it('uses the selected bundled Shiki theme for file diffs', () => {
    expect(createDiffOptionsBase('git-gud-dark')).toMatchObject({
      theme: 'dark-plus',
      themeType: 'dark'
    });
    expect(createDiffOptionsBase('tokyo-night-storm')).toMatchObject({
      theme: 'tokyo-night',
      themeType: 'dark'
    });
    expect(createDiffOptionsBase('git-gud-dark')).not.toHaveProperty('unsafeCSS');
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
