import { describe, expect, it } from 'vitest';

import {
  hasWorkflowRunFilters,
  parseWorkflowRunBranches,
  workflowRunBranchFilterError,
  workflowRunFilterSummary
} from './workflowRunFilters';

describe('workflow run tile filters', () => {
  it('normalizes comma and newline separated exact branch names', () => {
    expect(parseWorkflowRunBranches(' main, release/next\nmain, feature/card ')).toEqual([
      'main',
      'release/next',
      'feature/card'
    ]);
  });

  it('uses an empty filter set to represent all runs', () => {
    const filters = {
      branches: [],
      includeTags: false,
      includeMyPullRequests: false
    };

    expect(hasWorkflowRunFilters(filters)).toBe(false);
    expect(workflowRunFilterSummary(filters)).toBe('All runs');
  });

  it('summarizes the union of branch, tag, and authored pull request filters', () => {
    expect(
      workflowRunFilterSummary({
        branches: ['main', 'release/next', 'develop'],
        includeTags: true,
        includeMyPullRequests: true
      })
    ).toBe('main · release/next · +1 · tags · my PRs');
  });

  it('rejects oversized branch filter sets before saving', () => {
    expect(
      workflowRunBranchFilterError(
        Array.from({ length: 21 }, (_, index) => `branch-${index}`).join(', ')
      )
    ).toBe('Use 20 branches or fewer.');
  });
});
