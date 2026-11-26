import type { GitHubPullRequestCategory, GitHubPullRequestSummary } from '@shared/types';

// The inbox's groups, in display order. The inbox page and the workspace rail both group by these.
export const PULL_REQUEST_INBOX_GROUPS: ReadonlyArray<{
  id: GitHubPullRequestCategory;
  title: string;
  description: string;
}> = [
  {
    id: 'needs-your-review',
    title: 'Needs your review',
    description: 'You were requested directly as a reviewer.'
  },
  {
    id: 'needs-team-review',
    title: "Needs your teams' review",
    description: 'A team you belong to was requested.'
  },
  {
    id: 'needs-action',
    title: 'Needs action',
    description: 'Merge conflicts, requested changes, or failing checks need attention.'
  },
  {
    id: 'ready-to-merge',
    title: 'Ready to merge',
    description: 'Approved pull requests with successful checks.'
  },
  {
    id: 'waiting',
    title: 'Waiting for review or checks',
    description: 'Your pull requests that are still progressing.'
  },
  {
    id: 'drafts',
    title: 'Your drafts',
    description: 'Open draft pull requests you authored.'
  }
];

export function resolvePullRequestGroupExpansion(
  override: boolean | undefined,
  itemCount: number
): boolean {
  return override ?? itemCount > 0;
}

/** Search over title, repository, author and number (with or without `#`). */
export function matchesPullRequestSearch(pullRequest: GitHubPullRequestSummary, search: string): boolean {
  const normalized = search.trim().toLowerCase().replace(/^#(?=\d)/, '');
  if (!normalized) return true;
  return [
    pullRequest.title,
    pullRequest.owner,
    pullRequest.repository,
    `${pullRequest.owner}/${pullRequest.repository}`,
    pullRequest.author,
    String(pullRequest.number)
  ].some((value) => value.toLowerCase().includes(normalized));
}
