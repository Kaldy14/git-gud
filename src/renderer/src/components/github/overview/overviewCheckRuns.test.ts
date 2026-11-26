import { describe, expect, it } from 'vitest';
import type { GitHubPullRequestCheckOutcome, GitHubPullRequestChecks } from '@shared/types';

import { checkRunsAgreeWithCounts } from './overviewCheckRuns';

const runs = (...outcomes: GitHubPullRequestCheckOutcome[]) => outcomes.map((outcome, index) => ({ name: `run ${index}`, outcome }));
const checks = (overrides: Partial<GitHubPullRequestChecks>): GitHubPullRequestChecks =>
  ({ state: 'success', total: 0, passed: 0, failed: 0, pending: 0, ...overrides });

describe('checkRunsAgreeWithCounts', () => {
  it('agrees when the runs add up to the counts, skipped runs included', () => {
    expect(checkRunsAgreeWithCounts(
      checks({ total: 4, passed: 1, failed: 1, pending: 1 }),
      { runs: runs('passed', 'failed', 'running', 'skipped'), truncated: false }
    )).toBe(true);
  });

  it('disagrees when a later poll saw a running check pass', () => {
    expect(checkRunsAgreeWithCounts(
      checks({ total: 1, passed: 1 }),
      { runs: runs('running'), truncated: false }
    )).toBe(false);
  });

  it('counts runs GitHub left out as pending', () => {
    const counts = checks({ total: 5, passed: 2, pending: 3 });
    expect(checkRunsAgreeWithCounts(counts, { runs: runs('passed', 'passed', 'running'), truncated: true })).toBe(true);
    expect(checkRunsAgreeWithCounts(counts, { runs: runs('passed', 'failed', 'running'), truncated: true })).toBe(false);
  });

  it('disagrees when the live counts have more pending than listed running plus unlisted runs', () => {
    // 105 checks: 99 passed and 1 skipped listed, 5 left out; the live counts say 99 passed and 6 pending.
    const listed = { runs: runs(...Array<GitHubPullRequestCheckOutcome>(99).fill('passed'), 'skipped'), truncated: true };
    expect(checkRunsAgreeWithCounts(checks({ total: 105, passed: 99, pending: 6 }), listed)).toBe(false);
    expect(checkRunsAgreeWithCounts(checks({ total: 105, passed: 99, pending: 5 }), listed)).toBe(true);
  });
});
