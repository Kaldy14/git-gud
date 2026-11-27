import { pullRequestTourHunks, type PullRequestTour, type PullRequestTourFlow, type PullRequestTourPoint } from '@shared/pullRequestTour';
import type { GitReviewPlan } from '@shared/types';

// Numbers behind the Tour's pictures (footprint bars, point positions, progress segment widths). All of it
// comes from the loaded plan, never from the model.

type Span = { min: number; max: number };
type HunkStat = { new: Span | null; old: Span | null; added: number; removed: number };
export type TourLineCount = { added: number; removed: number };
export type TourFileStat = { additions: number; deletions: number; spans: { new: Span | null; old: Span | null }; hunks: HunkStat[] };

// Parsing every patch is not free on a large pull request, so it is done once per loaded plan.
const statsCache = new WeakMap<object, Map<string, TourFileStat>>();

/** Per changed file: its line counts and the first and last line its hunks show on each side. */
export function tourFileStats(plan: Pick<GitReviewPlan, 'units'>): Map<string, TourFileStat> {
  const cached = statsCache.get(plan.units);
  if (cached) return cached;
  const stats = new Map<string, TourFileStat>();
  statsCache.set(plan.units, stats);
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
      const hunkStat: HunkStat = { new: null, old: null, added: 0, removed: 0 };
      for (const row of hunk.rows) {
        hunkStat.new = widen(hunkStat.new, row.right);
        hunkStat.old = widen(hunkStat.old, row.left);
        if (row.left === undefined && row.right !== undefined) hunkStat.added += 1;
        if (row.right === undefined && row.left !== undefined) hunkStat.removed += 1;
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
export function tourStepLines(tour: Pick<PullRequestTour, 'stops'>, stats: ReadonlyMap<string, TourFileStat>): TourLineCount[] {
  const owner = new Map<string, number>();
  tour.stops.forEach((stop, step) => { for (const file of stop.files) if (!owner.has(file.path)) owner.set(file.path, step); });
  tour.stops.forEach((stop, step) => { for (const point of stop.points) if (!owner.has(point.path)) owner.set(point.path, step); });
  const lines = tour.stops.map(() => ({ added: 0, removed: 0 }));
  for (const [path, stat] of stats) {
    // A file too large to send has no hunks; its counts go to its owner whole.
    const owned = owner.get(path);
    if (!stat.hunks.length && owned !== undefined) {
      lines[owned]!.added += stat.additions;
      lines[owned]!.removed += stat.deletions;
    }
    for (const hunk of stat.hunks) {
      const step = tour.stops.findIndex((stop) => stop.points.some((point) => {
        const span = hunk[point.side];
        return point.path === path && point.start !== null && span !== null && point.start >= span.min && point.start <= span.max;
      }));
      const target = step >= 0 ? step : owner.get(path);
      if (target === undefined) continue;
      lines[target]!.added += hunk.added;
      lines[target]!.removed += hunk.removed;
    }
  }
  return lines;
}

/** A progress segment's flex weight: bigger steps are wider, on a log scale so one huge step cannot crowd the rest out. */
export function tourSegmentWeight({ added, removed }: TourLineCount): number {
  return Math.min(4, Math.max(1, Math.log2(added + removed + 2) / 2));
}

// Flow geometry in the step panel: rows top to bottom (the panel is narrow and tall), x in percent of the
// panel width so nothing needs measuring, y in pixels.
export const FLOW_NODE_HEIGHT = 28;
export const FLOW_ROW_GAP = 30;
const FLOW_GAP_PERCENT = 4;
const FLOW_MAX_NODE_PERCENT = 64;
// Lanes for edges that skip a row, right of the boxes they pass.
const FLOW_LANE_PERCENT = 78;
const FLOW_LANE_STEP = 6;

export type TourFlowBox = { id: string; row: number; x: number; width: number; y: number };
// `lane` is set for an edge that skips rows: it runs down that x instead of through the boxes between.
export type TourFlowLine = { from: string; to: string; label: string; x1: number; y1: number; x2: number; y2: number; lane: number | null };

/**
 * Lays a validated flow out in rows: a node's row is the longest path to it from a node nothing points to,
 * so every edge points down. Within a row nodes keep the order the model gave and share the width. An edge
 * that skips rows gets a lane on the right, and the rows it passes are packed left of that lane, so no line
 * ever runs behind a box.
 */
export function layoutTourFlow(flow: PullRequestTourFlow): { boxes: TourFlowBox[]; lines: TourFlowLine[]; height: number } {
  const row = new Map(flow.nodes.map((node) => [node.id, 0]));
  // At most n - 1 passes settle the longest paths of an acyclic graph.
  for (let pass = 0; pass < flow.nodes.length; pass += 1) {
    for (const edge of flow.edges) row.set(edge.to, Math.max(row.get(edge.to)!, row.get(edge.from)! + 1));
  }
  const rows = Math.max(0, ...row.values()) + 1;
  const lanes = new Map<TourFlowEdgeKey, number>();
  for (const edge of flow.edges) {
    if (row.get(edge.to)! - row.get(edge.from)! > 1) lanes.set(`${edge.from}>${edge.to}`, FLOW_LANE_PERCENT - lanes.size * FLOW_LANE_STEP);
  }
  // The right edge a row's boxes must stay left of: the innermost lane passing through it.
  const limit = (index: number) => Math.min(100, ...flow.edges.flatMap((edge) => {
    const lane = lanes.get(`${edge.from}>${edge.to}`);
    return lane !== undefined && row.get(edge.from)! < index && row.get(edge.to)! > index ? [lane - FLOW_GAP_PERCENT] : [];
  }));

  const boxes: TourFlowBox[] = [];
  for (let index = 0; index < rows; index += 1) {
    const members = flow.nodes.filter((node) => row.get(node.id) === index);
    const room = limit(index);
    const width = Math.min(FLOW_MAX_NODE_PERCENT, (room - FLOW_GAP_PERCENT * (members.length - 1)) / members.length);
    const start = (room - (width * members.length + FLOW_GAP_PERCENT * (members.length - 1))) / 2;
    members.forEach((node, position) => boxes.push({
      id: node.id, row: index, width, x: start + position * (width + FLOW_GAP_PERCENT), y: index * (FLOW_NODE_HEIGHT + FLOW_ROW_GAP)
    }));
  }
  const box = new Map(boxes.map((item) => [item.id, item]));
  const lines = flow.edges.map((edge) => {
    const from = box.get(edge.from)!;
    const to = box.get(edge.to)!;
    const lane = lanes.get(`${edge.from}>${edge.to}`) ?? null;
    // A lane edge leaves and enters its boxes as near the lane as the boxes allow.
    const attach = (target: TourFlowBox) => lane === null ? target.x + target.width / 2 : Math.min(target.x + target.width - 4, Math.max(target.x + 4, lane));
    return { ...edge, lane, x1: attach(from), y1: from.y + FLOW_NODE_HEIGHT, x2: attach(to), y2: to.y };
  });
  return { boxes, lines, height: rows * FLOW_NODE_HEIGHT + (rows - 1) * FLOW_ROW_GAP };
}

type TourFlowEdgeKey = `${string}>${string}`;
