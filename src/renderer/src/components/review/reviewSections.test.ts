import { describe, expect, it } from 'vitest';

import type { GitReviewChunk } from '@shared/types';

import { createReviewContexts, createReviewSections } from './reviewSections';

describe('review sections', () => {
  it('keeps dependency-ordered chunks in semantic subgroups', () => {
    const sections = createReviewSections([
      chunk('test', 'tests'),
      chunk('consumer', 'implementation'),
      chunk('migration', 'storage'),
      chunk('sdk', 'generated'),
      chunk('schema', 'api'),
      chunk('definition', 'definition')
    ]);

    expect(sections.map((section) => [section.label, section.chunks.map((item) => item.id)])).toEqual([
      ['Storage and migrations', ['migration']],
      ['Definitions', ['definition']],
      ['API and GraphQL', ['schema']],
      ['Generated artifacts', ['sdk']],
      ['Implementations and consumers', ['consumer']],
      ['Tests and specs', ['test']]
    ]);
  });

  it('keeps merged stories split into their original review contexts', () => {
    const definition = chunk('definition', 'definition');
    const consumer = chunk('consumer', 'implementation');
    const schema = chunk('schema', 'api');
    definition.reviewContext = 'Rename request';
    consumer.reviewContext = 'Rename request';
    schema.reviewContext = 'GraphQL contract';

    expect(createReviewContexts([definition, consumer, schema]).map((context) => ({
      label: context.label,
      count: context.chunkCount,
      sections: context.sections.map((section) => section.label)
    }))).toEqual([
      { label: 'Rename request', count: 2, sections: ['Definitions', 'Implementations and consumers'] },
      { label: 'GraphQL contract', count: 1, sections: ['API and GraphQL'] }
    ]);
  });
});

function chunk(id: string, reviewSection: GitReviewChunk['reviewSection']): GitReviewChunk {
  return {
    id,
    path: `${id}.ts`,
    patch: '',
    header: '',
    startLine: 1,
    additions: 1,
    deletions: 0,
    role: 'related',
    relationship: 'Related change',
    reviewSection,
    category: reviewSection === 'tests' ? 'test' : 'source',
    changeType: 'added',
    contentKind: 'code',
    source: 'commit'
  };
}
