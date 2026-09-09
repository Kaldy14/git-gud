import { reviewGuidePatchChangesRange, reviewGuidePatchContainsLine } from '@shared/reviewGuide';
import type { VisibleReviewUnit } from './reviewFilters';
import type { GitReviewGuide, GitReviewGuideFile, GitReviewGuidePriority, GitReviewGuideUnit, GitReviewPlan, GitReviewGuideSummary } from '@shared/types';

const priorityOrder: Record<GitReviewGuidePriority, number> = { focus: 0, review: 1, skim: 2 };

// This is a presentation-only plan. Progress continues to use the original chunk IDs.
export function createReviewGuidePlan(plan: GitReviewPlan, guide: GitReviewGuide | undefined): GitReviewPlan {
  if (!guide || guide.sourceFingerprint !== plan.sourceFingerprint || guide.targetKey !== plan.targetKey) return plan;
  const originals = new Map(plan.units.map((unit) => [unit.id, unit]));
  const assigned = guide.units.flatMap((layer) => layer.sourceUnitIds ?? [layer.unitId]);
  if (assigned.length !== originals.size || new Set(assigned).size !== originals.size || assigned.some((id) => !originals.has(id))) return plan;
  return { ...plan, units: guide.units.map((layer) => {
    const sources = (layer.sourceUnitIds ?? [layer.unitId]).map((id) => originals.get(id)!);
    return { ...sources[0]!, id: layer.unitId, title: layer.title || sources[0]!.title,
      explanation: layer.why || sources[0]!.explanation, chunks: sources.flatMap((source) => source.chunks) };
  }) };
}

export function guideSummaries(layer: GitReviewGuideUnit | undefined): GitReviewGuideSummary[] {
  if (!layer) return [];
  // Older cached guides have only inline explanations; do not invent complexity for them.
  const order = { high: 0, medium: 1, low: 2 };
  return [...(layer.summaries ?? [])].sort((a, b) => order[a.complexity] - order[b.complexity]);
}

export function summaryIsVisible(summary: GitReviewGuideSummary, unit: VisibleReviewUnit | undefined): boolean {
  return Boolean(unit?.visibleChunks.some((chunk) => chunk.path === summary.path &&
    reviewGuidePatchChangesRange(chunk.patch, summary.line, summary.endLine, summary.side)));
}

export function reviewGuideFileLabel(path: string, files: readonly { path: string }[]): string {
  const parts = path.split('/');
  for (let count = 1; count < parts.length; count += 1) {
    const label = parts.slice(-count).join('/');
    if (!files.some((file) => file.path !== path && file.path.split('/').slice(-count).join('/') === label)) {
      return label;
    }
  }
  return path;
}

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
      chunk.path === path && reviewGuidePatchContainsLine(chunk.patch, line, file.side ?? 'right')
    ) ? line : undefined }];
  });
}
