import { reviewGuidePatchLines } from './reviewGuide';
import type { GitReviewPlan } from './types';

// The pull-request Tour: one AI run writes the Overview text and a walk through the change as steps.
// Each step states behaviour through points anchored to the lines that make it true.

export const PULL_REQUEST_TOUR_VERSION = 2;
export const PULL_REQUEST_TOUR_RISKS = ['low', 'medium', 'high'] as const;
export type PullRequestTourRisk = (typeof PULL_REQUEST_TOUR_RISKS)[number];
export const PULL_REQUEST_TOUR_ATTENTION_KINDS = ['tradeoff', 'contract', 'product', 'risk', 'accessibility'] as const;
export type PullRequestTourAttentionKind = (typeof PULL_REQUEST_TOUR_ATTENTION_KINDS)[number];

// A point with null `start`/`end` is text only: it could not be placed on the diff.
export type PullRequestTourPoint = {
  body: string;
  path: string;
  side: 'new' | 'old';
  start: number | null;
  end: number | null;
};

export type PullRequestTourStop = {
  title: string;
  summary: string;
  kind: 'behavior' | 'mechanical';
  risk: PullRequestTourRisk | null;
  attention: { kind: PullRequestTourAttentionKind; note: string } | null;
  points: PullRequestTourPoint[];
  // Files this step owns; a file with points elsewhere may also show in those steps.
  files: Array<{ path: string; note: string }>;
  questions: string[];
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
const MAX_POINTS = 6;
const MAX_HIGHLIGHTS = 4;
const MAX_QUESTIONS = 2;

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

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';
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
    const title = text(stop.title, 200);
    if (!title) return [];
    const attentionRecord = record(stop.attention);
    const attentionKind = PULL_REQUEST_TOUR_ATTENTION_KINDS.find((candidate) => candidate === attentionRecord.kind);
    const attentionNote = text(attentionRecord.note, 600);
    const points = list(stop.points).flatMap((item): PullRequestTourPoint[] => {
      const point = record(item);
      const body = text(point.body, 600);
      const path = text(point.path, 1000);
      if (!body || !hunks.has(path)) return [];
      const side = point.side === 'old' ? 'old' : 'new';
      const start = integer(point.start);
      const end = Math.max(start ?? 0, integer(point.end) ?? 0);
      const fitted = start === undefined ? undefined : fitRange({ side, start, end }, hunks.get(path)!);
      return [{ body, path, side, start: fitted?.start ?? null, end: fitted?.end ?? null }];
    }).slice(0, MAX_POINTS);
    // A file listed by an earlier step stays there.
    const files = list(stop.files).flatMap((item) => {
      const file = record(item);
      const path = text(file.path, 1000);
      if (!hunks.has(path) || owned.has(path)) return [];
      owned.add(path);
      return [{ path, note: text(file.note, 240) }];
    });
    return [{
      title,
      summary: text(stop.summary, 1200),
      kind: stop.kind === 'mechanical' ? 'mechanical' : 'behavior',
      risk: risk(stop.risk),
      attention: attentionKind && attentionNote ? { kind: attentionKind, note: attentionNote } : null,
      points,
      files,
      questions: list(stop.questions).map((question) => text(question, 240)).filter(Boolean).slice(0, MAX_QUESTIONS)
    }];
  });

  // A file no step lists is owned by the first step with a point on it; anything left joins the last step.
  for (const stop of stops) for (const point of stop.points) owned.add(point.path);
  const unplaced = [...hunks.keys()].filter((path) => !owned.has(path)).map((path) => ({ path, note: '' }));
  if (unplaced.length) {
    if (stops.length) stops.at(-1)!.files.push(...unplaced);
    else stops.push({
      title: 'The change', summary: '', kind: 'behavior', risk: null, attention: null, points: [], files: unplaced, questions: []
    });
  }

  const overview = record(record(raw).overview);
  return {
    overview: {
      risk: highestRisk([risk(overview.risk), ...stops.map((stop) => stop.risk)]),
      summary: text(overview.summary, 600),
      highlights: list(overview.highlights).map((item) => text(item, 400)).filter(Boolean).slice(0, MAX_HIGHLIGHTS),
      partial: false
    },
    stops
  };
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
