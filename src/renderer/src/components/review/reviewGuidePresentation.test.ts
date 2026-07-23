import { describe, expect, it } from 'vitest';

import type { GitReviewGuide } from '@shared/types';

import { rankReviewUnitsByGuide } from './reviewGuidePresentation';

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
      { unitId: 'three', priority: 'critical', why: 'Why.', what: 'What.', confirmedIssues: [] },
      { unitId: 'one', priority: 'review', why: 'Why.', what: 'What.', confirmedIssues: [] },
      { unitId: 'two', priority: 'skim', why: 'Why.', what: 'What.', confirmedIssues: [] }
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

  it('keeps deterministic order for a stale guide', () => {
    expect(rankReviewUnitsByGuide(units, guide, 'changed').map((candidate) => candidate.unit.id)).toEqual([
      'one',
      'two',
      'three'
    ]);
  });
});
