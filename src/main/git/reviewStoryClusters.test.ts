import { describe, expect, it } from 'vitest';

import { clusterReviewStories, type ReviewStoryChunk, type ReviewStoryGroup } from './reviewStoryClusters';

describe('review story clustering', () => {
  it('does not let a broad cross-feature relationship bridge a focused story', () => {
    const broadChunks = Array.from({ length: 12 }, (_, index) =>
      storyChunk(
        `broad-${index}`,
        `src/${index < 6 ? 'catalog' : 'branch'}/file-${index}.ts`,
        new Set([index < 6 ? 'catalog' : 'branch']),
        index === 0 ? new Set(['FocusedChange']) : new Set(['SharedType'])
      )
    );
    const groups: ReviewStoryGroup[] = [
      {
        key: 'relationship:shared-type',
        kind: 'relationship',
        symbols: ['SharedType'],
        chunks: broadChunks
      },
      {
        key: 'relationship:focused-change',
        kind: 'relationship',
        symbols: ['FocusedChange'],
        chunks: [storyChunk(
          'focused',
          'src/catalog/file-0.ts',
          new Set(['catalog']),
          new Set(['SharedType'])
        )]
      }
    ];

    expect(clusterReviewStories(groups).map((cluster) => cluster.groupKeys)).toEqual([
      ['relationship:shared-type'],
      ['relationship:focused-change']
    ]);
  });
});

function storyChunk(
  id: string,
  path: string,
  pathConcepts: Set<string>,
  identifiers: Set<string>
): ReviewStoryChunk {
  return {
    id,
    path,
    declarations: [],
    enclosingSymbols: [],
    graphqlSymbols: [],
    syntaxQualifiedSymbols: [],
    syntaxIdentifiers: [],
    identifiers,
    structuralFingerprints: [],
    pathConcepts,
    generated: false,
    category: 'source',
    contentKind: 'code',
    changeType: 'modified'
  };
}
