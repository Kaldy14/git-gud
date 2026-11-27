import { pullRequestTourHunks, type PullRequestTour, type PullRequestTourPoint } from '@shared/pullRequestTour';
import type { GitReviewPlan } from '@shared/types';

// Numbers behind the Tour's pictures (footprint bars, point positions, progress segment widths). All of it
// comes from the loaded plan, never from the model.

type Span = { min: number; max: number };
type HunkStat = { new: Span | null; old: Span | null; changed: number };
export type TourFileStat = { additions: number; deletions: number; spans: { new: Span | null; old: Span | null }; hunks: HunkStat[] };

/** Per changed file: its line counts and the first and last line its hunks show on each side. */
export function tourFileStats(plan: Pick<GitReviewPlan, 'units'>): Map<string, TourFileStat> {
  const stats = new Map<string, TourFileStat>();
  for (const chunk of plan.units.flatMap((unit) => unit.chunks)) {
    const stat = stats.get(chunk.path) ?? { additions: 0, deletions: 0, spans: { new: null, old: null }, hunks: [] };
    stat.additions += chunk.additions;
    stat.deletions += chunk.deletions;
    stats.set(chunk.path, stat);
  }
  const widen = (span: Span | null, line: number | undefined): Span | null =>
    line === undefined ? span : { min: Math.min(span?.min ?? line, line), max: Math.max(span?.max ?? line, line) };
  for (const [path, hunks] of pullRequestTourHunks(plan)) {
    const stat = stats.get(path)!;
    for (const hunk of hunks) {
      const hunkStat: HunkStat = { new: null, old: null, changed: 0 };
      for (const row of hunk.rows) {
        hunkStat.new = widen(hunkStat.new, row.right);
        hunkStat.old = widen(hunkStat.old, row.left);
        if ((row.left === undefined) !== (row.right === undefined)) hunkStat.changed += 1;
      }
      stat.hunks.push(hunkStat);
      stat.spans.new = widen(stat.spans.new, hunkStat.new?.min);
      stat.spans.new = widen(stat.spans.new, hunkStat.new?.max);
      stat.spans.old = widen(stat.spans.old, hunkStat.old?.min);
      stat.spans.old = widen(stat.spans.old, hunkStat.old?.max);
    }
  }
  return stats;
}

/** Where a placed point sits along its file's changed region, from 0 (first hunk) to 1 (last). */
export function tourPointPosition(point: Pick<PullRequestTourPoint, 'side' | 'start'>, stat: TourFileStat | undefined): number | null {
  const span = stat?.spans[point.side];
  if (point.start === null || !span) return null;
  return span.max === span.min ? 0.5 : Math.min(1, Math.max(0, (point.start - span.min) / (span.max - span.min)));
}

/**
 * Changed lines each step stands for. Each hunk counts once: for the first step with a point inside it, else
 * for the step that owns its file (the step that lists it, else the first step with a point on it, the rule
 * `normalizePullRequestTour` applies). A file shared by several steps is split between them this way.
 */
export function tourStepLines(tour: Pick<PullRequestTour, 'stops'>, stats: ReadonlyMap<string, TourFileStat>): number[] {
  const owner = new Map<string, number>();
  tour.stops.forEach((stop, step) => { for (const file of stop.files) if (!owner.has(file.path)) owner.set(file.path, step); });
  tour.stops.forEach((stop, step) => { for (const point of stop.points) if (!owner.has(point.path)) owner.set(point.path, step); });
  const lines = tour.stops.map(() => 0);
  for (const [path, stat] of stats) {
    for (const hunk of stat.hunks) {
      const step = tour.stops.findIndex((stop) => stop.points.some((point) => {
        const span = hunk[point.side];
        return point.path === path && point.start !== null && span !== null && point.start >= span.min && point.start <= span.max;
      }));
      const target = step >= 0 ? step : owner.get(path);
      if (target !== undefined) lines[target]! += hunk.changed;
    }
  }
  return lines;
}

/** A progress segment's flex weight: bigger steps are wider, on a log scale so one huge step cannot crowd the rest out. */
export function tourSegmentWeight(lines: number): number {
  return Math.min(4, Math.max(1, Math.log2(lines + 2) / 2));
}
