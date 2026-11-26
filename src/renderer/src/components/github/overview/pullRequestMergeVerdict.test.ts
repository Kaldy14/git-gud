import { describe, expect, it } from 'vitest';
import type { GitHubPullRequestReviewComment, GitHubPullRequestSummary } from '@shared/types';
import { pullRequestStatus } from '../pullRequestInboxStatus';
import { pullRequestMergeVerdict } from './pullRequestMergeVerdict';

const base: GitHubPullRequestSummary = {
  profileId: 'p', owner: 'o', repository: 'r', number: 1, id: 'PR_1', title: 'Title', url: 'https://github.com/o/r/pull/1',
  author: 'cy', updatedAt: '2026-11-01T00:00:00Z', category: 'needs-your-review', comments: 0, changedFiles: 1,
  additions: 1, deletions: 0, headRefName: 'feature', canMerge: true,
  state: 'open',
  isDraft: false,
  mergeable: 'mergeable',
  mergeState: 'clean',
  reviewDecision: 'approved',
  baseRefName: 'main',
  reviewers: [{ author: 'ana', state: 'approved' }, { author: 'ben', state: 'approved' }],
  checks: { state: 'success', total: 12, passed: 12, failed: 0, pending: 0 }
};
const thread = (id: number, isResolved?: boolean): GitHubPullRequestReviewComment => ({
  id, body: 'x', author: 'ana', url: '', path: 'a.ts', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
  subjectType: 'line', line: 1, side: 'right', isResolved
});

type Case = [name: string, overrides: Partial<GitHubPullRequestSummary> & { reviewComments?: GitHubPullRequestReviewComment[] }, verdict: string, strip: string, blockers: string[]];

// The copy table: every fact-strip sentence is deliberate and agrees with the checklist under it.
const cases: Case[] = [
  ['ready', { reviewComments: [thread(1, true)] }, 'Ready to merge', '12/12 checks passed · 2 approvals · no unresolved threads', []],
  ['checks running', { checks: { state: 'pending', total: 12, passed: 9, failed: 0, pending: 3 } }, 'Checks running', '9/12 checks passed, 3 running · 2 approvals', ['checks-running']],
  ['checks failing', { checks: { state: 'failure', total: 12, passed: 10, failed: 2, pending: 0 } }, 'Checks failing', '!2 of 12 checks failed · 2 approvals', ['checks-failing']],
  ['running plus failing', { checks: { state: 'failure', total: 12, passed: 8, failed: 1, pending: 3 } }, 'Checks failing', '!1 of 12 checks failed, 3 running · 2 approvals', ['checks-failing']],
  ['draft', { isDraft: true, reviewers: [], reviewDecision: 'unknown' }, 'Draft', '12/12 checks passed · no reviews', ['draft']],
  ['conflicts', { mergeable: 'conflicting', mergeState: 'dirty' }, 'Merge conflicts', '!Conflicts with main · 12/12 checks passed · 2 approvals', ['conflicts']],
  ['conflicting draft', { mergeable: 'conflicting', mergeState: 'dirty', isDraft: true }, 'Merge conflicts', '!Conflicts with main · 12/12 checks passed · 2 approvals', ['conflicts', 'draft']],
  ['behind base', { mergeState: 'behind' }, 'Behind main', '12/12 checks passed · 2 approvals · behind main', ['behind']],
  ['changes requested', { reviewDecision: 'changes-requested', mergeState: 'blocked', reviewers: [{ author: 'ana', state: 'changes-requested' }] }, 'Changes requested', '12/12 checks passed · !changes requested by ana', ['changes-requested']],
  ['awaiting review', { reviewDecision: 'review-required', mergeState: 'blocked', reviewers: [{ author: 'ana', state: 'pending' }, { author: 'ben', state: 'pending' }, { author: 'cy', state: 'pending' }], reviewComments: [thread(1, false), thread(2, false)] }, 'Awaiting review', '12/12 checks passed · awaiting review from ana and 2 others · 2 unresolved threads', ['review-required']],
  ['review required, nobody asked', { reviewDecision: 'review-required', mergeState: 'blocked', reviewers: [] }, 'Awaiting approval', '12/12 checks passed · review required', ['review-required']],
  ['review required on a clean branch', { reviewDecision: 'review-required', reviewers: [] }, 'Awaiting approval', '12/12 checks passed · review required', ['review-required']],
  ['blocked by branch rules', { mergeState: 'blocked' }, 'Blocked by branch rules', '12/12 checks passed · 2 approvals', ['blocked']],
  ['merged', { state: 'merged', mergeState: 'unknown', mergeable: 'unknown' }, 'Merged', '12/12 checks passed · 2 approvals', []],
  ['closed', { state: 'closed', reviewers: [{ author: 'ana', state: 'pending' }], reviewDecision: 'review-required' }, 'Closed', '12/12 checks passed · no reviews', []],
  ['unknown mergeability', { mergeState: 'unknown', mergeable: 'unknown' }, 'Unknown', '12/12 checks passed · 2 approvals', []],
  ['no checks at all', { checks: { state: 'unknown', total: 0, passed: 0, failed: 0, pending: 0 } }, 'Ready to merge', 'No checks · 2 approvals', []],
  ['only skipped checks', { checks: { state: 'success', total: 4, passed: 0, failed: 0, pending: 0 } }, 'Ready to merge', '4 checks skipped · 2 approvals', []],
  ['one approval, resolution unknown', { reviewers: [{ author: 'ana', state: 'approved' }], reviewComments: [thread(1)] }, 'Ready to merge', '12/12 checks passed · 1 approval', []]
];

describe('pull request merge verdict', () => {
  it.each(cases)('%s', (_name, overrides, label, strip, blockers) => {
    const verdict = pullRequestMergeVerdict({ ...base, ...overrides });
    expect(verdict.label).toBe(label);
    // `!` marks a fact that carries the danger icon.
    expect(verdict.facts.map((fact) => `${fact.bad ? '!' : ''}${fact.text}`).join(' · ')).toBe(strip);
    expect(verdict.blockers.map((blocker) => blocker.id)).toEqual(blockers);
  });

  it('never calls a pull request ready while the checklist lists a blocker', () => {
    for (const [, overrides] of cases) {
      const verdict = pullRequestMergeVerdict({ ...base, ...overrides });
      if (verdict.label === 'Ready to merge') expect(verdict.blockers).toEqual([]);
    }
  });

  it('uses the neutral merged tone and the in-progress tone for running checks and awaited approvals', () => {
    expect(pullRequestMergeVerdict({ ...base, state: 'merged' }).tone).toBe('merged');
    expect(pullRequestMergeVerdict({ ...base, checks: { state: 'pending', total: 2, passed: 1, failed: 0, pending: 1 } }).tone).toBe('pending');
    expect(pullRequestMergeVerdict({ ...base, reviewDecision: 'review-required', reviewers: [] }).tone).toBe('pending');
  });

  it('reads like the inbox status wherever the inbox names the state', () => {
    for (const [, overrides] of cases) {
      const pullRequest = { ...base, ...overrides };
      const status = pullRequestStatus(pullRequest);
      // "Approved" and "Review status unknown" say nothing about merging; the verdict is more specific there.
      if (status.label === 'Approved' || status.label === 'Review status unknown') continue;
      const verdict = pullRequestMergeVerdict(pullRequest);
      expect([verdict.label, verdict.tone]).toEqual([status.label, status.tone]);
    }
  });
});
