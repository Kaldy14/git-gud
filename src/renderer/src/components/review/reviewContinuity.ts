import type { GitReviewChunk, GitReviewPlan } from '@shared/types';
import { reviewGuidePatchLines } from '@shared/reviewGuide';

export type ReviewCheckpoint = {
  version: 1;
  baseSha: string;
  headSha: string;
  savedAt: string;
  chunks: Array<Pick<GitReviewChunk, 'id' | 'path' | 'patch'> & { unitId: string; seen: boolean }>;
  position?: { chunkId: string; path: string; offset: number };
};

const STORAGE_KEY = 'git-gud:pr-review-checkpoints:v1';
const MAX_CHECKPOINT_CHARS = 750_000;
const MAX_STORE_CHARS = 2_000_000;

// Preserve signs, whitespace and context. Only hunk coordinates may differ.
// The grouping ID is deliberately excluded: grouping can change between visits.
export function reviewChangeKey(chunk: Pick<GitReviewChunk, 'path' | 'patch'>): string {
  const lines = chunk.patch.split('\n');
  const first = lines.findIndex((line) => line.startsWith('@@'));
  return JSON.stringify([chunk.path, first < 0 ? '' : lines.filter((line) => !line.startsWith('index '))
    .map((line) => line.replace(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/, '@@')).join('\n')]);
}

export function changedReviewLines(chunk: Pick<GitReviewChunk, 'patch'>): string[] {
  return reviewGuidePatchLines(chunk.patch).flatMap((line) =>
    line.text.startsWith('+') ? [`right:${line.right}`] : line.text.startsWith('-') ? [`left:${line.left}`] : []);
}

export function compareReviewCheckpoint(plan: GitReviewPlan, baseSha: string, checkpoint?: ReviewCheckpoint) {
  const hiddenIds = new Set<string>();
  if (!checkpoint) return { hiddenIds, previousChanges: [], matchingIds: hiddenIds };
  const before = new Map<string, ReviewCheckpoint['chunks']>();
  for (const chunk of checkpoint.chunks) {
    const key = reviewChangeKey(chunk);
    before.set(key, [...(before.get(key) ?? []), chunk]);
  }
  const current = plan.units.flatMap((unit) => unit.chunks);
  const counts = new Map<string, number>();
  for (const chunk of current) {
    const key = reviewChangeKey(chunk);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const previousChanges = checkpoint.chunks.filter((chunk) => !counts.has(reviewChangeKey(chunk)));
  const matchingIds = new Set<string>();
  // A changed comparison base invalidates the old review even if a patch happens to match.
  if (baseSha !== checkpoint.baseSha) return { hiddenIds, previousChanges, matchingIds };
  const changedOldUnits = new Set(previousChanges.map((chunk) => chunk.unitId));
  for (const unit of plan.units) {
    const relatedChange = unit.chunks.some((chunk) => {
      const matches = before.get(reviewChangeKey(chunk));
      return !matches || matches.some((match) => changedOldUnits.has(match.unitId));
    });
    for (const chunk of unit.chunks) {
      const key = reviewChangeKey(chunk);
      const matches = before.get(key);
      if (!chunk.omittedReason && chunk.patch.includes('@@') && counts.get(key) === 1 &&
        matches?.length === 1 && matches[0].seen) {
        matchingIds.add(chunk.id);
        // Revisit directly related chunks when their block changes. This is deliberately conservative.
        if (!relatedChange) hiddenIds.add(chunk.id);
      }
    }
  }
  return { hiddenIds, previousChanges, matchingIds };
}

export function checkpointCoverage(chunks: readonly GitReviewChunk[], seen: ReadonlyMap<string, ReadonlySet<string>>) {
  let total = 0;
  let viewed = 0;
  for (const chunk of chunks) {
    const lines = changedReviewLines(chunk);
    // Unpreviewable changes cannot count as read and must not make an empty review reach 50%.
    total += Math.max(1, lines.length);
    viewed += lines.filter((line) => seen.get(chunk.id)?.has(line)).length;
  }
  return { total, viewed, eligible: total > 0 && viewed >= total / 2 };
}

function validCheckpoint(value: unknown): value is ReviewCheckpoint {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || typeof record.baseSha !== 'string' || typeof record.headSha !== 'string' ||
    typeof record.savedAt !== 'string' || !Number.isFinite(Date.parse(record.savedAt)) ||
    !Array.isArray(record.chunks) || record.chunks.length > 10_000) return false;
  if (!record.chunks.every((chunk: unknown) => {
    if (!chunk || typeof chunk !== 'object') return false;
    const row = chunk as Record<string, unknown>;
    return ['id', 'path', 'patch', 'unitId'].every((key) => typeof row[key] === 'string') && typeof row.seen === 'boolean';
  })) return false;
  if (record.position !== undefined) {
    if (!record.position || typeof record.position !== 'object') return false;
    const position = record.position as Record<string, unknown>;
    if (typeof position.chunkId !== 'string' || typeof position.path !== 'string' ||
      typeof position.offset !== 'number' || !Number.isFinite(position.offset)) return false;
  }
  return true;
}

function readCheckpoints(storage: Pick<Storage, 'getItem'>): Record<string, ReviewCheckpoint> {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw || raw.length > MAX_STORE_CHARS) return {};
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, ReviewCheckpoint] => validCheckpoint(entry[1])));
  } catch { return {}; }
}

export function loadReviewCheckpoint(storage: Pick<Storage, 'getItem'>, key: string): ReviewCheckpoint | undefined {
  return readCheckpoints(storage)[key];
}

export function saveReviewCheckpoint(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string, checkpoint?: ReviewCheckpoint): boolean {
  try {
    const entries = readCheckpoints(storage);
    delete entries[key];
    if (checkpoint) {
      if (JSON.stringify(checkpoint).length > MAX_CHECKPOINT_CHARS) return false;
      entries[key] = checkpoint;
    }
    const ordered = Object.entries(entries).sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt));
    while (ordered.length > 20 || JSON.stringify(Object.fromEntries(ordered)).length > MAX_STORE_CHARS) ordered.pop();
    storage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(ordered)));
    return true;
  } catch { return false; }
}
