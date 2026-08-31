import { useQuery, type QueryClient } from '@tanstack/react-query';

import type {
  DashboardState,
  GitHubActionsRunFilters,
  GitHubActionsRuns,
  GitHubActionsRunsInput,
  GitHubWorkflowRunDetail,
  GitHubWorkflowRunFailureInput,
  GitHubPullRequestDetail,
  GitHubPullRequestInbox,
  GitHubPullRequestLocator,
  GitHubPullRequestReviewerCandidate,
  GitHubRepositorySummary,
  GitReviewPlan
} from '@shared/types';

const GITHUB_ACTIONS_REFETCH_INTERVAL_MS = 15_000;
const GITHUB_ACTIONS_FILTERED_REFETCH_INTERVAL_MS = 60_000;
const GITHUB_ACTIONS_BACKGROUND_MONITOR_INTERVAL_MS = 5 * 60_000;
const GITHUB_PULL_REQUEST_INTERACTIVE_REFETCH_INTERVAL_MS = 15_000;
const GITHUB_WORKFLOW_RUN_FAILED_LOG_GC_TIME_MS = 30 * 60_000;

export type GitHubPollingMode = 'interactive' | 'background-monitor';

export const dashboardsQueryKey = (
  profileId: string
): readonly ['dashboards', string] => ['dashboards', profileId];

export const gitHubRepositoriesQueryKey = (
  profileId: string
): readonly ['github-repositories', string] => ['github-repositories', profileId];

export const gitHubActionsRunsQueryKey = (
  input: GitHubActionsRunsInput
): readonly [
  'github-actions-runs',
  string,
  string,
  string,
  number,
  string,
  string,
  boolean,
  boolean
] => [
  'github-actions-runs',
  input.profileId,
  input.owner,
  input.repository,
  input.limit,
  input.view,
  input.filters.branches.join('\n'),
  input.filters.includeTags,
  input.filters.includeMyPullRequests
];

export const gitHubWorkflowRunDetailQueryKey = (
  input: GitHubWorkflowRunFailureInput
): readonly ['github-workflow-run-detail', string, string, string, number] => [
  'github-workflow-run-detail',
  input.profileId,
  input.owner,
  input.repository,
  input.runId
];

export const gitHubWorkflowRunFailedLogQueryKey = (
  input: GitHubWorkflowRunFailureInput
): readonly ['github-workflow-run-failed-log', string, string, string, number] => [
  'github-workflow-run-failed-log',
  input.profileId,
  input.owner,
  input.repository,
  input.runId
];

export const gitHubWorkflowRunFailedLogQueryOptions = (
  input: GitHubWorkflowRunFailureInput
) => ({
  queryKey: gitHubWorkflowRunFailedLogQueryKey(input),
  queryFn: (): Promise<string> => window.api.getGitHubWorkflowRunFailedLog(input),
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: GITHUB_WORKFLOW_RUN_FAILED_LOG_GC_TIME_MS,
  retry: false
});

export async function prefetchGitHubWorkflowRunFailedLog(
  queryClient: QueryClient,
  input: GitHubWorkflowRunFailureInput
): Promise<void> {
  await queryClient.prefetchQuery(gitHubWorkflowRunFailedLogQueryOptions(input));
}

export const gitHubPullRequestInboxQueryKey = (
  profileId: string
): readonly ['github-pull-request-inbox', string] => ['github-pull-request-inbox', profileId];

export const gitHubPullRequestDetailQueryKey = (
  locator: GitHubPullRequestLocator
): readonly ['github-pull-request-detail', string, string, string, number] => [
  'github-pull-request-detail',
  locator.profileId,
  locator.owner,
  locator.repository,
  locator.number
];

export const gitHubPullRequestReviewerCandidatesQueryKey = (
  locator: GitHubPullRequestLocator
): readonly ['github-pull-request-reviewer-candidates', string, string, string, number] => [
  'github-pull-request-reviewer-candidates',
  locator.profileId,
  locator.owner,
  locator.repository,
  locator.number
];

export const gitHubPullRequestDetailQueryOptions = (
  locator: GitHubPullRequestLocator
) => ({
  queryKey: gitHubPullRequestDetailQueryKey(locator),
  queryFn: async (): Promise<GitHubPullRequestDetail> =>
    window.api.getGitHubPullRequestDetail(locator),
  staleTime: 15_000
});

export const gitHubPullRequestReviewPlanQueryKey = (
  locator: GitHubPullRequestLocator,
  headSha: string
): readonly ['github-pull-request-review-plan', string, string, string, number, string] => [
  'github-pull-request-review-plan',
  locator.profileId,
  locator.owner,
  locator.repository,
  locator.number,
  headSha
];

export async function refreshGitHubPullRequestInboxAfterMerge(
  queryClient: QueryClient,
  locator: GitHubPullRequestLocator
): Promise<void> {
  const queryKey = gitHubPullRequestInboxQueryKey(locator.profileId);

  await queryClient.refetchQueries({ queryKey, type: 'all' });
  queryClient.setQueryData<GitHubPullRequestInbox>(queryKey, (current) =>
    current
      ? {
          ...current,
          pullRequests: current.pullRequests.filter(
            (pullRequest) =>
              pullRequest.owner !== locator.owner ||
              pullRequest.repository !== locator.repository ||
              pullRequest.number !== locator.number
          )
        }
      : current
  );
}

export function useDashboards(profileId: string | undefined) {
  return useQuery({
    queryKey: profileId ? dashboardsQueryKey(profileId) : ['dashboards', 'none'],
    queryFn: async (): Promise<DashboardState> => {
      if (!profileId) {
        throw new Error('A dashboard profile scope is required.');
      }
      return window.api.getDashboards(profileId);
    },
    enabled: Boolean(profileId),
    staleTime: Number.POSITIVE_INFINITY
  });
}

export function useGitHubRepositories(profileId: string | undefined) {
  return useQuery({
    queryKey: profileId
      ? gitHubRepositoriesQueryKey(profileId)
      : ['github-repositories', 'none'],
    queryFn: async (): Promise<GitHubRepositorySummary[]> => {
      if (!profileId) {
        throw new Error('A connected GitHub profile is required.');
      }
      return window.api.getGitHubRepositories(profileId);
    },
    enabled: Boolean(profileId),
    staleTime: 5 * 60_000
  });
}

export function useGitHubActionsRuns(input: GitHubActionsRunsInput | undefined) {
  return useQuery(gitHubActionsRunsQueryOptions(input));
}

export function useGitHubWorkflowRunDetail(input: GitHubWorkflowRunFailureInput) {
  return useQuery({
    queryKey: gitHubWorkflowRunDetailQueryKey(input),
    queryFn: (): Promise<GitHubWorkflowRunDetail> =>
      window.api.getGitHubWorkflowRunDetail(input),
    staleTime: 5_000,
    refetchInterval: (query) =>
      query.state.data?.jobs.some((job) => job.status !== 'completed')
        ? GITHUB_ACTIONS_REFETCH_INTERVAL_MS
        : false
  });
}

export function gitHubActionsRunsQueryOptions(
  input: GitHubActionsRunsInput | undefined,
  pollingMode: GitHubPollingMode = 'interactive'
) {
  return {
    queryKey: input
      ? gitHubActionsRunsQueryKey(input)
      : ['github-actions-runs', 'none', 'none', 'none', 0, 'runs', '', false, false],
    queryFn: async (): Promise<GitHubActionsRuns> => {
      if (!input) {
        throw new Error('A GitHub Actions tile configuration is required.');
      }
      return window.api.getGitHubActionsRuns(input);
    },
    enabled: Boolean(input),
    staleTime: 5_000,
    refetchIntervalInBackground: true,
    refetchInterval: input
      ? pollingMode === 'background-monitor'
        ? GITHUB_ACTIONS_BACKGROUND_MONITOR_INTERVAL_MS
        : gitHubActionsRunsRefetchInterval(input.filters)
      : GITHUB_ACTIONS_REFETCH_INTERVAL_MS
  };
}

export function gitHubActionsRunsRefetchInterval(
  filters: GitHubActionsRunFilters
): number {
  return filters.branches.length > 0 ||
    filters.includeTags ||
    filters.includeMyPullRequests
    ? GITHUB_ACTIONS_FILTERED_REFETCH_INTERVAL_MS
    : GITHUB_ACTIONS_REFETCH_INTERVAL_MS;
}

export function useGitHubPullRequestInbox(
  profileId: string | undefined,
  pollingMode: GitHubPollingMode = 'interactive'
) {
  return useQuery(gitHubPullRequestInboxQueryOptions(profileId, pollingMode));
}

export function gitHubPullRequestInboxQueryOptions(
  profileId: string | undefined,
  pollingMode: GitHubPollingMode = 'interactive'
) {
  return {
    queryKey: profileId
      ? gitHubPullRequestInboxQueryKey(profileId)
      : ['github-pull-request-inbox', 'none'],
    queryFn: async (): Promise<GitHubPullRequestInbox> => {
      if (!profileId) {
        throw new Error('A connected GitHub profile is required.');
      }
      return window.api.getGitHubPullRequestInbox(profileId);
    },
    enabled: Boolean(profileId),
    staleTime: 30_000,
    refetchOnWindowFocus: 'always' as const,
    refetchIntervalInBackground: false,
    refetchInterval: gitHubPullRequestInboxRefetchInterval(pollingMode)
  };
}

export function gitHubPullRequestInboxRefetchInterval(
  pollingMode: GitHubPollingMode
): number {
  return pollingMode === 'background-monitor'
    ? GITHUB_ACTIONS_BACKGROUND_MONITOR_INTERVAL_MS
    : GITHUB_PULL_REQUEST_INTERACTIVE_REFETCH_INTERVAL_MS;
}

export function useGitHubPullRequestDetail(locator: GitHubPullRequestLocator | undefined) {
  return useQuery({
    queryKey: locator
      ? gitHubPullRequestDetailQueryKey(locator)
      : ['github-pull-request-detail', 'none', 'none', 'none', 0],
    queryFn: async (): Promise<GitHubPullRequestDetail> => {
      if (!locator) {
        throw new Error('A pull request is required.');
      }
      return window.api.getGitHubPullRequestDetail(locator);
    },
    enabled: Boolean(locator),
    staleTime: 15_000
  });
}

export function useGitHubPullRequestReviewerCandidates(
  locator: GitHubPullRequestLocator,
  enabled: boolean
) {
  return useQuery({
    queryKey: gitHubPullRequestReviewerCandidatesQueryKey(locator),
    queryFn: (): Promise<GitHubPullRequestReviewerCandidate[]> =>
      window.api.getGitHubPullRequestReviewerCandidates(locator),
    enabled,
    staleTime: 60_000
  });
}

export function useGitHubPullRequestReviewPlan(
  locator: GitHubPullRequestLocator | undefined,
  headSha: string | undefined
) {
  return useQuery({
    queryKey: locator && headSha
      ? gitHubPullRequestReviewPlanQueryKey(locator, headSha)
      : ['github-pull-request-review-plan', 'none', 'none', 'none', 0, 'none'],
    queryFn: async (): Promise<GitReviewPlan> => {
      if (!locator || !headSha) {
        throw new Error('A pull request revision is required.');
      }
      return window.api.getGitHubPullRequestReviewPlan(locator, headSha);
    },
    enabled: Boolean(locator && headSha),
    staleTime: Number.POSITIVE_INFINITY
  });
}
