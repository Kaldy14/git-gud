import type { GitReviewUnit } from '@shared/types';

/**
 * Names review blocks after the Guide stop that covers at least half of their files, so the
 * sidebar reads like the Guide instead of title-cased path fragments. Units without such a
 * stop keep the grouping engine's title.
 */
export function guideUnitTitles(
  units: readonly GitReviewUnit[],
  stops: ReadonlyArray<{ title: string; paths: readonly string[] }> | undefined
): ReadonlyMap<string, string> {
  const titles = new Map<string, string>();
  if (!stops?.length) return titles;
  const stopPaths = stops.map((stop) => new Set(stop.paths));
  // Each stop names at most one block (the one it covers most), so titles stay unique.
  const claims = new Map<number, { unitId: string; overlap: number }>();
  for (const unit of units) {
    const paths = [...new Set(unit.chunks.map((chunk) => chunk.path))];
    let best = -1;
    let bestOverlap = 0;
    stopPaths.forEach((set, index) => {
      const overlap = paths.filter((path) => set.has(path)).length;
      if (overlap > bestOverlap) { best = index; bestOverlap = overlap; }
    });
    if (best < 0 || bestOverlap * 2 < paths.length) continue;
    const claim = claims.get(best);
    if (!claim || bestOverlap > claim.overlap) claims.set(best, { unitId: unit.id, overlap: bestOverlap });
  }
  for (const [stop, claim] of claims) titles.set(claim.unitId, stops[stop].title);
  return titles;
}
