import { performance } from 'node:perf_hooks';

import { createReviewBenchmarkFixture } from './fixtureRepository';
import { runReviewBenchmarkPipeline } from './pipelines';
import {
  identifyReviewUnits,
  scoreReviewGrouping,
  validateReviewGroupingDataset,
  type IdentifiedReviewUnit,
  type ReviewGroupingScore
} from './scoring';
import {
  reviewBenchmarkPipelines,
  type ReviewBenchmarkPipeline,
  type ReviewGroupingDataset
} from './types';

export type ReviewBenchmarkCaseResult = ReviewGroupingScore & {
  datasetId: string;
  datasetTitle: string;
  pipeline: ReviewBenchmarkPipeline;
  durationMs: number;
  weight: number;
  minimumScore?: number;
  expectedUnits: ReviewGroupingDataset['expectedUnits'];
  actualUnits: IdentifiedReviewUnit[];
  error?: string;
};

export type ReviewBenchmarkPipelineSummary = {
  pipeline: ReviewBenchmarkPipeline;
  score: number;
  caseCount: number;
};

export type ReviewBenchmarkReport = {
  minimumScore: number;
  score: number;
  passed: boolean;
  datasets: number;
  runs: number;
  durationMs: number;
  pipelineSummaries: ReviewBenchmarkPipelineSummary[];
  cases: ReviewBenchmarkCaseResult[];
};

export type ReviewBenchmarkOptions = {
  minimumScore: number;
  datasetFilter?: string;
  pipelines?: readonly ReviewBenchmarkPipeline[];
};

export async function runReviewGroupingBenchmark(
  datasets: readonly ReviewGroupingDataset[],
  options: ReviewBenchmarkOptions
): Promise<ReviewBenchmarkReport> {
  validateMinimumScore(options.minimumScore);
  const selectedDatasets = filterDatasets(datasets, options.datasetFilter);
  const selectedPipelines = options.pipelines ?? reviewBenchmarkPipelines;

  if (!selectedDatasets.length) {
    throw new Error(`No review grouping datasets matched filter ${options.datasetFilter ?? '(none)'}.`);
  }

  if (!selectedPipelines.length) {
    throw new Error('At least one review benchmark pipeline must be selected.');
  }

  const startedAt = performance.now();
  const cases: ReviewBenchmarkCaseResult[] = [];

  for (const dataset of selectedDatasets) {
    validateReviewGroupingDataset(dataset);
    const pipelines = selectedPipelines.filter((pipeline) =>
      !dataset.pipelines || dataset.pipelines.includes(pipeline)
    );

    if (!pipelines.length) {
      continue;
    }

    const fixture = await createReviewBenchmarkFixture(dataset);

    try {
      for (const pipeline of pipelines) {
        cases.push(await runCase(dataset, pipeline, fixture));
      }
    } finally {
      await fixture.dispose();
    }
  }

  if (!cases.length) {
    throw new Error('The selected datasets do not support any selected benchmark pipelines.');
  }

  const score = weightedScore(cases);
  const explicitCaseFailures = cases.filter((result) =>
    result.minimumScore !== undefined && result.score < result.minimumScore
  );

  return {
    minimumScore: options.minimumScore,
    score,
    passed:
      score >= options.minimumScore &&
      explicitCaseFailures.length === 0 &&
      cases.every((result) => !result.error),
    datasets: new Set(cases.map((result) => result.datasetId)).size,
    runs: cases.length,
    durationMs: performance.now() - startedAt,
    pipelineSummaries: summarizePipelines(cases),
    cases
  };
}

async function runCase(
  dataset: ReviewGroupingDataset,
  pipeline: ReviewBenchmarkPipeline,
  fixture: Awaited<ReturnType<typeof createReviewBenchmarkFixture>>
): Promise<ReviewBenchmarkCaseResult> {
  const startedAt = performance.now();
  const weight = dataset.weight ?? 1;

  try {
    const plan = await runReviewBenchmarkPipeline(pipeline, dataset, fixture);
    const actualUnits = identifyReviewUnits(dataset, plan);
    const score = scoreReviewGrouping(dataset.expectedUnits, actualUnits);

    return {
      datasetId: dataset.id,
      datasetTitle: dataset.title,
      pipeline,
      durationMs: performance.now() - startedAt,
      weight,
      minimumScore: dataset.minimumScore,
      expectedUnits: dataset.expectedUnits,
      actualUnits,
      ...score
    };
  } catch (error) {
    return {
      datasetId: dataset.id,
      datasetTitle: dataset.title,
      pipeline,
      durationMs: performance.now() - startedAt,
      weight,
      minimumScore: dataset.minimumScore,
      expectedUnits: dataset.expectedUnits,
      actualUnits: [],
      ...scoreReviewGrouping(dataset.expectedUnits, dataset.expectedUnits.map(() => ({ chunks: [] }))),
      score: 0,
      accuracy: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function filterDatasets(
  datasets: readonly ReviewGroupingDataset[],
  filter: string | undefined
): ReviewGroupingDataset[] {
  const normalizedFilter = filter?.trim().toLowerCase();

  if (!normalizedFilter) {
    return [...datasets];
  }

  return datasets.filter((dataset) =>
    dataset.id.toLowerCase().includes(normalizedFilter) ||
    dataset.title.toLowerCase().includes(normalizedFilter) ||
    dataset.tags?.some((tag) => tag.toLowerCase().includes(normalizedFilter))
  );
}

function weightedScore(results: readonly ReviewBenchmarkCaseResult[]): number {
  const resultsByDataset = new Map<string, ReviewBenchmarkCaseResult[]>();

  for (const result of results) {
    const datasetResults = resultsByDataset.get(result.datasetId) ?? [];
    datasetResults.push(result);
    resultsByDataset.set(result.datasetId, datasetResults);
  }

  const datasetScores = [...resultsByDataset.values()].map((datasetResults) => ({
    score: datasetResults.reduce((total, result) => total + result.score, 0) / datasetResults.length,
    weight: datasetResults[0]!.weight
  }));
  const totalWeight = datasetScores.reduce((total, result) => total + result.weight, 0);

  return datasetScores.reduce(
    (total, result) => total + result.score * result.weight,
    0
  ) / totalWeight;
}

function summarizePipelines(
  results: readonly ReviewBenchmarkCaseResult[]
): ReviewBenchmarkPipelineSummary[] {
  return reviewBenchmarkPipelines.flatMap((pipeline): ReviewBenchmarkPipelineSummary[] => {
    const pipelineResults = results.filter((result) => result.pipeline === pipeline);

    if (!pipelineResults.length) {
      return [];
    }

    const totalWeight = pipelineResults.reduce((total, result) => total + result.weight, 0);

    return [{
      pipeline,
      score: pipelineResults.reduce(
        (total, result) => total + result.score * result.weight,
        0
      ) / totalWeight,
      caseCount: pipelineResults.length
    }];
  });
}

function validateMinimumScore(minimumScore: number): void {
  if (!Number.isFinite(minimumScore) || minimumScore < 0 || minimumScore > 1) {
    throw new Error('Benchmark minimumScore must be between zero and one.');
  }
}
