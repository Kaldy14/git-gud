import { describe, expect, it } from 'vitest';

import { reviewGroupingDatasets } from './datasets';
import {
  listReviewGroupingBenchmarks,
  loadReviewGroupingBenchmarkPreview
} from './devPreview';
import { identifyReviewUnits } from './scoring';

describe('review grouping benchmark dev preview', () => {
  it('lists every registered dataset with useful selection metadata', () => {
    const summaries = listReviewGroupingBenchmarks();

    expect(summaries).toHaveLength(reviewGroupingDatasets.length);
    expect(new Set(summaries.map((summary) => summary.id))).toHaveLength(summaries.length);
    expect(summaries).toContainEqual(expect.objectContaining({
      id: 'two-independent-features-cross-same-files',
      expectedUnitCount: 2,
      chunkCount: 6
    }));
  });

  it('regroups real fixture chunks into the benchmark expectation', async () => {
    const dataset = reviewGroupingDatasets.find(
      (candidate) => candidate.id === 'two-independent-features-cross-same-files'
    );

    expect(dataset).toBeDefined();

    const preview = await loadReviewGroupingBenchmarkPreview(dataset!.id);

    expect(identifyReviewUnits(dataset!, preview.expectedPlan)).toEqual(
      dataset!.expectedUnits.map((unit) => ({
        title: expect.any(String),
        chunks: [...unit.chunks]
      }))
    );
    expect(preview.expectedPlan.repoPath).toBe(
      'benchmark://two-independent-features-cross-same-files'
    );
    expect(preview.actualPlan.repoPath).toBe(preview.expectedPlan.repoPath);
    expect(preview.expectedPlan.units).toHaveLength(2);
  });

  it('rejects unknown dataset ids', async () => {
    await expect(
      loadReviewGroupingBenchmarkPreview('does-not-exist')
    ).rejects.toThrow('Unknown review grouping benchmark');
  });
});
