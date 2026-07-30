import { describe, expect, it } from 'vitest';

import { reviewGroupingBenchmarkConfig } from './config';
import { formatReviewBenchmarkReport } from './report';
import { runReviewGroupingBenchmark } from './runtime';
import {
  reviewBenchmarkPipelines,
  type ReviewBenchmarkPipeline
} from './types';

describe('review grouping quality benchmark', () => {
  it('meets the configured quality gate', async () => {
    const report = await runReviewGroupingBenchmark(
      reviewGroupingBenchmarkConfig.datasets,
      {
        minimumScore: reviewGroupingBenchmarkConfig.minimumScore,
        datasetFilter: process.env.REVIEW_BENCHMARK_FILTER,
        pipelines: selectedPipelines(process.env.REVIEW_BENCHMARK_PIPELINE)
      }
    );

    if (process.env.REVIEW_BENCHMARK_JSON === '1') {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatReviewBenchmarkReport(report));
    }

    expect(
      report.passed,
      `Review grouping score ${formatScore(report.score)} did not meet the ${formatScore(report.minimumScore)} gate.`
    ).toBe(true);
  });
});

function selectedPipelines(value: string | undefined): ReviewBenchmarkPipeline[] | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const requested = value.split(',').map((pipeline) => pipeline.trim());
  const unknown = requested.filter((pipeline) =>
    !reviewBenchmarkPipelines.includes(pipeline as ReviewBenchmarkPipeline)
  );

  if (unknown.length) {
    throw new Error(
      `Unknown review benchmark pipelines: ${unknown.join(', ')}. ` +
      `Choose from ${reviewBenchmarkPipelines.join(', ')}.`
    );
  }

  return requested as ReviewBenchmarkPipeline[];
}

function formatScore(score: number): string {
  return `${(score * 100).toFixed(1)}%`;
}
