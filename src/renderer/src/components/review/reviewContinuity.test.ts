import { describe, expect, it } from 'vitest';
import type { GitReviewChunk, GitReviewPlan } from '@shared/types';
import { createReviewPresentation, DEFAULT_REVIEW_PREFERENCES } from './reviewFilters';
import {
  changedReviewLines, checkpointCoverage, compareReviewCheckpoint,
  loadReviewCheckpoint, reviewChangeKey, saveReviewCheckpoint, type ReviewCheckpoint
} from './reviewContinuity';

function patch(path: string, old = 'oldValue', next = 'newValue', line = 1): GitReviewChunk {
  return { id: `${path}:${old}:${next}`, path, source: 'commit',
    patch: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -${line} +${line} @@\n-${old}\n+${next}\n`,
    header: '', startLine: line, additions: 1, deletions: 1, role: 'anchor', relationship: '',
    reviewSection: 'implementation', category: path.includes('.test.') ? 'test' : 'source', changeType: 'modified', contentKind: 'code'
  };
}
function plan(chunks = [patch('first.ts'), patch('second.ts')], sha = 'head-one'): GitReviewPlan {
  return { repoPath: 'github://github.com/acme/app', target: { kind: 'branch', name: 'feature', sha },
    targetKey: sha, sourceFingerprint: sha, fileContexts: [], reviewedChunkIds: [], loadedAt: '',
    units: chunks.map((chunk) => ({ id: chunk.path, title: chunk.path, reason: '', explanation: '', confidence: 'exact',
      chunks: [chunk], additions: 1, deletions: 1, files: [chunk.path] })) };
}
function checkpoint(source = plan(), seen = true): ReviewCheckpoint {
  return { version: 1, baseSha: 'base', headSha: 'head-one', savedAt: '2026-09-26T10:00:00Z', chunks:
    source.units.flatMap((unit) => unit.chunks.map((chunk) => ({ id: chunk.id, path: chunk.path, patch: chunk.patch, unitId: unit.id, seen }))) };
}
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe('PR review continuity', () => {
  it('carries exact seen changes across new commits and line shifts, independently of grouping IDs', () => {
    const next = plan([patch('first.ts', 'oldValue', 'newValue', 40), patch('second.ts')], 'head-two');
    next.units.forEach((unit) => { unit.id += '-regrouped'; });
    expect(compareReviewCheckpoint(next, 'base', checkpoint()).hiddenIds.size).toBe(2);
  });
  it('never hides unseen, changed, or renamed code', () => {
    expect(compareReviewCheckpoint(plan(), 'base', checkpoint(plan(), false)).hiddenIds.size).toBe(0);
    const next = plan([patch('first.ts', 'oldValue', 'changedAgain'), patch('renamed.ts')]);
    expect(compareReviewCheckpoint(next, 'base', checkpoint()).hiddenIds.size).toBe(0);
  });
  it('reopens exact matches if the PR comparison base changed', () => {
    expect(compareReviewCheckpoint(plan(), 'new-base', checkpoint()).hiddenIds.size).toBe(0);
  });
  it('keeps signed edits and whitespace distinct', () => {
    const a = plan([patch('first.ts', 'a', 'b')]).units[0].chunks[0];
    const b = { ...a, patch: a.patch.replace('-a\n+b', '+a\n-b') };
    expect(reviewChangeKey(a)).not.toBe(reviewChangeKey(b));
    expect(reviewChangeKey(a)).not.toBe(reviewChangeKey({ ...a, patch: a.patch.replace('+b', '+ b') }));
  });
  it('does not transfer exposure when context or hunk boundaries change', () => {
    const next = plan([patch('first.ts')]);
    next.units[0].chunks[0].patch += ' context changed\n';
    expect(compareReviewCheckpoint(next, 'base', checkpoint()).hiddenIds.size).toBe(0);
  });
  it('never suppresses ambiguous duplicates or unpreviewable content', () => {
    const next = plan([patch('first.ts')]);
    const chunk = next.units[0].chunks[0];
    next.units[0].chunks.push({ ...chunk, id: 'duplicate' });
    expect(compareReviewCheckpoint(next, 'base', checkpoint()).hiddenIds.size).toBe(0);
    next.units[0].chunks = [{ ...chunk, omittedReason: 'too-large' }];
    expect(compareReviewCheckpoint(next, 'base', checkpoint()).hiddenIds.size).toBe(0);
  });
  it('revisits an unchanged chunk when a related chunk is edited', () => {
    const before = plan();
    before.units = [{ ...before.units[0], chunks: before.units.flatMap((unit) => unit.chunks) }];
    const next = plan([patch('first.ts'), patch('second.ts', 'oldValue', 'changedAgain')]);
    next.units = [{ ...next.units[0], chunks: next.units.flatMap((unit) => unit.chunks) }];
    expect(compareReviewCheckpoint(next, 'base', checkpoint(before)).hiddenIds.size).toBe(0);
  });
  it('retains disappeared changes, including a PR entirely reverted to its base', () => {
    const result = compareReviewCheckpoint(plan([], 'head-two'), 'base', checkpoint());
    expect(result.previousChanges.map((chunk) => chunk.path).sort()).toEqual(['first.ts', 'second.ts']);
  });
  it('requires half the actual changed lines and keeps partial hunks incomplete', () => {
    const chunks = plan().units.flatMap((unit) => unit.chunks);
    const seen = new Map([[chunks[0].id, new Set(['right:1'])]]);
    expect(checkpointCoverage(chunks, seen)).toEqual({ total: 4, viewed: 1, eligible: false });
    seen.set(chunks[0].id, new Set(changedReviewLines(chunks[0])));
    expect(checkpointCoverage(chunks, seen).eligible).toBe(true);
    expect(checkpointCoverage([], seen).eligible).toBe(false);
  });
  it('uses the existing filter scope without counting excluded code as seen', () => {
    const source = plan([patch('first.ts'), patch('first.test.ts')]);
    const scope = createReviewPresentation(source, DEFAULT_REVIEW_PREFERENCES, new Set()).units.flatMap((unit) => unit.visibleChunks);
    expect(scope.map((chunk) => chunk.path)).toEqual(['first.ts']);
    expect(checkpointCoverage(scope, new Map([[scope[0].id, new Set(changedReviewLines(scope[0]))]])).eligible).toBe(true);
  });
  it('can reveal a hidden file explicitly without changing the saved review', () => {
    const source = plan();
    const ids = new Set(source.units.flatMap((unit) => unit.chunks.map((chunk) => chunk.id)));
    const hidden = createReviewPresentation(source, DEFAULT_REVIEW_PREFERENCES, new Set(), undefined, ids);
    expect(hidden.units).toHaveLength(0);
    const revealed = createReviewPresentation(source, DEFAULT_REVIEW_PREFERENCES, new Set(), 'first.ts', ids);
    expect(revealed.units.flatMap((unit) => unit.visibleChunks).map((chunk) => chunk.path)).toEqual(['first.ts']);
  });
  it('persists isolated PR checkpoints, validates corrupt data, and resets only the requested PR', () => {
    const store = storage();
    expect(saveReviewCheckpoint(store, 'first', checkpoint())).toBe(true);
    expect(saveReviewCheckpoint(store, 'second', checkpoint())).toBe(true);
    expect(loadReviewCheckpoint(store, 'first')).toEqual(checkpoint());
    saveReviewCheckpoint(store, 'first');
    expect(loadReviewCheckpoint(store, 'first')).toBeUndefined();
    expect(loadReviewCheckpoint(store, 'second')).toBeDefined();
    store.setItem('git-gud:pr-review-checkpoints:v1', '{bad-json');
    expect(loadReviewCheckpoint(store, 'second')).toBeUndefined();
    store.setItem('git-gud:pr-review-checkpoints:v1', JSON.stringify({ first: { ...checkpoint(), chunks: [null] } }));
    expect(loadReviewCheckpoint(store, 'first')).toBeUndefined();
  });
  it('bounds saved data and reports quota failures instead of crashing review', () => {
    const store = storage();
    const huge = checkpoint(); huge.chunks[0].patch = 'x'.repeat(750_001);
    expect(saveReviewCheckpoint(store, 'huge', huge)).toBe(false);
    expect(saveReviewCheckpoint({ ...store, setItem() { throw new Error('Quota'); } }, 'first', checkpoint())).toBe(false);
    for (let index = 0; index < 24; index++) saveReviewCheckpoint(store, `${index}`, { ...checkpoint(), savedAt: new Date(index * 1000).toISOString() });
    expect(loadReviewCheckpoint(store, '0')).toBeUndefined();
    expect(loadReviewCheckpoint(store, '23')).toBeDefined();
  });
});
