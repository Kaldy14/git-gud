import { describe, expect, it } from 'vitest';

import type { GitReviewGuide, GitReviewUnit } from '@shared/types';

import { rankReviewChunksByGuide, rankReviewUnitsByGuide, reviewGuideFileLabel, visibleReviewGuideFiles } from './reviewGuidePresentation';

describe('guide file labels', () => {
  it('includes enough parent folders to distinguish repeated filenames', () => {
    const files = ['src/client/api/index.ts', 'src/server/api/index.ts', 'src/types.ts', 'index.ts']
      .map((path) => ({ path }));
    expect(files.map((file) => reviewGuideFileLabel(file.path, files)))
      .toEqual(['client/api/index.ts', 'server/api/index.ts', 'types.ts', 'index.ts']);
  });

  it('does not expand labels when the same file occurs in multiple blocks', () => {
    const files = [{ path: 'src/index.ts' }, { path: 'src/index.ts' }];
    expect(reviewGuideFileLabel('src/index.ts', files)).toBe('index.ts');
  });
});

describe('AI review guide presentation', () => {
  const units = [
    { unit: { id: 'one' } },
    { unit: { id: 'two' } },
    { unit: { id: 'three' } }
  ];
  const guide: GitReviewGuide = {
    sourceFingerprint: 'current',
    targetKey: 'wip:all',
    summary: 'Summary.',
    units: [
      { unitId: 'three', priority: 'focus', why: 'Why.', what: 'What.', files: [], inlineNotes: [] },
      { unitId: 'one', priority: 'review', why: 'Why.', what: 'What.', files: [], inlineNotes: [] },
      { unitId: 'two', priority: 'skim', why: 'Why.', what: 'What.', files: [], inlineNotes: [] }
    ],
    generatedAt: '2026-07-23T00:00:00.000Z'
  };

  it('uses the guide order for the matching source', () => {
    expect(rankReviewUnitsByGuide(units, guide, 'current').map((candidate) => candidate.unit.id)).toEqual([
      'three',
      'one',
      'two'
    ]);
  });

  it('enforces attention levels even if the generated order disagrees', () => {
    const scrambled = { ...guide, units: [...guide.units].reverse() };
    expect(rankReviewUnitsByGuide(units, scrambled, 'current').map((item) => item.unit.id))
      .toEqual(['three', 'one', 'two']);
  });

  it('ranks files independently while preserving their hunk order', () => {
    const block = { ...guide.units[0]!, files: [
      { path: 'labels.json', priority: 'skim' as const, reason: 'Wording.' },
      { path: 'client.ts', priority: 'focus' as const, reason: 'State ordering.' }
    ] };
    const chunks = [{ path: 'labels.json', id: 1 }, { path: 'client.ts', id: 2 }, { path: 'client.ts', id: 3 }];
    expect(rankReviewChunksByGuide(chunks, block).map((chunk) => chunk.id)).toEqual([2, 3, 1]);
    expect(chunks[0]!.id).toBe(1);
  });

  it('keeps deterministic order for a stale guide', () => {
    expect(rankReviewUnitsByGuide(units, guide, 'changed').map((candidate) => candidate.unit.id)).toEqual([
      'one',
      'two',
      'three'
    ]);
  });

  it('keeps a file link but drops an anchor hidden by filters', () => {
    const unit: GitReviewUnit = {
      id: 'client', title: 'Client', reason: 'Same file', explanation: '', confidence: 'exact',
      chunks: [{ id: 'visible', path: 'client.ts', patch: '@@ -1 +1,2 @@\n context\n+visible\n',
        header: '@@ -1 +1,2 @@', startLine: 1, additions: 1, deletions: 0,
        role: 'related', relationship: 'Same file', reviewSection: 'other', category: 'source',
        changeType: 'modified', contentKind: 'code', source: 'unstaged' }]
    };
    const visible = { unit, visibleChunks: unit.chunks, skippedCount: 1, isViewed: false };
    const block = { ...guide.units[0]!, files: [{
      path: 'client.ts', priority: 'focus' as const, reason: 'Check the guard.', line: 20
    }] };
    expect(visibleReviewGuideFiles(visible, block)).toEqual([{ ...block.files[0], line: undefined }]);
    block.files[0]!.line = 2;
    expect(visibleReviewGuideFiles(visible, block)[0]?.line).toBe(2);
    expect(visibleReviewGuideFiles({ ...visible, visibleChunks: [] }, block)).toEqual([]);
  });
});
