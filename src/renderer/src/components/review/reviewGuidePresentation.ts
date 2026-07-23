import type { GitReviewGuide } from '@shared/types';

export function rankReviewUnitsByGuide<TUnit extends { unit: { id: string } }>(
  units: readonly TUnit[],
  guide: GitReviewGuide | undefined,
  sourceFingerprint: string | undefined
): TUnit[] {
  if (!guide || guide.sourceFingerprint !== sourceFingerprint) {
    return [...units];
  }

  const ranks = new Map(guide.units.map((unit, index) => [unit.unitId, index]));
  return [...units].sort((left, right) =>
    (ranks.get(left.unit.id) ?? Number.MAX_SAFE_INTEGER) -
    (ranks.get(right.unit.id) ?? Number.MAX_SAFE_INTEGER)
  );
}
