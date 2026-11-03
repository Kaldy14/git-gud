import { reviewGuidePatchLines } from './reviewGuide';
import type { GitReviewPlan } from './types';

// The pull-request Guide: an AI-written tour of the change in reading order.
// Its shape follows T3 Code's review guide so prompts and UI stay comparable.

export const PULL_REQUEST_TOUR_ATTENTION_KINDS = ['tradeoff', 'contract', 'product', 'risk', 'accessibility'] as const;
export type PullRequestTourAttentionKind = (typeof PULL_REQUEST_TOUR_ATTENTION_KINDS)[number];

export type PullRequestTourExcerpt = {
  path: string;
  side: 'new' | 'old';
  start: number;
  end: number;
  caption: string;
};

export type PullRequestTourNote = { path: string; line: number; title: string; body: string };

export type PullRequestTourStop = {
  title: string;
  summary: string;
  attention: { kind: PullRequestTourAttentionKind; note: string } | null;
  excerpts: PullRequestTourExcerpt[];
  files: Array<{ path: string; note: string }>;
  notes: PullRequestTourNote[];
  questions: string[];
};

export type PullRequestTour = {
  headSha: string;
  sourceFingerprint: string;
  generatedAt: string;
  stops: PullRequestTourStop[];
};

export type PullRequestTourState = {
  // The latest finished tour, possibly written for an older head.
  tour: PullRequestTour | null;
  running: boolean;
  errorMessage?: string;
};

// Pull-request text the prompt needs but the review plan does not carry.
export type PullRequestTourContext = {
  body: string;
  baseRefName: string;
  settledReview: string;
};

const MAX_STOPS = 8;
const MAX_EXCERPT_LINES = 60;
const MAX_NOTES = 3;
const MAX_QUESTIONS = 2;

type PatchRow = ReturnType<typeof reviewGuidePatchLines>[number];
type Hunk = { rows: PatchRow[] };

const sideKey = (side: PullRequestTourExcerpt['side']) => (side === 'new' ? 'right' : 'left');

// Every hunk of each changed path, keyed by path. Chunk hunks are numbered per chunk.
export function pullRequestTourHunks(plan: Pick<GitReviewPlan, 'units'>): Map<string, Hunk[]> {
  const hunks = new Map<string, Hunk[]>();
  for (const chunk of plan.units.flatMap((unit) => unit.chunks)) {
    const byNumber = new Map<number, PatchRow[]>();
    for (const row of reviewGuidePatchLines(chunk.patch)) {
      byNumber.set(row.hunk, [...(byNumber.get(row.hunk) ?? []), row]);
    }
    const list = hunks.get(chunk.path) ?? [];
    list.push(...[...byNumber.values()].map((rows) => ({ rows })));
    hunks.set(chunk.path, list);
  }
  return hunks;
}

function excerptRowRange(hunk: Hunk, excerpt: Pick<PullRequestTourExcerpt, 'side' | 'start' | 'end'>) {
  const key = sideKey(excerpt.side);
  const indexes = hunk.rows.flatMap((row, index) => {
    const line = row[key];
    return line !== undefined && line >= excerpt.start && line <= excerpt.end ? [index] : [];
  });
  return indexes.length ? { first: indexes[0]!, last: indexes.at(-1)! } : undefined;
}

// Clamp an excerpt to the single hunk holding its start line, or drop it.
function fitExcerpt(excerpt: PullRequestTourExcerpt, hunks: readonly Hunk[]): PullRequestTourExcerpt | undefined {
  const key = sideKey(excerpt.side);
  const hunk = hunks.find((candidate) => candidate.rows.some((row) => row[key] === excerpt.start)) ??
    hunks.find((candidate) => candidate.rows.some((row) => {
      const line = row[key];
      return line !== undefined && line >= excerpt.start && line <= excerpt.end;
    }));
  if (!hunk) return undefined;
  const lines = hunk.rows.flatMap((row) => {
    const line = row[key];
    return line !== undefined && line >= excerpt.start && line <= excerpt.end ? [line] : [];
  });
  if (!lines.length) return undefined;
  const start = Math.min(...lines);
  const end = Math.min(Math.max(...lines), start + MAX_EXCERPT_LINES - 1);
  return { ...excerpt, start, end };
}

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';
const integer = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

// Keep what can be shown faithfully: excerpts inside one real hunk, notes inside an excerpt,
// and every changed file placed in exactly one stop.
export function normalizePullRequestTour(raw: unknown, plan: Pick<GitReviewPlan, 'units'>): PullRequestTourStop[] {
  const hunks = pullRequestTourHunks(plan);
  const changedPaths = [...new Set(plan.units.flatMap((unit) => unit.chunks.map((chunk) => chunk.path)))];
  const placed = new Set<string>();

  const stops = list(record(raw).stops).slice(0, MAX_STOPS).flatMap((value): PullRequestTourStop[] => {
    const stop = record(value);
    const title = text(stop.title, 160);
    if (!title) return [];
    const attentionRecord = record(stop.attention);
    const kind = PULL_REQUEST_TOUR_ATTENTION_KINDS.find((candidate) => candidate === attentionRecord.kind);
    const attentionNote = text(attentionRecord.note, 600);
    const excerpts = list(stop.excerpts).flatMap((item): PullRequestTourExcerpt[] => {
      const excerpt = record(item);
      const path = text(excerpt.path, 1000);
      const start = integer(excerpt.start);
      const end = integer(excerpt.end) ?? start;
      const side = excerpt.side === 'old' ? 'old' : 'new';
      if (!path || start === undefined || end === undefined) return [];
      const fitted = fitExcerpt({ path, side, start, end: Math.max(start, end), caption: text(excerpt.caption, 200) }, hunks.get(path) ?? []);
      return fitted ? [fitted] : [];
    });
    const excerptPaths = new Set(excerpts.map((excerpt) => excerpt.path));
    const files = list(stop.files).flatMap((item) => {
      const file = record(item);
      const path = text(file.path, 1000);
      return path && hunks.has(path) && !excerptPaths.has(path) ? [{ path, note: text(file.note, 200) }] : [];
    });
    // Excerpts the model placed outside the diff fall back to file rows.
    for (const item of list(stop.excerpts)) {
      const path = text(record(item).path, 1000);
      if (hunks.has(path) && !excerptPaths.has(path) && !files.some((file) => file.path === path)) files.push({ path, note: '' });
    }
    const notes = list(stop.notes).flatMap((item): PullRequestTourNote[] => {
      const note = record(item);
      const path = text(note.path, 1000);
      const line = integer(note.line);
      const noteTitle = text(note.title, 120);
      if (!noteTitle || line === undefined) return [];
      const inside = excerpts.some((excerpt) => excerpt.path === path && line >= excerpt.start && line <= excerpt.end);
      return inside ? [{ path, line, title: noteTitle, body: text(note.body, 600) }] : [];
    }).slice(0, MAX_NOTES);
    const questions = list(stop.questions).map((question) => text(question, 240)).filter(Boolean).slice(0, MAX_QUESTIONS);
    for (const path of [...excerptPaths, ...files.map((file) => file.path)]) placed.add(path);
    return [{
      title,
      summary: text(stop.summary, 1200),
      attention: kind && attentionNote ? { kind, note: attentionNote } : null,
      excerpts,
      files: files.filter((file, index) => files.findIndex((other) => other.path === file.path) === index),
      notes,
      questions
    }];
  });

  // A file excerpted anywhere needs no file row; a listed file stays in its first stop.
  const listed = new Set<string>();
  for (const stop of stops) {
    stop.files = stop.files.filter((file) => {
      const excerptedAnywhere = stops.some((other) => other.excerpts.some((excerpt) => excerpt.path === file.path));
      if (listed.has(file.path) || excerptedAnywhere) return false;
      listed.add(file.path);
      return true;
    });
  }

  const unplaced = changedPaths.filter((path) => !placed.has(path));
  if (unplaced.length) {
    const rest = unplaced.map((path) => ({ path, note: '' }));
    if (stops.length) stops.at(-1)!.files.push(...rest);
    else stops.push({ title: 'The change', summary: '', attention: null, excerpts: [], files: rest, notes: [], questions: [] });
  }
  return stops;
}

// Lettered markers (A, B, …) tie each note to its line in the stop's excerpts.
export function letterTourNotes(stop: Pick<PullRequestTourStop, 'notes'>) {
  return stop.notes.map((note, index) => ({ marker: String.fromCharCode(65 + (index % 26)), note }));
}

export type PullRequestTourExcerptSlice = {
  patch: string;
  additions: number;
  deletions: number;
};

// Build a one-hunk unified patch with only the excerpt's rows, so the diff renderer shows
// real line numbers without the surrounding hunk.
export function pullRequestTourExcerptPatch(
  plan: Pick<GitReviewPlan, 'units'>,
  excerpt: Pick<PullRequestTourExcerpt, 'path' | 'side' | 'start' | 'end'>,
  hunks = pullRequestTourHunks(plan)
): PullRequestTourExcerptSlice | undefined {
  for (const hunk of hunks.get(excerpt.path) ?? []) {
    const range = excerptRowRange(hunk, excerpt);
    if (!range) continue;
    const rows = hunk.rows.slice(range.first, range.last + 1);
    const before = hunk.rows.slice(0, range.first);
    const nextLine = (key: 'left' | 'right') =>
      rows.find((row) => row[key] !== undefined)?.[key] ??
      ([...before].reverse().find((row) => row[key] !== undefined)?.[key] ?? 0) + 1;
    const oldCount = rows.filter((row) => row.left !== undefined).length;
    const newCount = rows.filter((row) => row.right !== undefined).length;
    // Git writes the line before an empty side as its start.
    const oldStart = oldCount ? nextLine('left') : nextLine('left') - 1;
    const newStart = newCount ? nextLine('right') : nextLine('right') - 1;
    const patch = [
      `--- a/${excerpt.path}`,
      `+++ b/${excerpt.path}`,
      `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
      ...rows.map((row) => row.text),
      ''
    ].join('\n');
    return {
      patch,
      additions: rows.filter((row) => row.text.startsWith('+')).length,
      deletions: rows.filter((row) => row.text.startsWith('-')).length
    };
  }
  return undefined;
}

// Resolved or outdated threads, one line each, so the guide does not re-raise settled points.
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
