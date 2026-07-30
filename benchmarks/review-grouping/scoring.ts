import path from 'node:path';

import type { GitReviewChunk, GitReviewPlan } from '@shared/types';

import type {
  ReviewBenchmarkExpectedUnit,
  ReviewBenchmarkFile,
  ReviewGroupingDataset
} from './types';

export type ReviewGroupingPairMetrics = {
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  precision: number;
  recall: number;
  f1: number;
};

export type ReviewGroupingScore = {
  score: number;
  accuracy: number;
  together: ReviewGroupingPairMetrics;
  apart: ReviewGroupingPairMetrics;
  wronglyMerged: Array<readonly [string, string]>;
  wronglySplit: Array<readonly [string, string]>;
};

export type IdentifiedReviewUnit = {
  title: string;
  chunks: string[];
};

export function validateReviewGroupingDataset(dataset: ReviewGroupingDataset): void {
  if (!dataset.id.trim()) {
    throw new Error('Dataset id must not be empty.');
  }

  if (!dataset.title.trim()) {
    throw new Error(`Dataset ${dataset.id} must have a title.`);
  }

  if (!dataset.files.length) {
    throw new Error(`Dataset ${dataset.id} must contain at least one file.`);
  }

  if (dataset.weight !== undefined && (!Number.isFinite(dataset.weight) || dataset.weight <= 0)) {
    throw new Error(`Dataset ${dataset.id} weight must be greater than zero.`);
  }

  validateScore(dataset.minimumScore, `Dataset ${dataset.id} minimumScore`);

  const paths = new Set<string>();
  const chunkIds = new Set<string>();

  for (const file of dataset.files) {
    validateFile(dataset.id, file, paths, chunkIds);
  }

  const expectedChunkIds = new Set<string>();
  const expectedUnitIds = new Set<string>();

  if (!dataset.expectedUnits.length) {
    throw new Error(`Dataset ${dataset.id} must define at least one expected review unit.`);
  }

  for (const unit of dataset.expectedUnits) {
    if (!unit.id.trim() || expectedUnitIds.has(unit.id)) {
      throw new Error(`Dataset ${dataset.id} has an empty or duplicate expected unit id: ${unit.id}.`);
    }

    expectedUnitIds.add(unit.id);

    if (!unit.chunks.length) {
      throw new Error(`Dataset ${dataset.id} expected unit ${unit.id} must contain chunks.`);
    }

    for (const chunkId of unit.chunks) {
      if (!chunkIds.has(chunkId)) {
        throw new Error(`Dataset ${dataset.id} expected unit ${unit.id} references unknown chunk ${chunkId}.`);
      }

      if (expectedChunkIds.has(chunkId)) {
        throw new Error(`Dataset ${dataset.id} assigns chunk ${chunkId} to more than one expected unit.`);
      }

      expectedChunkIds.add(chunkId);
    }
  }

  const missingChunkIds = [...chunkIds].filter((chunkId) => !expectedChunkIds.has(chunkId));

  if (missingChunkIds.length) {
    throw new Error(
      `Dataset ${dataset.id} does not assign these chunks to expected units: ${missingChunkIds.join(', ')}.`
    );
  }
}

function validateFile(
  datasetId: string,
  file: ReviewBenchmarkFile,
  paths: Set<string>,
  chunkIds: Set<string>
): void {
  if (!isSafeRelativePath(file.path) || paths.has(file.path)) {
    throw new Error(`Dataset ${datasetId} has an unsafe or duplicate file path: ${file.path}.`);
  }

  paths.add(file.path);

  if (file.previousPath && !isSafeRelativePath(file.previousPath)) {
    throw new Error(`Dataset ${datasetId} has an unsafe previous path: ${file.previousPath}.`);
  }

  if (file.before === null && file.after === null) {
    throw new Error(`Dataset ${datasetId} file ${file.path} cannot be absent before and after.`);
  }

  if (file.before === file.after && !file.previousPath) {
    throw new Error(`Dataset ${datasetId} file ${file.path} must change.`);
  }

  if (!file.hunks.length) {
    throw new Error(`Dataset ${datasetId} file ${file.path} must define at least one hunk marker.`);
  }

  for (const hunk of file.hunks) {
    const needles = normalizeContains(hunk.contains);

    if (!hunk.id.trim() || chunkIds.has(hunk.id)) {
      throw new Error(`Dataset ${datasetId} has an empty or duplicate chunk id: ${hunk.id}.`);
    }

    if (!needles.length || needles.some((needle) => !needle.length)) {
      throw new Error(`Dataset ${datasetId} chunk ${hunk.id} must have non-empty match text.`);
    }

    chunkIds.add(hunk.id);
  }
}

function isSafeRelativePath(filePath: string): boolean {
  return Boolean(filePath) &&
    !filePath.includes('\0') &&
    !path.isAbsolute(filePath) &&
    !filePath.split(/[\\/]/u).some((segment) => segment === '..' || segment === '');
}

function validateScore(score: number | undefined, label: string): void {
  if (score !== undefined && (!Number.isFinite(score) || score < 0 || score > 1)) {
    throw new Error(`${label} must be between zero and one.`);
  }
}

export function identifyReviewUnits(
  dataset: ReviewGroupingDataset,
  plan: GitReviewPlan
): IdentifiedReviewUnit[] {
  const chunks = plan.units.flatMap((unit) => unit.chunks);
  const chunkIdByPlanChunkId = new Map<string, string>();

  for (const file of dataset.files) {
    for (const marker of file.hunks) {
      const candidates = chunks.filter((chunk) =>
        chunk.path === file.path &&
        matchesChunk(chunk, marker.contains)
      );

      if (candidates.length !== 1) {
        throw new Error(
          `Dataset ${dataset.id} marker ${marker.id} matched ${candidates.length} chunks in ${file.path}; expected one.`
        );
      }

      const candidate = candidates[0]!;

      if (chunkIdByPlanChunkId.has(candidate.id)) {
        throw new Error(
          `Dataset ${dataset.id} markers ${chunkIdByPlanChunkId.get(candidate.id)} and ${marker.id} matched the same chunk.`
        );
      }

      chunkIdByPlanChunkId.set(candidate.id, marker.id);
    }
  }

  const unidentified = chunks.filter((chunk) => !chunkIdByPlanChunkId.has(chunk.id));

  if (unidentified.length) {
    throw new Error(
      `Dataset ${dataset.id} produced unidentified chunks: ${unidentified
        .map((chunk) => `${chunk.path}:${chunk.startLine}`)
        .join(', ')}.`
    );
  }

  return plan.units.map((unit) => ({
    title: unit.title,
    chunks: unit.chunks.map((chunk) => chunkIdByPlanChunkId.get(chunk.id)!)
  }));
}

function matchesChunk(chunk: GitReviewChunk, contains: string | readonly string[]): boolean {
  return normalizeContains(contains).every((needle) => chunk.patch.includes(needle));
}

function normalizeContains(contains: string | readonly string[]): readonly string[] {
  return typeof contains === 'string' ? [contains] : contains;
}

export function scoreReviewGrouping(
  expectedUnits: readonly ReviewBenchmarkExpectedUnit[],
  actualUnits: readonly Pick<IdentifiedReviewUnit, 'chunks'>[]
): ReviewGroupingScore {
  const expectedGroupByChunk = groupByChunk(expectedUnits);
  const actualGroupByChunk = groupByChunk(actualUnits);
  const chunkIds = [...expectedGroupByChunk.keys()];
  const wronglyMerged: Array<readonly [string, string]> = [];
  const wronglySplit: Array<readonly [string, string]> = [];
  let togetherTruePositive = 0;
  let togetherFalsePositive = 0;
  let togetherFalseNegative = 0;
  let apartTruePositive = 0;
  let apartFalsePositive = 0;
  let apartFalseNegative = 0;

  for (let leftIndex = 0; leftIndex < chunkIds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < chunkIds.length; rightIndex += 1) {
      const left = chunkIds[leftIndex]!;
      const right = chunkIds[rightIndex]!;
      const expectedTogether = expectedGroupByChunk.get(left) === expectedGroupByChunk.get(right);
      const actualTogether = actualGroupByChunk.get(left) === actualGroupByChunk.get(right);

      if (expectedTogether && actualTogether) {
        togetherTruePositive += 1;
      } else if (!expectedTogether && actualTogether) {
        togetherFalsePositive += 1;
        apartFalseNegative += 1;
        wronglyMerged.push([left, right]);
      } else if (expectedTogether) {
        togetherFalseNegative += 1;
        apartFalsePositive += 1;
        wronglySplit.push([left, right]);
      } else {
        apartTruePositive += 1;
      }
    }
  }

  const together = pairMetrics(
    togetherTruePositive,
    togetherFalsePositive,
    togetherFalseNegative
  );
  const apart = pairMetrics(apartTruePositive, apartFalsePositive, apartFalseNegative);
  const pairCount = chunkIds.length * (chunkIds.length - 1) / 2;
  const correctPairs = togetherTruePositive + apartTruePositive;

  return {
    score: (together.f1 + apart.f1) / 2,
    accuracy: pairCount ? correctPairs / pairCount : 1,
    together,
    apart,
    wronglyMerged,
    wronglySplit
  };
}

function groupByChunk(
  units: readonly Pick<ReviewBenchmarkExpectedUnit, 'chunks'>[]
): Map<string, number> {
  const groups = new Map<string, number>();

  units.forEach((unit, groupIndex) => {
    for (const chunkId of unit.chunks) {
      if (groups.has(chunkId)) {
        throw new Error(`Chunk ${chunkId} appears in more than one review unit.`);
      }

      groups.set(chunkId, groupIndex);
    }
  });

  return groups;
}

function pairMetrics(
  truePositive: number,
  falsePositive: number,
  falseNegative: number
): ReviewGroupingPairMetrics {
  const precisionDenominator = truePositive + falsePositive;
  const recallDenominator = truePositive + falseNegative;
  const f1Denominator = 2 * truePositive + falsePositive + falseNegative;

  return {
    truePositive,
    falsePositive,
    falseNegative,
    precision: precisionDenominator ? truePositive / precisionDenominator : 1,
    recall: recallDenominator ? truePositive / recallDenominator : 1,
    f1: f1Denominator ? 2 * truePositive / f1Denominator : 1
  };
}
