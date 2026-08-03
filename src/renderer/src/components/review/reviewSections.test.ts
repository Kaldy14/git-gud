import { describe, expect, it } from 'vitest';

import type { GitReviewChunk } from '@shared/types';

import { createReviewSections } from './reviewSections';

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

  it('does not split visible sections by review context', () => {
    const definition = chunk('definition', 'definition');
    const consumer = chunk('consumer', 'implementation');
    const schema = chunk('schema', 'api');
    definition.reviewContext = 'Rename request';
    consumer.reviewContext = 'Rename request';
    schema.reviewContext = 'GraphQL contract';

    expect(createReviewSections([definition, consumer, schema]).map((section) => ({
      label: section.label,
      chunks: section.chunks.map((item) => item.id)
    }))).toEqual([
      { label: 'Definitions', chunks: ['definition'] },
      { label: 'API and GraphQL', chunks: ['schema'] },
      { label: 'Implementations and consumers', chunks: ['consumer'] }
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
