import { describe, expect, it } from 'vitest';

import type { GitReviewChunk, GitReviewUnit } from '@shared/types';

import {
  createReviewFileTreeEntries,
  DEFAULT_REVIEW_FILE_TREE_WIDTH,
  findAdjacentReviewFilePath,
  findReviewUnitIdForPath,
  loadReviewFileTreeOpen,
  loadReviewFileTreeWidth,
  MAX_REVIEW_FILE_TREE_WIDTH,
  MIN_REVIEW_FILE_TREE_WIDTH,
  normalizeReviewFileTreeWidth,
  saveReviewFileTreeOpen,
  saveReviewFileTreeWidth
} from './reviewFileTree';
import type { VisibleReviewUnit } from './reviewFilters';

describe('review file tree', () => {
  it('deduplicates visible files and preserves their git status', () => {
    const units = [
      visibleUnit('api', [
        chunk('src/api.ts', 'modified', 'modified'),
        chunk('src/new.ts', 'added', 'added')
      ]),
      visibleUnit('tests', [
        chunk('src/api.ts', 'modified', 'modified'),
        { ...chunk('src/current.ts', 'modified', 'renamed'), originalPath: 'src/legacy.ts' }
      ])
    ];

    expect(createReviewFileTreeEntries(units)).toEqual([
      { path: 'src/api.ts', status: 'modified' },
      { path: 'src/new.ts', status: 'added' },
      { path: 'src/current.ts', status: 'renamed' }
    ]);
  });

  it('uses the file status when a modified file contains a deletion-only chunk', () => {
    const units = [
      visibleUnit('cleanup', [
        chunk('src/cleanup.ts', 'deleted', 'modified'),
        chunk('src/removed.ts', 'deleted', 'deleted')
      ])
    ];

    expect(createReviewFileTreeEntries(units)).toEqual([
      { path: 'src/cleanup.ts', status: 'modified' },
      { path: 'src/removed.ts', status: 'deleted' }
    ]);
  });

  it('presents an untracked review file as added', () => {
    const units = [
      visibleUnit('new file', [chunk('src/new.ts', 'added', 'untracked')])
    ];

    expect(createReviewFileTreeEntries(units)).toEqual([
      { path: 'src/new.ts', status: 'added' }
    ]);
  });

  it('finds the review group that owns a selected file', () => {
    const units = [
      visibleUnit('api', [chunk('src/api.ts', 'modified')]),
      visibleUnit('tests', [chunk('src/api.test.ts', 'added')])
    ];

    expect(findReviewUnitIdForPath(units, 'src/api.test.ts')).toBe('tests');
    expect(findReviewUnitIdForPath(units, 'README.md')).toBeUndefined();
  });

  it('moves between unique files inside a review group', () => {
    const chunks = [
      chunk('src/api.ts', 'modified'),
      { ...chunk('src/api.ts', 'modified'), id: 'src/api.ts:second' },
      chunk('src/api.test.ts', 'added')
    ];

    expect(findAdjacentReviewFilePath(chunks, 'src/api.ts', 1)).toBe(
      'src/api.test.ts'
    );
    expect(findAdjacentReviewFilePath(chunks, 'src/api.test.ts', -1)).toBe(
      'src/api.ts'
    );
    expect(findAdjacentReviewFilePath(chunks, 'src/api.test.ts', 1)).toBeUndefined();
    expect(findAdjacentReviewFilePath(chunks, 'src/api.ts', -1)).toBeUndefined();
  });

  it('chooses an edge file when no file is selected', () => {
    const chunks = [
      chunk('src/api.ts', 'modified'),
      chunk('src/api.test.ts', 'added')
    ];

    expect(findAdjacentReviewFilePath(chunks, undefined, 1)).toBe('src/api.ts');
    expect(findAdjacentReviewFilePath(chunks, undefined, -1)).toBe(
      'src/api.test.ts'
    );
    expect(findAdjacentReviewFilePath([], undefined, 1)).toBeUndefined();
  });

  it('defaults to open and persists hidden state per repository', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    };

    expect(loadReviewFileTreeOpen(storage, '/repo/one')).toBe(true);

    saveReviewFileTreeOpen(storage, '/repo/one', false);

    expect(loadReviewFileTreeOpen(storage, '/repo/one')).toBe(false);
    expect(loadReviewFileTreeOpen(storage, '/repo/two')).toBe(true);
  });

  it('persists a normalized width per repository', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    };

    expect(loadReviewFileTreeWidth(storage, '/repo/one')).toBe(
      DEFAULT_REVIEW_FILE_TREE_WIDTH
    );

    saveReviewFileTreeWidth(storage, '/repo/one', 347.6);

    expect(loadReviewFileTreeWidth(storage, '/repo/one')).toBe(348);
    expect(loadReviewFileTreeWidth(storage, '/repo/two')).toBe(
      DEFAULT_REVIEW_FILE_TREE_WIDTH
    );
  });

  it('clamps stored widths and ignores invalid values', () => {
    const values = new Map<string, string>([
      ['git-gud:review-file-tree-width:v1:%2Frepo%2Fsmall', '20'],
      ['git-gud:review-file-tree-width:v1:%2Frepo%2Flarge', '900'],
      ['git-gud:review-file-tree-width:v1:%2Frepo%2Finvalid', 'wide']
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null
    };

    expect(normalizeReviewFileTreeWidth(20)).toBe(MIN_REVIEW_FILE_TREE_WIDTH);
    expect(normalizeReviewFileTreeWidth(900)).toBe(MAX_REVIEW_FILE_TREE_WIDTH);
    expect(loadReviewFileTreeWidth(storage, '/repo/small')).toBe(
      MIN_REVIEW_FILE_TREE_WIDTH
    );
    expect(loadReviewFileTreeWidth(storage, '/repo/large')).toBe(
      MAX_REVIEW_FILE_TREE_WIDTH
    );
    expect(loadReviewFileTreeWidth(storage, '/repo/invalid')).toBe(
      DEFAULT_REVIEW_FILE_TREE_WIDTH
    );
  });
});

function visibleUnit(id: string, chunks: GitReviewChunk[]): VisibleReviewUnit {
  const unit: GitReviewUnit = {
    id,
    title: id,
    reason: id,
    explanation: id,
    confidence: 'strong',
    chunks
  };

  return {
    unit,
    visibleChunks: chunks,
    skippedCount: 0,
    isViewed: false
  };
}

function chunk(
  path: string,
  changeType: GitReviewChunk['changeType'],
  fileStatus?: GitReviewChunk['fileStatus']
): GitReviewChunk {
  return {
    id: `${path}:${changeType}`,
    path,
    patch: '',
    header: '',
    startLine: 1,
    additions: changeType === 'deleted' ? 0 : 1,
    deletions: changeType === 'added' ? 0 : 1,
    role: 'anchor',
    relationship: 'Primary change',
    reviewSection: 'implementation',
    category: 'source',
    changeType,
    fileStatus,
    contentKind: 'code',
    source: 'commit'
  };
}
