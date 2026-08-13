import { describe, expect, it } from 'vitest';

import { clusterReviewStories, type ReviewStoryChunk, type ReviewStoryGroup } from './reviewStoryClusters';

describe('review story clustering', () => {
  it('keeps an import-only change with the same-file story that uses the imported symbol', () => {
    const groups: ReviewStoryGroup[] = [
      {
        key: 'relationship:menu-item',
        kind: 'relationship',
        symbols: ['MenuItem'],
        chunks: [storyChunk(
          'menu-item-import',
          'src/jsonld.ts',
          new Set(['jsonld']),
          new Set(['MenuItem']),
          {
            contentKind: 'imports',
            syntaxIdentifiers: [{ name: 'MenuItem', role: 'import' }]
          }
        )]
      },
      {
        key: 'relationship:create-product-jsonld',
        kind: 'relationship',
        symbols: ['createStorefrontBranchProductJsonLd'],
        chunks: [storyChunk(
          'product-jsonld-implementation',
          'src/jsonld.ts',
          new Set(['jsonld']),
          new Set(['createStorefrontBranchProductJsonLd']),
          {
            declarations: ['createStorefrontBranchProductJsonLd'],
            syntaxIdentifiers: [
              { name: 'createStorefrontBranchProductJsonLd', role: 'declaration' },
              { name: 'MenuItem', role: 'type-reference' }
            ]
          }
        )]
      }
    ];

    expect(clusterReviewStories(groups).map((cluster) => cluster.groupKeys)).toEqual([[
      'relationship:create-product-jsonld',
      'relationship:menu-item'
    ]]);
  });

  it('does not merge different-file stories through an unchanged syntax reference alone', () => {
    const groups: ReviewStoryGroup[] = [
      {
        key: 'relationship:menu-item',
        kind: 'relationship',
        symbols: ['MenuItem'],
        chunks: [storyChunk(
          'menu-item-definition',
          'src/catalog/menu-item.ts',
          new Set(['catalog']),
          new Set(['MenuItem'])
        )]
      },
      {
        key: 'relationship:create-product-jsonld',
        kind: 'relationship',
        symbols: ['createStorefrontBranchProductJsonLd'],
        chunks: [storyChunk(
          'product-jsonld-implementation',
          'src/catalog/jsonld.ts',
          new Set(['catalog']),
          new Set(['createStorefrontBranchProductJsonLd']),
          {
            declarations: ['createStorefrontBranchProductJsonLd'],
            syntaxIdentifiers: [
              { name: 'createStorefrontBranchProductJsonLd', role: 'declaration' },
              { name: 'MenuItem', role: 'type-reference' }
            ]
          }
        )]
      }
    ];

    expect(clusterReviewStories(groups).map((cluster) => cluster.groupKeys)).toEqual([
      ['relationship:menu-item'],
      ['relationship:create-product-jsonld']
    ]);
  });

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
  identifiers: Set<string>,
  overrides: Partial<ReviewStoryChunk> = {}
): ReviewStoryChunk {
  return {
    id,
    path,
    declarations: [],
    enclosingSymbols: [],
    graphqlSymbols: [],
    syntaxQualifiedSymbols: [],
    syntaxIdentifiers: [],
    changedSyntaxIdentifiers: [],
    identifiers,
    changedIdentifiers: identifiers,
    storySignals: new Set(),
    structuralFingerprints: [],
    pathConcepts,
    generated: false,
    category: 'source',
    contentKind: 'code',
    changeType: 'modified',
    ...overrides
  };
}
