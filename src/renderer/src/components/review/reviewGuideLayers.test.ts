import { describe, expect, it } from 'vitest';
import type { GitReviewGuide, GitReviewPlan } from '@shared/types';
import { createReviewPresentation, DEFAULT_REVIEW_PREFERENCES } from './reviewFilters';
import { createReviewGuidePlan } from './reviewGuidePresentation';
import { createReviewGuideFindings } from './reviewGuideFindings';
import type { ReviewLineComment } from './ReviewView';

function fixture(): { plan: GitReviewPlan; guide: GitReviewGuide } {
  const plan: GitReviewPlan = {
    repoPath: '/repo', target: { kind: 'wip', scope: 'unstaged' }, targetKey: 'wip:unstaged',
    sourceFingerprint: 'current', fileContexts: [], reviewedChunkIds: [], loadedAt: '',
    units: [{ id: 'first', title: 'Client', reason: 'Same file', explanation: '', confidence: 'exact',
      chunks: [{ id: 'first-chunk', path: 'src/client.ts', patch: '@@ -10 +10 @@\n-old\n+new\n',
        header: '@@ -10 +10 @@', startLine: 10, additions: 1, deletions: 1,
        role: 'related', relationship: 'Same file', reviewSection: 'other', category: 'source',
        changeType: 'modified', contentKind: 'code', source: 'unstaged' }]
    }]
  };
  const first = plan.units[0]!;
  plan.units.push({ ...first, id: 'second', chunks: first.chunks.map((chunk) => ({ ...chunk, id: 'second-chunk', patch: '@@ -20 +20 @@\n-old\n+new\n' })) });
  const guide: GitReviewGuide = { sourceFingerprint: plan.sourceFingerprint, targetKey: plan.targetKey, generatedAt: 'now', summary: 'Summary', units: [{
    unitId: 'first', sourceUnitIds: ['first', 'second'], title: 'One coherent change', priority: 'focus', why: 'Why', what: '', files: [], inlineNotes: [], summaries: []
  }] };
  return { plan, guide };
}

describe('AI-only review layers', () => {
  it('preserves ordinary groups, chunk identity, and viewed progress across a merged layer', () => {
    const { plan, guide } = fixture();
    const original = structuredClone(plan);
    const layered = createReviewGuidePlan(plan, guide);
    expect(layered.units).toHaveLength(1);
    expect(layered.units[0]?.title).toBe('One coherent change');
    expect(layered.units[0]?.chunks).toEqual(plan.units.flatMap((unit) => unit.chunks));
    expect(plan).toEqual(original);
    expect(createReviewGuidePlan(plan, undefined)).toBe(plan);
    const viewed = new Set([plan.units[0]!.chunks[0]!.id]);
    const ordinary = createReviewPresentation(plan, DEFAULT_REVIEW_PREFERENCES, viewed);
    const ai = createReviewPresentation(layered, DEFAULT_REVIEW_PREFERENCES, viewed);
    expect(ai.viewedCount).toBe(ordinary.viewedCount);
    expect(ai.pendingCount).toBe(ordinary.pendingCount);
    expect(ai.units[0]?.isViewed).toBe(false);
  });

  it('rejects a stale, wrong-target or incomplete layer plan without hiding code', () => {
    const { plan, guide } = fixture();
    for (const invalid of [{ ...guide, sourceFingerprint: 'old' }, { ...guide, targetKey: 'other' }, { ...guide, units: [] }]) {
      expect(createReviewGuidePlan(plan, invalid)).toBe(plan);
    }
  });

  it('counts each current root finding once and assigns it to the matching range', () => {
    const { plan } = fixture();
    const units = createReviewPresentation(plan, DEFAULT_REVIEW_PREFERENCES, new Set()).units;
    const root: ReviewLineComment = { id: 1, author: 'coderabbitai[bot]', body: '_🟡 Minor_\n\n**Check retries.**', path: 'src/client.ts', line: 20, side: 'right', subjectType: 'line', createdAt: '', isResolved: false, isOutdated: false };
    const result = createReviewGuideFindings(units, [root,
      { ...root, id: 2, inReplyToId: 1 }, { ...root, id: 3, isResolved: true },
      { ...root, id: 4, isOutdated: true }, { ...root, id: 5, isDraft: true },
      { ...root, id: 6, author: 'human', body: '🟡 Minor question about this code.' },
      { ...root, id: 7, body: 'This function makes a minor adjustment.' },
      { ...root, id: 8, body: 'Example:\n```\n🟡 Minor\n```' }
    ]);
    expect(result.has('first')).toBe(false);
    expect(result.get('second')).toEqual([{ comment: root, severity: 'minor' }]);
  });
});
