import { describe, expect, it } from 'vitest';

import type { GitReviewChunk, GitReviewFileContext } from '@shared/types';

import {
  createExpandableReviewDiff,
  getSmartExpansionLineCount,
  getSyntaxExpansionLineCount,
  prepareReviewDiff
} from './reviewContextDiff';

describe('review context diffs', () => {
  it('isolates a review hunk and bounds expansion at neighboring changes', () => {
    const oldContents = numberedLines(24);
    const newContents = oldContents
      .replace('line 5\n', 'line five\n')
      .replace('line 18\n', 'line eighteen\n');
    const chunk = reviewChunk(
      '@@ -15,7 +15,7 @@\n line 15\n line 16\n line 17\n-line 18\n+line eighteen\n line 19\n line 20\n line 21\n'
    );
    const context: GitReviewFileContext = {
      id: 'context-1',
      path: chunk.path,
      source: 'commit',
      oldContents,
      newContents
    };

    const result = createExpandableReviewDiff(chunk, context);

    expect(result?.fileDiff.isPartial).toBe(false);
    expect(result?.fileDiff.hunks).toHaveLength(1);
    expect(result?.fileDiff.hunks[0]).toMatchObject({
      additionStart: 15,
      deletionStart: 15,
      collapsedBefore: 6,
      additionLineIndex: 6,
      deletionLineIndex: 6
    });
    expect(result?.leadingContextLines).toEqual([
      'line 9\n',
      'line 10\n',
      'line 11\n',
      'line 12\n',
      'line 13\n',
      'line 14\n'
    ]);
    expect(result?.trailingContextLines).toEqual(['line 22\n', 'line 23\n', 'line 24\n']);
    expect(result?.fileDiff.additionLines.join('')).not.toContain('line five');
  });

  it('falls back when the chunk cannot be matched to the supplied file versions', () => {
    const chunk = reviewChunk('@@ -2 +2 @@\n-old\n+new\n');
    const context: GitReviewFileContext = {
      id: 'context-1',
      path: chunk.path,
      source: 'commit',
      oldContents: 'unrelated\n',
      newContents: 'still unrelated\n'
    };

    expect(createExpandableReviewDiff(chunk, context)).toBeUndefined();
  });

  it('keeps both file boundaries available for expansion', () => {
    const oldContents = numberedLines(20);
    const newContents = oldContents.replace('line 10\n', 'line ten\n');
    const chunk = reviewChunk(
      '@@ -9,3 +9,3 @@\n line 9\n-line 10\n+line ten\n line 11\n'
    );
    const context: GitReviewFileContext = {
      id: 'context-boundaries',
      path: chunk.path,
      source: 'commit',
      oldContents,
      newContents
    };

    const result = createExpandableReviewDiff(chunk, context);

    expect(result?.leadingContextLines).toHaveLength(6);
    expect(result?.leadingContextLines[0]).toBe('line 1\n');
    expect(result?.trailingContextLines).toHaveLength(7);
    expect(result?.trailingContextLines.at(-1)).toBe('line 20\n');
    expect(result?.fileDiff.hunks[0]).toMatchObject({
      additionStart: 7,
      deletionStart: 7,
      additionCount: 7,
      deletionCount: 7
    });
  });

  it('matches equivalent insertion hunks when blank lines align differently', () => {
    const oldContents = 'a\nb\nc\n\nd\ne\nf\n';
    const newContents = 'a\nb\nc\nfirst\nsecond\n\ntype Added = string;\n\nd\ne\nf\n';
    const chunk = reviewChunk(
      '@@ -1,6 +1,10 @@\n a\n b\n c\n+first\n+second\n+\n+type Added = string;\n \n d\n e\n'
    );
    const context: GitReviewFileContext = {
      id: 'context-blank-alignment',
      path: chunk.path,
      source: 'commit',
      oldContents,
      newContents
    };

    expect(createExpandableReviewDiff(chunk, context)?.fileDiff.isPartial).toBe(false);
  });

  it('selects the correct hunk when identical edits occur more than once', () => {
    const oldContents = numberedLines(30)
      .replace('line 5\n', 'repeat\n')
      .replace('line 20\n', 'repeat\n');
    const newContents = oldContents.replaceAll('repeat\n', 'updated\n');
    const chunk = reviewChunk(
      '@@ -17,7 +17,7 @@\n line 17\n line 18\n line 19\n-repeat\n+updated\n line 21\n line 22\n line 23\n'
    );
    const context: GitReviewFileContext = {
      id: 'context-duplicate-change',
      path: chunk.path,
      source: 'commit',
      oldContents,
      newContents
    };

    expect(createExpandableReviewDiff(chunk, context)?.fileDiff.hunks[0]).toMatchObject({
      additionStart: 17,
      deletionStart: 17
    });
  });

  it('prepares stable worker-cache entries for contextual and patch-only diffs', () => {
    const chunk = reviewChunk(
      '@@ -1,4 +1,4 @@\n line 1\n-line 2\n+line two\n line 3\n line 4\n'
    );
    const context: GitReviewFileContext = {
      id: 'context-1',
      path: chunk.path,
      source: 'commit',
      oldContents: numberedLines(4),
      newContents: numberedLines(4).replace('line 2\n', 'line two\n')
    };

    const contextual = prepareReviewDiff(chunk, context, 'repo:commit-1');
    const patchOnly = prepareReviewDiff(chunk, undefined, 'repo:commit-1');

    expect(contextual?.fileDiff.cacheKey).toBe(`review:repo:commit-1:${chunk.id}`);
    expect(contextual?.expandable?.fileDiff.cacheKey).toBe(`review:repo:commit-1:${chunk.id}`);
    expect(patchOnly?.fileDiff.cacheKey).toBe(`review:repo:commit-1:${chunk.id}`);
  });
});

describe('smart context expansion', () => {
  it('expands a complete GraphQL block after a change', () => {
    const lines = [
      'type Query {\n',
      '  health: Boolean!\n',
      '  repository {\n',
      '    id\n',
      '  }\n',
      '}\n',
      '\n',
      'type Mutation {\n'
    ];

    expect(getSmartExpansionLineCount(lines, 'after', 'schema.graphql')).toBe(6);
  });

  it('includes decorators when expanding a TypeScript block above a change', () => {
    const lines = [
      '@Injectable()\n',
      'export class ReviewService {\n',
      '  run() {\n',
      '    return true;\n',
      '  }\n',
      '}\n'
    ];

    expect(getSmartExpansionLineCount(lines, 'before', 'review.service.ts')).toBe(6);
  });

  it('can be applied repeatedly to adjacent code blocks', () => {
    const lines = [
      'function first() {\n',
      '  return 1;\n',
      '}\n',
      '\n',
      'function second() {\n',
      '  return 2;\n',
      '}\n'
    ];
    const firstExpansion = getSmartExpansionLineCount(lines, 'before', 'review.ts');
    const remaining = lines.slice(0, -firstExpansion);

    expect(firstExpansion).toBe(3);
    expect(getSmartExpansionLineCount(remaining, 'before', 'review.ts')).toBe(4);
  });

  it('caps structureless generated content', () => {
    const lines = Array.from({ length: 200 }, (_, index) => `generated token ${index}\n`);

    expect(getSmartExpansionLineCount(lines, 'after', 'generated.txt')).toBe(80);
  });

  it('expands to complete nested syntax nodes across repeated clicks', () => {
    const nodes = [
      { kind: 'declaration' as const, startLine: 2, endLine: 14 },
      { kind: 'block' as const, startLine: 5, endLine: 12 }
    ];

    expect(getSyntaxExpansionLineCount(nodes, 'before', 9, 8)).toBe(4);
    expect(getSyntaxExpansionLineCount(nodes, 'before', 5, 4)).toBe(3);
    expect(getSyntaxExpansionLineCount(nodes, 'after', 9, 6)).toBe(4);
    expect(getSyntaxExpansionLineCount(nodes, 'after', 13, 2)).toBe(2);
  });
});

function reviewChunk(hunk: string): GitReviewChunk {
  const path = 'src/example.ts';
  return {
    id: 'chunk-1',
    path,
    patch: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${hunk}`,
    header: hunk.split('\n')[0] ?? '',
    startLine: 15,
    additions: 1,
    deletions: 1,
    role: 'related',
    relationship: 'Same changed file',
    reviewSection: 'other',
    category: 'source',
    changeType: 'modified',
    contentKind: 'code',
    source: 'commit'
  };
}

function numberedLines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}\n`).join('');
}
