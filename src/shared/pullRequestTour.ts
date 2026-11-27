import { reviewGuidePatchLines } from './reviewGuide';
import type { GitReviewPlan } from './types';

// The pull-request Tour: one AI run writes the Overview text and a walk through the change as steps.
// Each step states behaviour through points anchored to the lines that make it true. The text is read
// beside the code, so it is short labelled fields (before/now, point headlines, a flow) rather than prose.

// 3: before/now `change`, point `label`, step `flow`; `questions` removed.
export const PULL_REQUEST_TOUR_VERSION = 3;
export const PULL_REQUEST_TOUR_RISKS = ['low', 'medium', 'high'] as const;
export type PullRequestTourRisk = (typeof PULL_REQUEST_TOUR_RISKS)[number];
export const PULL_REQUEST_TOUR_ATTENTION_KINDS = ['tradeoff', 'contract', 'product', 'risk', 'accessibility'] as const;
export type PullRequestTourAttentionKind = (typeof PULL_REQUEST_TOUR_ATTENTION_KINDS)[number];

// A point with null `start`/`end` is text only: it could not be placed on the diff.
export type PullRequestTourPoint = {
  // A few words to scan in a list; `body` is the full sentence shown beside the code.
  label: string;
  body: string;
  path: string;
  side: 'new' | 'old';
  start: number | null;
  end: number | null;
};

export const PULL_REQUEST_TOUR_FLOW_STATES = ['changed', 'added', 'removed', 'context'] as const;
export type PullRequestTourFlowState = (typeof PULL_REQUEST_TOUR_FLOW_STATES)[number];

// A node that names code carries the point (index into the step's points) or changed file it stands for;
// a `context` node is an unchanged part with neither.
export type PullRequestTourFlowNode = {
  id: string;
  label: string;
  state: PullRequestTourFlowState;
  point: number | null;
  path: string | null;
};
export type PullRequestTourFlowEdge = { from: string; to: string; label: string };
// A small acyclic graph of how data or control moves through a step, drawn in the direction it moves.
export type PullRequestTourFlow = { nodes: PullRequestTourFlowNode[]; edges: PullRequestTourFlowEdge[] };

export type PullRequestTourStop = {
  title: string;
  // Why the step matters for the next ones (behaviour), or what was checked (mechanical). One sentence.
  summary: string;
  kind: 'behavior' | 'mechanical';
  risk: PullRequestTourRisk | null;
  // What a user or caller saw before and sees now.
  change: { before: string; after: string } | null;
  attention: { kind: PullRequestTourAttentionKind; note: string } | null;
  points: PullRequestTourPoint[];
  // Files this step owns; a file with points elsewhere may also show in those steps.
  files: Array<{ path: string; note: string }>;
  flow: PullRequestTourFlow | null;
};

export type PullRequestTourOverview = {
  risk: PullRequestTourRisk | null;
  summary: string;
  highlights: string[];
  // Some changed file was omitted or truncated in the prompt, so the text rests on part of the diff.
  partial: boolean;
};

export type PullRequestTour = {
  version: typeof PULL_REQUEST_TOUR_VERSION;
  headSha: string;
  // Absent on tours written before the base was recorded.
  baseSha?: string;
  sourceFingerprint: string;
  generatedAt: string;
  overview: PullRequestTourOverview;
  stops: PullRequestTourStop[];
};

export type PullRequestTourState = {
  // The latest finished tour, possibly written for an older head.
  tour: PullRequestTour | null;
  running: boolean;
  errorMessage?: string;
  // A tour is stored in a format this version no longer shows.
  outdatedFormat?: boolean;
};

// Pull-request text the prompt needs but the review plan does not carry.
export type PullRequestTourContext = {
  body: string;
  baseRefName: string;
  baseSha: string;
  settledReview: string;
};

const MAX_STOPS = 10;
const MAX_POINTS = 5;
const MAX_HIGHLIGHTS = 3;
const MAX_FLOW_NODES = 5;
const MAX_FLOW_EDGES = 6;
const MAX_CONTEXT_NODES = 2;
// The prompt asks for word budgets; these character caps are the backstop.
const LIMITS = {
  title: 140, summary: 320, change: 140, attention: 220, label: 60, body: 320, fileNote: 100,
  overviewSummary: 320, highlight: 220, flowLabel: 40
} as const;
const LABEL_WORDS = 7;

type PatchRow = ReturnType<typeof reviewGuidePatchLines>[number];
type Hunk = { rows: PatchRow[] };

// Every hunk of each changed path, keyed by path. Chunk hunks are numbered per chunk.
export function pullRequestTourHunks(plan: Pick<GitReviewPlan, 'units'>): Map<string, Hunk[]> {
  const hunks = new Map<string, Hunk[]>();
  for (const chunk of plan.units.flatMap((unit) => unit.chunks)) {
    const byNumber = new Map<number, PatchRow[]>();
    for (const row of reviewGuidePatchLines(chunk.patch)) {
      const rows = byNumber.get(row.hunk);
      if (rows) rows.push(row);
      else byNumber.set(row.hunk, [row]);
    }
    const list = hunks.get(chunk.path) ?? [];
    list.push(...[...byNumber.values()].map((rows) => ({ rows })));
    hunks.set(chunk.path, list);
  }
  return hunks;
}

// Trim a range to the single hunk holding its start line (or, failing that, any of its lines).
function fitRange(
  range: { side: PullRequestTourPoint['side']; start: number; end: number },
  hunks: readonly Hunk[]
): { start: number; end: number } | undefined {
  const key = range.side === 'new' ? 'right' : 'left';
  const inRange = (row: PatchRow) => {
    const line = row[key];
    return line !== undefined && line >= range.start && line <= range.end;
  };
  const hunk = hunks.find((candidate) => candidate.rows.some((row) => row[key] === range.start)) ??
    hunks.find((candidate) => candidate.rows.some(inRange));
  const lines = hunk?.rows.filter(inRange).map((row) => row[key]!) ?? [];
  return lines.length ? { start: Math.min(...lines), end: Math.max(...lines) } : undefined;
}

// Over-long text is cut at its last sentence end, or else its last word, never mid-word.
export function clipText(value: string, max: number): string {
  const trimmed = value.trim().replace(/\s+/gu, ' ');
  if (trimmed.length <= max) return trimmed;
  const head = trimmed.slice(0, max);
  const sentence = head.search(/[.!?](?=\s)[^.!?]*$/u);
  if (sentence > max / 2) return closeCode(head.slice(0, sentence + 1));
  const space = head.lastIndexOf(' ');
  return `${closeCode((space > 0 ? head.slice(0, space) : head).replace(/[\s,;:]+$/u, ''))}…`;
}

// A cut inside `inline code` closes it, so the text never shows a stray backtick.
function closeCode(value: string): string {
  return (value.match(/`/gu)?.length ?? 0) % 2 ? `${value}\`` : value;
}
const text = (value: unknown, max: number): string => (typeof value === 'string' ? clipText(value, max) : '');

/** A point's headline when the model gave none: the first clause of its sentence, at most a few words. */
export function pointHeadline(body: string): string {
  const clause = body.split(/[.;:,](?:\s|$)|\s(?:so|because|which|while)\s|\s[—–]\s/u)[0]!.trim();
  const words = clause.split(' ');
  return words.length > LABEL_WORDS ? `${closeCode(words.slice(0, LABEL_WORDS).join(' '))}…` : closeCode(clause);
}
const integer = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const risk = (value: unknown): PullRequestTourRisk | null =>
  PULL_REQUEST_TOUR_RISKS.find((candidate) => candidate === value) ?? null;

function highestRisk(risks: ReadonlyArray<PullRequestTourRisk | null>): PullRequestTourRisk | null {
  const rank = Math.max(-1, ...risks.map((value) => (value ? PULL_REQUEST_TOUR_RISKS.indexOf(value) : -1)));
  return rank < 0 ? null : PULL_REQUEST_TOUR_RISKS[rank]!;
}

// Keep what can be shown faithfully: points inside one real hunk (or text-only on a changed file)
// and every changed file owned by exactly one step.
export function normalizePullRequestTour(
  raw: unknown,
  plan: Pick<GitReviewPlan, 'units'>
): Pick<PullRequestTour, 'overview' | 'stops'> {
  const hunks = pullRequestTourHunks(plan);
  const owned = new Set<string>();

  const stops = list(record(raw).stops).slice(0, MAX_STOPS).flatMap((value): PullRequestTourStop[] => {
    const stop = record(value);
    const title = text(stop.title, LIMITS.title);
    if (!title) return [];
    const attentionRecord = record(stop.attention);
    const attentionKind = PULL_REQUEST_TOUR_ATTENTION_KINDS.find((candidate) => candidate === attentionRecord.kind);
    const attentionNote = text(attentionRecord.note, LIMITS.attention);
    // The model's flow names points by its own index; `kept` maps that index to the point's place here.
    const points: PullRequestTourPoint[] = [];
    const kept = new Map<number, number>();
    list(stop.points).forEach((item, index) => {
      const point = record(item);
      const body = text(point.body, LIMITS.body);
      const path = typeof point.path === 'string' ? point.path.trim() : '';
      if (!body || !hunks.has(path) || points.length >= MAX_POINTS) return;
      const side = point.side === 'old' ? 'old' : 'new';
      const start = integer(point.start);
      const end = Math.max(start ?? 0, integer(point.end) ?? 0);
      const fitted = start === undefined ? undefined : fitRange({ side, start, end }, hunks.get(path)!);
      const label = text(point.label, LIMITS.label) || pointHeadline(body);
      kept.set(index, points.length);
      points.push({ label, body, path, side, start: fitted?.start ?? null, end: fitted?.end ?? null });
    });
    // A file listed by an earlier step stays there.
    const files = list(stop.files).flatMap((item) => {
      const file = record(item);
      const path = typeof file.path === 'string' ? file.path.trim() : '';
      if (!hunks.has(path) || owned.has(path)) return [];
      owned.add(path);
      return [{ path, note: text(file.note, LIMITS.fileNote) }];
    });
    const changeRecord = record(stop.change);
    const before = text(changeRecord.before, LIMITS.change);
    const after = text(changeRecord.after, LIMITS.change);
    const kind = stop.kind === 'mechanical' ? 'mechanical' : 'behavior';
    return [{
      title,
      summary: text(stop.summary, LIMITS.summary),
      kind,
      risk: risk(stop.risk),
      change: before && after ? { before, after } : null,
      attention: attentionKind && attentionNote ? { kind: attentionKind, note: attentionNote } : null,
      points,
      files,
      flow: kind === 'behavior' ? normalizeFlow(stop.flow, points, kept, new Set(tourStepPaths({ points, files }))) : null
    }];
  });

  // A file no step lists is owned by the first step with a point on it; anything left joins the last step.
  for (const stop of stops) for (const point of stop.points) owned.add(point.path);
  const unplaced = [...hunks.keys()].filter((path) => !owned.has(path)).map((path) => ({ path, note: '' }));
  if (unplaced.length) {
    if (stops.length) stops.at(-1)!.files.push(...unplaced);
    else stops.push({
      title: 'The change', summary: '', kind: 'behavior', risk: null, change: null, attention: null, points: [], files: unplaced, flow: null
    });
  }

  const overview = record(record(raw).overview);
  return {
    overview: {
      risk: highestRisk([risk(overview.risk), ...stops.map((stop) => stop.risk)]),
      summary: text(overview.summary, LIMITS.overviewSummary),
      highlights: list(overview.highlights).map((item) => text(item, LIMITS.highlight)).filter(Boolean).slice(0, MAX_HIGHLIGHTS),
      partial: false
    },
    stops
  };
}

/**
 * Keep only a flow that rests on the diff: a node that is not `context` must name one of the step's points
 * or one of the step's files, at most two context nodes each joined to a node that names code, edges between known
 * nodes without cycles, and no node left unconnected. Fewer than three nodes, or fewer than two that name
 * code, is no flow: the step shows its before/now instead.
 */
function normalizeFlow(
  raw: unknown,
  points: readonly PullRequestTourPoint[],
  pointIndexes: ReadonlyMap<number, number>,
  stepPaths: ReadonlySet<string>
): PullRequestTourFlow | null {
  const flow = record(raw);
  const nodes = new Map<string, PullRequestTourFlowNode>();
  let contextNodes = 0;
  for (const item of list(flow.nodes)) {
    const node = record(item);
    const id = typeof node.id === 'string' ? node.id.trim() : '';
    const label = text(node.label, LIMITS.flowLabel);
    const state = PULL_REQUEST_TOUR_FLOW_STATES.find((candidate) => candidate === node.state);
    if (!id || !label || !state || nodes.has(id) || nodes.size >= MAX_FLOW_NODES) continue;
    if (state === 'context') {
      if (contextNodes >= MAX_CONTEXT_NODES) continue;
      contextNodes += 1;
      nodes.set(id, { id, label, state, point: null, path: null });
      continue;
    }
    const pointIndex = typeof node.point === 'number' ? pointIndexes.get(node.point) ?? null : null;
    // A file must be one this step shows, so the box can open it here.
    const path = pointIndex !== null ? points[pointIndex]!.path : typeof node.path === 'string' && stepPaths.has(node.path.trim()) ? node.path.trim() : null;
    if (path === null) continue;
    nodes.set(id, { id, label, state, point: pointIndex, path });
  }

  // Edges in the order given; one that would close a cycle is dropped.
  const edges: PullRequestTourFlowEdge[] = [];
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const current = stack.pop()!;
      if (current === to) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const edge of edges) if (edge.from === current) stack.push(edge.to);
    }
    return false;
  };
  for (const item of list(flow.edges)) {
    const edge = record(item);
    const from = typeof edge.from === 'string' ? edge.from.trim() : '';
    const to = typeof edge.to === 'string' ? edge.to.trim() : '';
    if (edges.length >= MAX_FLOW_EDGES || from === to || !nodes.has(from) || !nodes.has(to)) continue;
    if (edges.some((known) => known.from === from && known.to === to) || reaches(to, from)) continue;
    edges.push({ from, to, label: text(edge.label, LIMITS.flowLabel) });
  }

  // A context node must touch a node that names code; then every node must touch an edge.
  const named = (id: string) => nodes.get(id)?.state !== 'context';
  for (const node of [...nodes.values()]) {
    if (node.state === 'context' && !edges.some((edge) =>
      (edge.from === node.id && named(edge.to)) || (edge.to === node.id && named(edge.from)))) nodes.delete(node.id);
  }
  const kept = edges.filter((edge) => nodes.has(edge.from) && nodes.has(edge.to));
  for (const id of [...nodes.keys()]) if (!kept.some((edge) => edge.from === id || edge.to === id)) nodes.delete(id);

  const result = [...nodes.values()];
  return result.length >= 3 && result.filter((node) => node.state !== 'context').length >= 2
    ? { nodes: result, edges: kept }
    : null;
}

/** A step's files in display order: the files its points reference (in point order), then the files it owns. */
export function tourStepPaths(stop: Pick<PullRequestTourStop, 'points' | 'files'>): string[] {
  return [...new Set([...stop.points.map((point) => point.path), ...stop.files.map((file) => file.path)])];
}

/** Every point as text only, for a tour written before the latest push whose line numbers may have moved. */
export function unanchorTourPoints(tour: PullRequestTour): PullRequestTour {
  return {
    ...tour,
    stops: tour.stops.map((stop) => ({
      ...stop,
      points: stop.points.map((point) => ({ ...point, start: null, end: null }))
    }))
  };
}

// Resolved or outdated threads, one line each, so the tour does not re-raise settled points.
export function settledReviewSummary(comments: ReadonlyArray<{
  path: string; author: string; body: string; inReplyToId?: number; isResolved?: boolean; isOutdated?: boolean;
}>): string {
  return comments
    .filter((comment) => comment.inReplyToId === undefined && (comment.isResolved || comment.isOutdated))
    .map((comment) => {
      const flat = comment.body.replace(/<!--[\s\S]*?-->/gu, '').replace(/\s+/gu, ' ').trim();
      const body = flat.length > 200 ? `${flat.slice(0, 200)}…` : flat;
      return `- ${comment.path} (${comment.isResolved ? 'resolved' : 'outdated'}, ${comment.author}): ${body}`;
    })
    .join('\n')
    .slice(0, 8_000);
}
