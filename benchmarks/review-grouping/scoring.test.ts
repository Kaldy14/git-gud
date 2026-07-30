import { describe, expect, it } from 'vitest';

import {
  scoreReviewGrouping,
  validateReviewGroupingDataset
} from './scoring';
import { defineReviewGroupingDataset } from './types';

describe('review grouping benchmark scoring', () => {
  it('gives an exact partition a perfect symmetric pair score', () => {
    const score = scoreReviewGrouping(
      [
        { id: 'feature', chunks: ['definition', 'usage'] },
        { id: 'unrelated', chunks: ['logging'] }
      ],
      [
        { chunks: ['definition', 'usage'] },
        { chunks: ['logging'] }
      ]
    );

    expect(score).toMatchObject({
      score: 1,
      accuracy: 1,
      wronglyMerged: [],
      wronglySplit: []
    });
  });

  it('penalizes both wrongful splits and wrongful merges', () => {
    const expected = [
      { id: 'feature', chunks: ['definition', 'usage'] },
      { id: 'unrelated', chunks: ['logging'] }
    ];
    const split = scoreReviewGrouping(expected, [
      { chunks: ['definition'] },
      { chunks: ['usage'] },
      { chunks: ['logging'] }
    ]);
    const merged = scoreReviewGrouping(expected, [
      { chunks: ['definition', 'usage', 'logging'] }
    ]);

    expect(split.score).toBeLessThan(1);
    expect(split.wronglySplit).toEqual([['definition', 'usage']]);
    expect(merged.score).toBeLessThan(1);
    expect(merged.wronglyMerged).toEqual([
      ['definition', 'logging'],
      ['usage', 'logging']
    ]);
  });

  it('requires every named hunk to have exactly one expected owner', () => {
    const dataset = defineReviewGroupingDataset({
      id: 'invalid',
      title: 'Invalid dataset',
      description: 'The hunk is intentionally not assigned.',
      files: [
        {
          path: 'src/value.ts',
          before: 'export const value = 1;\n',
          after: 'export const value = 2;\n',
          hunks: [{ id: 'value-change', contains: 'value = 2' }]
        }
      ],
      expectedUnits: [
        {
          id: 'empty',
          chunks: []
        }
      ]
    });

    expect(() => validateReviewGroupingDataset(dataset)).toThrow(
      'expected unit empty must contain chunks'
    );
  });
});
