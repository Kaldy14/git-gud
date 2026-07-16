import { describe, expect, it } from 'vitest';

import type { GitReviewChunk, GitReviewPlan, GitReviewUnit } from '@shared/types';

import {
  createReviewPresentation,
  DEFAULT_REVIEW_PREFERENCES,
  loadReviewPreferences,
  matchesReviewFilePattern,
  parseReviewFilePatterns,
  saveReviewPreferences
} from './reviewFilters';

describe('review filters and progress', () => {
  it('skips tests by default without counting them as viewed', () => {
    const plan = reviewPlan([
      unit('timeout', [chunk('source', 'modified'), chunk('test', 'modified')]),
      unit('cleanup', [chunk('source', 'deleted')])
    ]);
    const presentation = createReviewPresentation(plan, DEFAULT_REVIEW_PREFERENCES, new Set());

    expect(presentation).toMatchObject({
      totalCount: 3,
      viewedCount: 0,
      skippedCount: 1,
      pendingCount: 2
    });
    expect(presentation.units[0]).toMatchObject({ skippedCount: 1, isViewed: false });
  });

  it('skips deletion-only chunks while retaining mixed changes', () => {
    const plan = reviewPlan([
      unit('cleanup', [chunk('source', 'deleted'), chunk('source', 'modified')])
    ]);
    const presentation = createReviewPresentation(
      plan,
      { ...DEFAULT_REVIEW_PREFERENCES, skipTests: false, skipDeletions: true },
      new Set()
    );

    expect(presentation).toMatchObject({ skippedCount: 1, pendingCount: 1 });
    expect(presentation.units[0]?.visibleChunks[0]?.changeType).toBe('modified');
  });

  it('skips import-only chunks while retaining code from mixed hunks', () => {
    const plan = reviewPlan([
      unit('imports', [chunk('source', 'modified', 'imports')]),
      unit('mixed', [chunk('source', 'modified', 'code')])
    ]);
    const presentation = createReviewPresentation(
      plan,
      { ...DEFAULT_REVIEW_PREFERENCES, skipTests: false, skipImports: true },
      new Set()
    );

    expect(presentation).toMatchObject({ skippedCount: 1, pendingCount: 1 });
    expect(presentation.units[0]?.visibleChunks[0]?.contentKind).toBe('code');
  });

  it('skips generated chunks by default while retaining their source context', () => {
    const plan = reviewPlan([
      unit('sdk', [
        chunk('source', 'modified', 'code', 'src/service.ts'),
        chunk('source', 'modified', 'code', 'src/generated/sdk.ts', 'generated')
      ])
    ]);
    const presentation = createReviewPresentation(plan, DEFAULT_REVIEW_PREFERENCES, new Set());

    expect(presentation).toMatchObject({ totalCount: 2, skippedCount: 1, pendingCount: 1 });
    expect(presentation.units[0]?.visibleChunks[0]?.path).toBe('src/service.ts');
  });

  it('derives viewed units from the visible chunks only', () => {
    const sourceChunk = chunk('source', 'modified');
    const testChunk = chunk('test', 'modified');
    const plan = reviewPlan([unit('timeout', [sourceChunk, testChunk])]);
    const presentation = createReviewPresentation(
      plan,
      DEFAULT_REVIEW_PREFERENCES,
      new Set([sourceChunk.id])
    );

    expect(presentation).toMatchObject({ viewedCount: 1, skippedCount: 1, pendingCount: 0 });
    expect(presentation.units[0]?.isViewed).toBe(true);
  });

  it('skips repository paths that match configured glob patterns', () => {
    const plan = reviewPlan([
      unit('generated', [
        chunk('source', 'modified', 'code', 'src/generated/client.ts'),
        chunk('source', 'modified', 'code', 'src/generator/client.ts'),
        chunk('source', 'modified', 'code', 'snapshots/client.snap')
      ])
    ]);
    const presentation = createReviewPresentation(
      plan,
      {
        ...DEFAULT_REVIEW_PREFERENCES,
        skipTests: false,
        skipFilePatterns: true,
        filePatterns: ['src/generated/**', '*.snap']
      },
      new Set()
    );

    expect(presentation).toMatchObject({ totalCount: 3, skippedCount: 2, pendingCount: 1 });
    expect(presentation.units[0]?.visibleChunks[0]?.path).toBe('src/generator/client.ts');
  });

  it('keeps every review filter independently switchable', () => {
    const cases: Array<[keyof Pick<
      typeof DEFAULT_REVIEW_PREFERENCES,
      'skipTests' | 'skipImports' | 'skipGenerated' | 'skipDeletions' | 'skipFilePatterns'
    >, GitReviewChunk]> = [
      ['skipTests', chunk('test', 'modified')],
      ['skipImports', chunk('source', 'modified', 'imports')],
      ['skipGenerated', chunk('source', 'modified', 'code', 'src/gql/sdk.ts', 'generated')],
      ['skipDeletions', chunk('source', 'deleted')],
      ['skipFilePatterns', chunk('source', 'modified', 'code', 'dist/client.js')]
    ];
    const plan = reviewPlan(cases.map(([key, reviewChunk]) => unit(key, [reviewChunk])));

    for (const [enabledKey] of cases) {
      const preferences = {
        ...DEFAULT_REVIEW_PREFERENCES,
        skipTests: false,
        skipImports: false,
        skipGenerated: false,
        skipDeletions: false,
        skipFilePatterns: false,
        filePatterns: ['dist/**'],
        [enabledKey]: true
      };
      const presentation = createReviewPresentation(plan, preferences, new Set());

      expect(presentation.skippedCount).toBe(1);
      expect(presentation.pendingCount).toBe(cases.length - 1);
    }
  });

  it('supports root, recursive, basename, and Windows-style patterns', () => {
    expect(matchesReviewFilePattern('dist/client.js', ['dist/'])).toBe(true);
    expect(matchesReviewFilePattern('client.generated.ts', ['**/*.generated.ts'])).toBe(true);
    expect(matchesReviewFilePattern('src/models/client.generated.ts', ['**/*.generated.ts'])).toBe(true);
    expect(matchesReviewFilePattern('src\\generated\\client.ts', ['src/generated/**'])).toBe(true);
    expect(matchesReviewFilePattern('src/generator/client.ts', ['src/generated/**'])).toBe(false);
  });

  it('normalizes line-based pattern input', () => {
    expect(parseReviewFilePatterns(' dist/**\n# generated files\n*.snap\n./dist/**\n')).toEqual([
      'dist/**',
      '*.snap'
    ]);
  });

  it('persists preferences independently per repository and repairs malformed values', () => {
    const stored = new Map<string, string>();
    const storage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => {
        stored.set(key, value);
      }
    };
    const repoAPreferences = {
      ...DEFAULT_REVIEW_PREFERENCES,
      skipTests: false,
      skipImports: true,
      skipGenerated: false,
      skipDeletions: true,
      skipFilePatterns: true,
      filePatterns: ['dist/**']
    };

    saveReviewPreferences(storage, '/repo-a', repoAPreferences);
    expect(loadReviewPreferences(storage, '/repo-a')).toEqual(repoAPreferences);
    expect(loadReviewPreferences(storage, '/repo-b')).toEqual(DEFAULT_REVIEW_PREFERENCES);

    saveReviewPreferences(storage, '/repo-b', DEFAULT_REVIEW_PREFERENCES);
    const repoBKey = [...stored.keys()].find((key) => key.includes(encodeURIComponent('/repo-b')));
    expect(repoBKey).toBeDefined();
    stored.set(repoBKey!, '{bad json');
    expect(loadReviewPreferences(storage, '/repo-b')).toEqual(DEFAULT_REVIEW_PREFERENCES);
  });

  it('uses legacy global preferences as the initial repository defaults', () => {
    const legacyPreferences = { skipTests: false, skipImports: true, skipDeletions: true };
    const storage = {
      getItem: (key: string) => key.endsWith(':v1') ? JSON.stringify(legacyPreferences) : null
    };

    expect(loadReviewPreferences(storage, '/repo')).toEqual({
      ...DEFAULT_REVIEW_PREFERENCES,
      ...legacyPreferences
    });
  });
});

function reviewPlan(units: GitReviewUnit[]): GitReviewPlan {
  return {
    repoPath: '/repo',
    target: { kind: 'commit', sha: 'abc123' },
    targetKey: 'commit:abc123',
    units,
    fileContexts: [],
    reviewedChunkIds: [],
    loadedAt: '2026-07-15T00:00:00.000Z'
  };
}

function unit(id: string, chunks: GitReviewChunk[]): GitReviewUnit {
  return {
    id,
    title: id,
    reason: 'related changes',
    explanation: 'Same changed file',
    confidence: 'context',
    chunks
  };
}

let chunkCounter = 0;

function chunk(
  category: GitReviewChunk['category'],
  changeType: GitReviewChunk['changeType'],
  contentKind: GitReviewChunk['contentKind'] = 'code',
  path = category === 'source' ? 'src/client.ts' : `src/client.${category}.ts`,
  reviewSection: GitReviewChunk['reviewSection'] = 'other'
): GitReviewChunk {
  chunkCounter += 1;
  return {
    id: chunkCounter.toString(16).padStart(64, '0'),
    path,
    patch: 'diff --git a/file b/file\n@@ -1 +1 @@\n-old\n+new\n',
    header: '@@ -1 +1 @@',
    startLine: 1,
    additions: 1,
    deletions: changeType === 'added' ? 0 : 1,
    role: 'related',
    relationship: 'Same changed file',
    reviewSection,
    category,
    changeType,
    contentKind,
    source: 'commit'
  };
}
