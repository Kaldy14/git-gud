import { describe, expect, it } from 'vitest';

import type { GitReviewChunk, GitReviewUnit } from '@shared/types';

import {
  createReviewFileTreeEntries,
  DEFAULT_REVIEW_FILE_TREE_WIDTH,
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
        chunk('src/api.ts', 'modified'),
        chunk('src/new.ts', 'added')
      ]),
      visibleUnit('tests', [
        chunk('src/api.ts', 'modified'),
        { ...chunk('src/current.ts', 'modified'), originalPath: 'src/legacy.ts' }
      ])
    ];

    expect(createReviewFileTreeEntries(units)).toEqual([
      { path: 'src/api.ts', status: 'modified' },
      { path: 'src/new.ts', status: 'added' },
      { path: 'src/current.ts', status: 'renamed' }
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
  changeType: GitReviewChunk['changeType']
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
    contentKind: 'code',
    source: 'commit'
  };
}
