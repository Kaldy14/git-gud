import { describe, expect, it } from 'vitest';

import type { GitReviewChunk, GitReviewFileContext } from '@shared/types';

import {
  createExpandableReviewDiff,
  getSmartExpansionLineCount
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
    category: 'source',
    changeType: 'modified',
    contentKind: 'code',
    source: 'commit'
  };
}

function numberedLines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}\n`).join('');
}
