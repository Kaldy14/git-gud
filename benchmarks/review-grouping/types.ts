export const reviewBenchmarkPipelines = [
  'core-full-context',
  'local-commit',
  'github-builder'
] as const;

export type ReviewBenchmarkPipeline = typeof reviewBenchmarkPipelines[number];

export type ReviewBenchmarkHunk = {
  id: string;
  contains: string | readonly string[];
};

export type ReviewBenchmarkFile = {
  path: string;
  previousPath?: string;
  before: string | null;
  after: string | null;
  hunks: readonly ReviewBenchmarkHunk[];
};

export type ReviewBenchmarkExpectedUnit = {
  id: string;
  chunks: readonly string[];
};

export type ReviewGroupingDataset = {
  id: string;
  title: string;
  description: string;
  tags?: readonly string[];
  weight?: number;
  minimumScore?: number;
  pipelines?: readonly ReviewBenchmarkPipeline[];
  files: readonly ReviewBenchmarkFile[];
  expectedUnits: readonly ReviewBenchmarkExpectedUnit[];
};

export function defineReviewGroupingDataset(
  dataset: ReviewGroupingDataset
): ReviewGroupingDataset {
  return dataset;
}
