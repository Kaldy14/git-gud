import { describe, expect, it } from 'vitest';

import type { GitReviewChunk } from '@shared/types';

import { createReviewSections, groupReviewFiles } from './reviewSections';

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

    expect(sections.map((section) => [section.label, section.files.flatMap((file) => file.chunks.map((item) => item.id))])).toEqual([
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
      chunks: section.files.flatMap((file) => file.chunks.map((item) => item.id))
    }))).toEqual([
      { label: 'Definitions', chunks: ['definition'] },
      { label: 'API and GraphQL', chunks: ['schema'] },
      { label: 'Implementations and consumers', chunks: ['consumer'] }
    ]);
  });

  it('groups every hunk for a file once and aggregates its change counts', () => {
    const first = chunk('first-hunk', 'implementation');
    const other = chunk('other-file', 'tests');
    const second = chunk('second-hunk', 'tests');
    first.fileContextId = 'file-1';
    second.fileContextId = 'file-1';
    second.path = first.path;
    second.additions = 4;
    second.deletions = 2;

    const sections = createReviewSections([first, other, second]);

    expect(sections.map((section) => ({
      label: section.label,
      files: section.files.map((file) => file.chunks.map((item) => item.id))
    }))).toEqual([
      { label: 'Implementations and consumers', files: [['first-hunk', 'second-hunk']] },
      { label: 'Tests and specs', files: [['other-file']] }
    ]);
    expect(sections[0].files[0]).toMatchObject({ additions: 5, deletions: 2 });
  });

  it('falls back to source, original path, and path for file identity', () => {
    const first = chunk('first', 'implementation');
    const same = { ...chunk('same', 'implementation'), path: first.path };
    const otherSource = { ...same, id: 'staged', source: 'staged' as const };
    const renamed = { ...same, id: 'renamed', originalPath: 'legacy.ts' };

    expect(groupReviewFiles([first, same, otherSource, renamed]).map((file) =>
      file.chunks.map((item) => item.id)
    )).toEqual([['first', 'same'], ['staged'], ['renamed']]);
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
