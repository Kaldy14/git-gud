import type {
  GitReviewPlan,
  GitReviewUnit,
  ReviewGroupingBenchmarkPreview,
  ReviewGroupingBenchmarkSummary
} from '@shared/types';

import { reviewGroupingDatasets } from './datasets';
import { createReviewBenchmarkFixture } from './fixtureRepository';
import { runReviewBenchmarkPipeline } from './pipelines';
import {
  identifyReviewChunks,
  identifyReviewUnits,
  scoreReviewGrouping,
  validateReviewGroupingDataset
} from './scoring';
import type { ReviewGroupingDataset } from './types';

export function listReviewGroupingBenchmarks(): ReviewGroupingBenchmarkSummary[] {
  return reviewGroupingDatasets.map(summarizeDataset);
}

export async function loadReviewGroupingBenchmarkPreview(
  datasetId: string
): Promise<ReviewGroupingBenchmarkPreview> {
  const dataset = reviewGroupingDatasets.find((candidate) => candidate.id === datasetId);

  if (!dataset) {
    throw new Error(`Unknown review grouping benchmark: ${datasetId}.`);
  }

  validateReviewGroupingDataset(dataset);
  const fixture = await createReviewBenchmarkFixture(dataset);

  try {
    const producedPlan = await runReviewBenchmarkPipeline('local-commit', dataset, fixture);
    const identifiedChunks = identifyReviewChunks(dataset, producedPlan);
    const actualUnits = identifyReviewUnits(dataset, producedPlan);
    const score = scoreReviewGrouping(dataset.expectedUnits, actualUnits);
    const repoPath = `benchmark://${dataset.id}`;
    const actualPlan: GitReviewPlan = {
      ...producedPlan,
      repoPath,
      targetKey: `benchmark:${dataset.id}:actual`,
      reviewedChunkIds: []
    };

    return {
      benchmark: summarizeDataset(dataset),
      expectedPlan: {
        ...producedPlan,
        repoPath,
        targetKey: `benchmark:${dataset.id}:expected`,
        units: expectedReviewUnits(dataset, identifiedChunks),
        reviewedChunkIds: []
      },
      actualPlan,
      score: score.score,
      wronglyMerged: score.wronglyMerged,
      wronglySplit: score.wronglySplit
    };
  } finally {
    await fixture.dispose();
  }
}

function summarizeDataset(dataset: ReviewGroupingDataset): ReviewGroupingBenchmarkSummary {
  return {
    id: dataset.id,
    title: dataset.title,
    description: dataset.description,
    tags: [...(dataset.tags ?? [])],
    expectedUnitCount: dataset.expectedUnits.length,
    chunkCount: dataset.files.reduce((total, file) => total + file.hunks.length, 0)
  };
}

function expectedReviewUnits(
  dataset: ReviewGroupingDataset,
  chunkByMarkerId: ReadonlyMap<string, GitReviewPlan['units'][number]['chunks'][number]>
): GitReviewUnit[] {
  return dataset.expectedUnits.map((unit) => ({
    id: `benchmark-expected:${dataset.id}:${unit.id}`,
    title: humanizeId(unit.id),
    reason: 'Expected benchmark grouping',
    explanation: dataset.description,
    confidence: 'exact',
    chunks: unit.chunks.map((chunkId) => {
      const chunk = chunkByMarkerId.get(chunkId);

      if (!chunk) {
        throw new Error(`Benchmark ${dataset.id} could not resolve expected chunk ${chunkId}.`);
      }

      return chunk;
    })
  }));
}

function humanizeId(value: string): string {
  const words = value.replaceAll('-', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
