import { reviewGuidePatchAddsLine } from '@shared/reviewGuide';
import type { VisibleReviewUnit } from './reviewFilters';
import type { GitReviewGuide, GitReviewGuideFile, GitReviewGuidePriority, GitReviewGuideUnit } from '@shared/types';

const priorityOrder: Record<GitReviewGuidePriority, number> = { focus: 0, review: 1, skim: 2 };

export function rankReviewUnitsByGuide<TUnit extends { unit: { id: string } }>(
  units: readonly TUnit[],
  guide: GitReviewGuide | undefined,
  sourceFingerprint: string | undefined
): TUnit[] {
  if (!guide || guide.sourceFingerprint !== sourceFingerprint) return [...units];
  const ordered = [...guide.units].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  const ranks = new Map(ordered.map((unit, index) => [unit.unitId, index]));
  return [...units].sort((a, b) =>
    (ranks.get(a.unit.id) ?? Number.MAX_SAFE_INTEGER) -
    (ranks.get(b.unit.id) ?? Number.MAX_SAFE_INTEGER)
  );
}

export function rankReviewChunksByGuide<TChunk extends { path: string }>(
  chunks: readonly TChunk[],
  guide: GitReviewGuideUnit | undefined
): TChunk[] {
  if (!guide) return [...chunks];
  const files = [...guide.files].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  const ranks = new Map(files.map((file, index) => [file.path, index]));
  // Stable sorting keeps hunks of the same file in their original order.
  return [...chunks].sort((a, b) =>
    (ranks.get(a.path) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(b.path) ?? Number.MAX_SAFE_INTEGER)
  );
}

export const reviewGuidePriorityDescriptions: Record<GitReviewGuidePriority, string> = {
  focus: 'Consequential behavior to understand',
  review: 'Read with normal focus',
  skim: 'Mechanical changes to skim'
};

export function visibleReviewGuideFiles(unit: VisibleReviewUnit | undefined, guide: GitReviewGuideUnit | undefined): GitReviewGuideFile[] {
  if (!unit || !guide) return [];
  return [...new Set(unit.visibleChunks.map((chunk) => chunk.path))].flatMap((path) => {
    const file = guide.files.find((item) => item.path === path);
    if (!file) return [];
    const line = file.line;
    // Filters can hide the suggested hunk while leaving other hunks of this file visible.
    return [{ ...file, line: line && unit.visibleChunks.some((chunk) =>
      chunk.path === path && reviewGuidePatchAddsLine(chunk.patch, line)
    ) ? line : undefined }];
  });
}
