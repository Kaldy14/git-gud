import { describe, expect, it } from 'vitest';

import type {
  GitReviewChunk,
  GitReviewFileContext,
  GitReviewPlan,
  GitReviewUnit
} from '@shared/types';

import type { VisibleReviewUnit } from './reviewFilters';
import {
  createReviewSearchResults,
  normalizeReviewSearchSelection,
  readReviewSearchSelection
} from './reviewSearch';

describe('review search', () => {
  it('searches changed additions and deletions across visible review blocks', () => {
    const definition = chunk(
      'definition',
      'src/session.ts',
      '@@ -8,2 +8,3 @@\n-const expiresAt = oldClock()\n+const expiresAt = clock.now() + SESSION_TTL\n+return { expiresAt }'
    );
    const usage = chunk(
      'usage',
      'src/response.ts',
      '@@ -30,1 +30,1 @@\n-return { token }\n+return { token, expiresAt }'
    );
    const plan = reviewPlan([
      unit('session', 'Session expiry', [definition]),
      unit('response', 'Response payload', [usage])
    ]);

    const results = createReviewSearchResults(
      plan,
      visibleUnits(plan.units),
      'expiresAt',
      'changed-lines',
      'visible-blocks'
    );

    expect(results.locationCount).toBe(4);
    expect(results.files.map((file) => [file.path, file.locations.length])).toEqual([
      ['src/session.ts', 3],
      ['src/response.ts', 1]
    ]);
    expect(results.files[0]?.locations[0]?.lines.find((line) => line.isMatch)).toMatchObject({
      number: 8,
      kind: 'deletion'
    });
  });

  it('matches a multiline code selection inside a changed block', () => {
    const definition = chunk(
      'definition',
      'src/session.ts',
      '@@ -8,1 +8,3 @@\n-return legacy\n+const expiresAt =\n+  clock.now() + SESSION_TTL\n+return { expiresAt }'
    );
    const plan = reviewPlan([unit('session', 'Session expiry', [definition])]);

    const results = createReviewSearchResults(
      plan,
      visibleUnits(plan.units),
      'const expiresAt =\nclock.now() + SESSION_TTL',
      'changed-lines',
      'visible-blocks'
    );

    expect(results.locationCount).toBe(1);
    expect(
      results.files[0]?.locations[0]?.lines
        .filter((line) => line.isMatch)
        .map((line) => line.number)
    ).toEqual([8, 9]);
  });

  it('can search unchanged lines in full changed files', () => {
    const definition = chunk(
      'definition',
      'src/session.ts',
      '@@ -8,1 +8,1 @@\n-return legacy\n+return modern',
      'session-context'
    );
    const context: GitReviewFileContext = {
      id: 'session-context',
      path: 'src/session.ts',
      source: 'commit',
      oldContents: 'const expiresAt = legacyClock()',
      newContents: [
        'export function createSession() {',
        '  return modern',
        '}',
        '',
        'export function isExpired(session: Session) {',
        '  return session.expiresAt < Date.now()',
        '}'
      ].join('\n')
    };
    const plan = reviewPlan(
      [unit('session', 'Session expiry', [definition])],
      [context]
    );

    const changedOnly = createReviewSearchResults(
      plan,
      visibleUnits(plan.units),
      'expiresAt',
      'changed-lines',
      'visible-blocks'
    );
    const fullFiles = createReviewSearchResults(
      plan,
      visibleUnits(plan.units),
      'expiresAt',
      'full-files',
      'visible-blocks'
    );

    expect(changedOnly.locationCount).toBe(0);
    expect(fullFiles.locationCount).toBe(1);
    expect(fullFiles.files[0]?.locations[0]?.lines.find((line) => line.isMatch)).toMatchObject({
      number: 6,
      kind: 'context'
    });
  });

  it('optionally includes chunks hidden by review filters', () => {
    const source = chunk(
      'source',
      'src/session.ts',
      '@@ -1,1 +1,1 @@\n-old\n+expiresAt'
    );
    const test = {
      ...chunk(
        'test',
        'test/session.test.ts',
        '@@ -1,1 +1,1 @@\n-old\n+expect(expiresAt).toBeDefined()'
      ),
      category: 'test' as const
    };
    const sourceUnit = unit('source-unit', 'Session expiry', [source]);
    const testUnit = unit('test-unit', 'Session test', [test]);
    const plan = reviewPlan([sourceUnit, testUnit]);
    const visible = visibleUnits([sourceUnit]);

    const visibleResults = createReviewSearchResults(
      plan,
      visible,
      'expiresAt',
      'changed-lines',
      'visible-blocks'
    );
    const wholeReviewResults = createReviewSearchResults(
      plan,
      visible,
      'expiresAt',
      'changed-lines',
      'whole-review'
    );

    expect(visibleResults.files.map((file) => file.path)).toEqual(['src/session.ts']);
    expect(wholeReviewResults.files.map((file) => [file.path, file.isFiltered])).toEqual([
      ['src/session.ts', false],
      ['test/session.test.ts', true]
    ]);
  });

  it('keeps same-file matches attached to their owning review blocks', () => {
    const definition = chunk(
      'definition',
      'src/session.ts',
      '@@ -1,1 +1,1 @@\n-oldDefinition\n+const expiresAt = clock.now()'
    );
    const usage = chunk(
      'usage',
      'src/session.ts',
      '@@ -20,1 +20,1 @@\n-oldUsage\n+return expiresAt'
    );
    const plan = reviewPlan([
      unit('definition-unit', 'Session expiry definition', [definition]),
      unit('usage-unit', 'Session expiry usage', [usage])
    ]);

    const results = createReviewSearchResults(
      plan,
      visibleUnits(plan.units),
      'expiresAt',
      'changed-lines',
      'whole-review'
    );

    expect(results.files.map((file) => [file.path, file.chunk.id, file.ownerUnitId])).toEqual([
      ['src/session.ts', 'definition', 'definition-unit'],
      ['src/session.ts', 'usage', 'usage-unit']
    ]);
  });

  it('falls back to changed lines when full file context is unavailable', () => {
    const definition = chunk(
      'definition',
      'src/session.ts',
      '@@ -1,1 +1,1 @@\n-old\n+const expiresAt = clock.now()'
    );
    const plan = reviewPlan([unit('session', 'Session expiry', [definition])]);

    const results = createReviewSearchResults(
      plan,
      visibleUnits(plan.units),
      'expiresAt',
      'full-files',
      'visible-blocks'
    );

    expect(results.locationCount).toBe(1);
    expect(results.fullFileFallbackCount).toBe(1);
    expect(results.files[0]?.usedChangedLinesFallback).toBe(true);
  });

  it('normalizes selected code and bounds the query payload', () => {
    expect(normalizeReviewSearchSelection(' \r\nconst value = 1\r\n ')).toBe('const value = 1');
    expect(normalizeReviewSearchSelection('x'.repeat(5_000))).toHaveLength(4_000);
  });

  it('keeps shadow-root text when the document selection reports itself as collapsed', () => {
    expect(readReviewSearchSelection({
      isCollapsed: true,
      toString: () => 'AvailabilityConfirmationAction'
    })).toBe('AvailabilityConfirmationAction');
  });
});

function reviewPlan(
  units: GitReviewUnit[],
  fileContexts: GitReviewFileContext[] = []
): GitReviewPlan {
  return {
    repoPath: '/repo',
    target: { kind: 'commit', sha: 'abc123' },
    targetKey: 'commit:abc123',
    sourceFingerprint: 'fingerprint',
    units,
    fileContexts,
    reviewedChunkIds: [],
    loadedAt: '2026-07-30T12:00:00.000Z'
  };
}

function visibleUnits(units: GitReviewUnit[]): VisibleReviewUnit[] {
  return units.map((reviewUnit) => ({
    unit: reviewUnit,
    visibleChunks: reviewUnit.chunks,
    skippedCount: 0,
    isViewed: false
  }));
}

function unit(id: string, title: string, chunks: GitReviewChunk[]): GitReviewUnit {
  return {
    id,
    title,
    reason: 'Related change',
    explanation: 'Test review unit',
    confidence: 'strong',
    chunks
  };
}

function chunk(
  id: string,
  path: string,
  patch: string,
  fileContextId?: string
): GitReviewChunk {
  return {
    id,
    path,
    fileContextId,
    patch,
    header: patch.split('\n').find((line) => line.startsWith('@@')) ?? '',
    startLine: 1,
    additions: patch.split('\n').filter((line) => line.startsWith('+')).length,
    deletions: patch.split('\n').filter((line) => line.startsWith('-')).length,
    role: 'related',
    relationship: 'Related change',
    reviewSection: 'implementation',
    category: 'source',
    changeType: 'modified',
    contentKind: 'code',
    source: 'commit'
  };
}
