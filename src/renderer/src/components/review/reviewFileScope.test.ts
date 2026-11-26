import { describe, expect, it } from 'vitest';

import type { GitReviewChunk, GitReviewUnit } from '@shared/types';

import {
  buildReviewFileTree,
  compareReviewTreePaths,
  createReviewFileScope,
  estimateReviewChunkHeight,
  filterReviewFiles,
  reviewPanelSize,
  visibleReviewTreeRows
} from './reviewFileScope';

function chunk(id: string, path: string, startLine: number, overrides: Partial<GitReviewChunk> = {}): GitReviewChunk {
  return {
    id, path, startLine, patch: `@@ -${startLine},1 +${startLine},2 @@\n context\n+added\n`, header: '', additions: 1, deletions: 0,
    role: 'anchor', relationship: '', reviewSection: 'implementation', category: 'source', changeType: 'modified',
    contentKind: 'code', source: 'commit', ...overrides
  };
}

function unit(id: string, chunks: GitReviewChunk[]): GitReviewUnit {
  return { id, title: id, reason: '', explanation: '', confidence: 'exact', chunks };
}

const units = [
  unit('one', [chunk('a2', 'src/a.ts', 40), chunk('b1', 'src/lib/b.ts', 1)]),
  unit('two', [chunk('a1', 'src/a.ts', 3), chunk('readme', 'README.md', 1)]),
  unit('three', [chunk('test', 'src/a.test.ts', 1, { additions: 4, deletions: 2 })])
];
const all = new Set(units.flatMap((item) => item.chunks.map((entry) => entry.id)));

describe('createReviewFileScope', () => {
  it('merges each file\'s hunks across units, ordered by line, in tree order', () => {
    const files = createReviewFileScope({ units, visibleChunkIds: all, reviewedChunkIds: new Set() });

    expect(files.map((file) => file.path)).toEqual(['src/lib/b.ts', 'src/a.test.ts', 'src/a.ts', 'README.md']);
    expect(files.find((file) => file.path === 'src/a.ts')?.chunks.map((entry) => entry.id)).toEqual(['a1', 'a2']);
    expect(files.find((file) => file.path === 'src/a.test.ts')).toMatchObject({ additions: 4, deletions: 2 });
  });

  it('keeps hidden files listed and never counts them viewed', () => {
    const visible = new Set([...all].filter((id) => id !== 'test'));
    const files = createReviewFileScope({ units, visibleChunkIds: visible, reviewedChunkIds: new Set(['test', 'a1']) });

    expect(files.find((file) => file.path === 'src/a.test.ts')).toMatchObject({ hidden: true, viewed: false });
    expect(files.find((file) => file.path === 'src/a.ts')).toMatchObject({ hidden: false, viewed: false });
  });

  it('marks a file viewed only when every visible hunk is viewed', () => {
    const visible = new Set([...all].filter((id) => id !== 'a2'));
    const files = createReviewFileScope({ units, visibleChunkIds: visible, reviewedChunkIds: new Set(['a1']) });

    expect(files.find((file) => file.path === 'src/a.ts')).toMatchObject({ viewed: true, hidden: false });
    expect(files.find((file) => file.path === 'src/a.ts')?.chunks.map((entry) => entry.id)).toEqual(['a1']);
    // The filtered hunk stays reachable: a jump to one of its lines reveals the file.
    expect(files.find((file) => file.path === 'src/a.ts')?.filteredChunks.map((entry) => entry.id)).toEqual(['a2']);
  });

  it('shows exactly the requested paths in their order, ignoring filters', () => {
    const files = createReviewFileScope({
      units, visibleChunkIds: new Set(), reviewedChunkIds: new Set(), paths: ['README.md', 'missing.ts', 'src/a.ts', 'README.md']
    });

    expect(files.map((file) => [file.path, file.hidden, file.chunks.length])).toEqual([['README.md', false, 1], ['src/a.ts', false, 2]]);
  });
});

describe('compareReviewTreePaths', () => {
  it('puts directories before files at each level and orders numbers naturally', () => {
    expect(['b.ts', 'a/z.ts', 'file10.ts', 'file2.ts', 'a/b/c.ts'].sort(compareReviewTreePaths))
      .toEqual(['a/b/c.ts', 'a/z.ts', 'b.ts', 'file2.ts', 'file10.ts']);
  });
});

describe('review file tree', () => {
  const files = createReviewFileScope({ units, visibleChunkIds: all, reviewedChunkIds: new Set() });

  it('compresses single-child directory chains', () => {
    const tree = buildReviewFileTree(files);

    expect(tree.map((node) => node.name)).toEqual(['src', 'README.md']);
    const single = buildReviewFileTree(files.filter((file) => file.path === 'src/lib/b.ts'));
    expect(single[0]).toMatchObject({ kind: 'directory', name: 'src/lib' });
  });

  it('filters by path terms and lists rows under open directories only', () => {
    const tree = buildReviewFileTree(filterReviewFiles(files, 'SRC a.'));
    const rows = visibleReviewTreeRows(tree, new Set());

    expect(rows.map((row) => row.name)).toEqual(['src', 'a.test.ts', 'a.ts']);
    expect(visibleReviewTreeRows(tree, new Set(['dir:src'])).map((row) => row.name)).toEqual(['src']);
    // Chains compress again after filtering.
    expect(buildReviewFileTree(filterReviewFiles(files, 'lib'))[0]).toMatchObject({ name: 'src/lib' });
  });
});

describe('estimateReviewChunkHeight', () => {
  it('counts patch rows plus the hunk chrome', () => {
    expect(estimateReviewChunkHeight(chunk('x', 'x.ts', 1), 20, 30)).toBe(2 * 20 + 30);
  });
});

describe('reviewPanelSize', () => {
  it('remembers the Tour panel apart from the files panel, wider by default, under the same limits', () => {
    const files = reviewPanelSize('github://github.com/o/r', 'files');
    const side = reviewPanelSize('github://github.com/o/r', 'side');
    expect(files.storageKey).toBe('git-gud:review-files-panel-width:v1:github%3A%2F%2Fgithub.com%2Fo%2Fr');
    expect(side.storageKey).not.toBe(files.storageKey);
    expect([files.defaultWidth, side.defaultWidth]).toEqual([300, 340]);
    expect({ ...side, storageKey: '', defaultWidth: 0 }).toEqual({ ...files, storageKey: '', defaultWidth: 0 });
  });
});
