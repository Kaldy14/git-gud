import { describe, expect, it } from 'vitest';
import type { GitHubPullRequestDetail, GitHubPullRequestSummary } from '@shared/types';

import { hasNewPullRequestActivity, heldRevisionNotice, overlayLivePullRequest, pickShownDetail } from './pullRequestLiveDetail';

const detailChecks = { state: 'failure', total: 2, passed: 1, failed: 1, pending: 0 } as const;
const rowChecks = { state: 'success', total: 2, passed: 2, failed: 0, pending: 0 } as const;
const detail = {
  title: 'Old title',
  headSha: 'aaa',
  baseSha: 'base',
  updatedAt: '2026-01-01T00:00:00Z',
  loadedAt: '2026-01-01T00:05:00Z',
  checks: detailChecks,
  reviewDecision: 'review-required',
  additions: 10,
  deletions: 2,
  changedFiles: 3,
  mergeable: 'mergeable',
  mergeState: 'clean'
} as GitHubPullRequestDetail;
const row = (overrides: Partial<GitHubPullRequestSummary>) =>
  ({ title: 'New title', updatedAt: '2026-01-01T00:00:00Z', checks: rowChecks, ...overrides }) as GitHubPullRequestSummary;
// The inbox read GitHub after the detail did.
const later = '2026-01-01T00:06:00Z';
const inbox = (overrides: Partial<GitHubPullRequestSummary>) => ({ row: row(overrides), loadedAt: later });

describe('overlayLivePullRequest', () => {
  it('takes the row and its checks while the heads agree', () => {
    const live = overlayLivePullRequest(detail, inbox({ headSha: 'aaa', additions: 12 }));
    expect(live).toMatchObject({ title: 'New title', headSha: 'aaa', checks: rowChecks, additions: 12 });
  });

  it('takes only head-independent fields from a row with a newer head', () => {
    const live = overlayLivePullRequest(detail, inbox({
      headSha: 'bbb',
      updatedAt: '2026-01-02T00:00:00Z',
      reviewDecision: 'approved',
      additions: 99,
      deletions: 99,
      changedFiles: 99,
      fileLineStats: [],
      mergeable: 'conflicting',
      mergeState: 'dirty'
    }));
    expect(live).toMatchObject({ ...detail, title: 'New title', reviewDecision: 'approved', updatedAt: '2026-01-02T00:00:00Z' });
    expect(live.fileLineStats).toBeUndefined();
  });

  it('treats a row that does not say which head it describes as another head', () => {
    const live = overlayLivePullRequest(detail, inbox({ additions: 99 }));
    expect(live).toMatchObject({ title: 'New title', headSha: 'aaa', checks: detailChecks, additions: 10 });
  });

  it('ignores a row older than the detail', () => {
    const live = overlayLivePullRequest(
      { ...detail, updatedAt: '2026-01-02T00:00:00Z', reviewDecision: 'approved' },
      inbox({ headSha: 'aaa', reviewDecision: 'review-required' })
    );
    expect(live).toMatchObject({ title: 'Old title', reviewDecision: 'approved', checks: detailChecks });
  });

  it('ignores a row the inbox read before the detail was loaded, even with the same update time', () => {
    // A check re-run on the same commit does not move `updatedAt`; the older inbox read must not win.
    const live = overlayLivePullRequest(detail, { row: row({ headSha: 'aaa' }), loadedAt: '2026-01-01T00:04:00Z' });
    expect(live).toBe(detail);
    expect(overlayLivePullRequest(detail, { row: row({ headSha: 'aaa' }), loadedAt: undefined })).toBe(detail);
  });

  it('shows the detail alone when the pull request left the inbox', () => {
    expect(overlayLivePullRequest(detail, { row: undefined, loadedAt: later })).toBe(detail);
  });
});

describe('hasNewPullRequestActivity', () => {
  it('reports a moved head even without a later update time', () => {
    expect(hasNewPullRequestActivity(detail, inbox({ headSha: 'bbb' }))).toBe(true);
    expect(hasNewPullRequestActivity(detail, inbox({ headSha: 'aaa' }))).toBe(false);
    expect(hasNewPullRequestActivity(detail, inbox({}))).toBe(false);
  });

  it('reports a later update', () => {
    expect(hasNewPullRequestActivity(detail, inbox({ headSha: 'aaa', updatedAt: '2026-01-02T00:00:00Z' }))).toBe(true);
  });

  it('reports nothing for a row older than the detail, whatever head it names', () => {
    const newerDetail = { ...detail, headSha: 'bbb', updatedAt: '2026-01-02T00:00:00Z' };
    expect(hasNewPullRequestActivity(newerDetail, inbox({ headSha: 'aaa' }))).toBe(false);
  });

  it('reports nothing for an inbox read older than the detail read, even with the same update time', () => {
    const earlierRead = { row: row({ headSha: 'bbb' }), loadedAt: '2026-01-01T00:04:00Z' };
    expect(hasNewPullRequestActivity(detail, earlierRead)).toBe(false);
  });

  it('reports nothing for a pull request no longer in the inbox', () => {
    expect(hasNewPullRequestActivity(detail, { row: undefined, loadedAt: later })).toBe(false);
  });
});

describe('pickShownDetail', () => {
  const newHead = { ...detail, headSha: 'bbb' };
  const newBase = { ...detail, baseSha: 'base-2' };
  const sameRevision = { ...detail, title: 'Refetched' };
  const free = { hasUnsavedText: false, hasPendingDrafts: false };
  const typing = { hasUnsavedText: true, hasPendingDrafts: false };
  const drafts = { hasUnsavedText: false, hasPendingDrafts: true };

  it('shows the first fetch and keeps the shown detail while nothing was fetched', () => {
    expect(pickShownDetail(undefined, detail, typing)).toBe(detail);
    expect(pickShownDetail(detail, undefined, free)).toBe(detail);
  });

  it('takes a refetch of the same revision even while text is unsaved or drafts are pending', () => {
    expect(pickShownDetail(detail, sameRevision, { hasUnsavedText: true, hasPendingDrafts: true })).toBe(sameRevision);
  });

  it('holds a new head while text is unsaved and adopts it once nothing is', () => {
    expect(pickShownDetail(detail, newHead, typing)).toBe(detail);
    expect(pickShownDetail(detail, newHead, free)).toBe(newHead);
  });

  it('holds a new head while drafts are pending, after the comment was added', () => {
    expect(pickShownDetail(detail, newHead, drafts)).toBe(detail);
  });

  it('holds a retargeted pull request whose head did not move', () => {
    expect(pickShownDetail(detail, newBase, typing)).toBe(detail);
    expect(pickShownDetail(detail, newBase, drafts)).toBe(detail);
    expect(pickShownDetail(detail, newBase, free)).toBe(newBase);
  });

  it('adopts the new revision only once both text and drafts are clear', () => {
    expect(pickShownDetail(detail, newHead, { hasUnsavedText: true, hasPendingDrafts: true })).toBe(detail);
    expect(pickShownDetail(detail, newHead, drafts)).toBe(detail);
    expect(pickShownDetail(detail, newHead, free)).toBe(newHead);
  });
});

describe('heldRevisionNotice', () => {
  it('names what the reader has to finish', () => {
    expect(heldRevisionNotice({ hasUnsavedText: true, hasPendingDrafts: true }))
      .toBe('This pull request changed on GitHub. Add or cancel your comment to load the new version.');
    expect(heldRevisionNotice({ hasUnsavedText: false, hasPendingDrafts: true }))
      .toBe('This pull request changed on GitHub. Submit or discard your pending review to load the new version.');
  });
});
