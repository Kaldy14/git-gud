import type { GitHubActionsRunFilters } from '@shared/types';

export const MAX_WORKFLOW_BRANCH_FILTERS = 20;

export function parseWorkflowRunBranches(value: string): string[] {
  const seen = new Set<string>();

  return value
    .split(/[,\n]/)
    .map((branch) => branch.trim())
    .filter((branch) => {
      if (!branch || seen.has(branch)) {
        return false;
      }

      seen.add(branch);
      return true;
    });
}

export function workflowRunBranchFilterError(value: string): string | undefined {
  const branches = parseWorkflowRunBranches(value);

  if (branches.length > MAX_WORKFLOW_BRANCH_FILTERS) {
    return `Use ${MAX_WORKFLOW_BRANCH_FILTERS} branches or fewer.`;
  }

  if (branches.some((branch) => branch.length > 255)) {
    return 'Branch names must be 255 characters or fewer.';
  }

  return undefined;
}

export function hasWorkflowRunFilters(filters: GitHubActionsRunFilters): boolean {
  return (
    filters.branches.length > 0 ||
    filters.includeTags ||
    filters.includeMyPullRequests
  );
}

export function workflowRunFilterSummary(filters: GitHubActionsRunFilters): string {
  if (!hasWorkflowRunFilters(filters)) {
    return 'All runs';
  }

  const branchSummary =
    filters.branches.length <= 2
      ? filters.branches
      : [...filters.branches.slice(0, 2), `+${filters.branches.length - 2}`];
  const parts = [
    ...branchSummary,
    ...(filters.includeTags ? ['tags'] : []),
    ...(filters.includeMyPullRequests ? ['my PRs'] : [])
  ];

  return parts.join(' · ');
}
