import { describe, expect, it } from 'vitest';
import type { GitHubPullRequestSummary } from '@shared/types';
import { pullRequestMergeBlockers } from './pullRequestMergeBlockers';

const base = {
  state: 'open', isDraft: false, mergeable: 'mergeable', mergeState: 'clean', baseRefName: 'main',
  checks: { state: 'success', total: 3, passed: 3, failed: 0, pending: 0 }
} as const;
const blockers = (overrides: Partial<GitHubPullRequestSummary>) =>
  pullRequestMergeBlockers({ ...base, ...overrides } as GitHubPullRequestSummary).map((blocker) => blocker.id);

describe('pull request merge blockers', () => {
  it('lists nothing for a clean, open pull request', () => {
    expect(blockers({})).toEqual([]);
  });

  it('orders conflicts, checks, then draft', () => {
    expect(blockers({
      isDraft: true,
      mergeable: 'conflicting',
      checks: { state: 'failure', total: 3, passed: 2, failed: 1, pending: 0 }
    })).toEqual(['conflicts', 'checks-failing', 'draft']);
  });

  it('reports running checks but not skipped ones', () => {
    expect(blockers({ checks: { state: 'pending', total: 5, passed: 2, failed: 0, pending: 1 } })).toEqual(['checks-running']);
    expect(blockers({ checks: { state: 'success', total: 5, passed: 2, failed: 0, pending: 0 } })).toEqual([]);
  });

  it('ignores merged and closed pull requests', () => {
    expect(blockers({ state: 'merged', mergeable: 'conflicting' })).toEqual([]);
  });
});
