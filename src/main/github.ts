import { execFile } from 'node:child_process';

import type {
  GitHubActionsPullRequestGroup,
  GitHubActionsRuns,
  GitHubActionsRunFilters,
  GitHubActionsRunsInput,
  GitHubPullRequestActionResult,
  GitHubPullRequestCategory,
  GitHubPullRequestChecks,
  GitHubPullRequestCommit,
  GitHubPullRequestConversationComment,
  GitHubPullRequestDetail,
  GitHubPullRequestFile,
  GitHubPullRequestInbox,
  GitHubPullRequestLocator,
  GitHubPullRequestMergeInput,
  GitHubPullRequestReviewerCandidate,
  GitHubPullRequestReviewerUpdateInput,
  GitHubPullRequestSuggestion,
  GitHubPullRequestReview,
  GitHubPullRequestReviewer,
  GitHubPullRequestReviewComment,
  GitHubPullRequestReviewCommentUpdateInput,
  GitHubPullRequestReviewInput,
  GitHubPullRequestSummary,
  GitHubRepositorySummary,
  GitHubRepositoryMergeSettings,
  GitHubWorkflowRun,
  GitHubWorkflowRunConclusion,
  GitHubWorkflowRunDetail,
  GitHubWorkflowRunFailureInput,
  GitHubWorkflowRunStatus,
  GitProfile,
  GitReviewFileContext,
  GitReviewPlan,
  GitStatusCode
} from '@shared/types';

import { findGhExecutable, listProfiles } from './profiles';
import { buildReviewPlan, type ReviewPatchInput } from './git/reviewPlan';
import type { ReviewPatchSyntax } from './git/reviewStructure';
import { attachReviewSyntax } from './git/reviewSyntaxAttachment';
import { githubPullRequestReviewPlans } from './githubReviewPlans';

type GitHubContext = {
  executable: string;
  profile: GitProfile;
  host: string;
};

const GITHUB_API_TIMEOUT_MS = 30_000;
const GITHUB_API_MAX_BUFFER = 32 * 1024 * 1024;
const GITHUB_REVIEW_RETAINED_CONTEXT_MAX_BYTES = 32 * 1024 * 1024;
const GITHUB_REVIEW_CONTEXT_CONCURRENCY = 6;
const GITHUB_REVIEW_CONTEXT_BATCH_SIZE = 12;
const GITHUB_REVIEW_CONTEXT_MAX_FILES = 24;
const GITHUB_ACTIONS_FILTERED_PAGE_SIZE = 100;
const GITHUB_ACTIONS_FILTERED_RUN_CAP = 500;
const GITHUB_ACTIONS_PR_AUTHOR_BATCH_SIZE = 100;
const GITHUB_ACTIONS_METADATA_CACHE_TTL_MS = 10 * 60_000;
const GITHUB_ACTIONS_TAG_PAGE_CAP = 5;
const GITHUB_PULL_REQUEST_INBOX_CACHE_TTL_MS = 30_000;
const GITHUB_PULL_REQUEST_SUGGESTION_CACHE_TTL_MS = 5 * 60_000;
const GITHUB_PULL_REQUEST_SUGGESTION_RETRY_BACKOFF_MS = 60_000;
const GITHUB_PULL_REQUEST_SUGGESTION_LIMIT = 3;
const GITHUB_RECENT_PUSH_EVENT_PAGE_CAP = 3;
const GITHUB_RECENT_PUSH_MAX_AGE_MS = 30 * 24 * 60 * 60_000;
const GITHUB_RECENT_PUSH_EVALUATION_BATCH_SIZE = 6;
const GITHUB_RECENT_PUSH_CANDIDATE_LIMIT = 18;
const GITHUB_PULL_REQUEST_REVIEW_SEED_LIMIT = 8;

export type GitHubTag = {
  name: string;
  sha: string;
};

type PullRequestAuthorCacheEntry = {
  login: string | undefined;
  expiresAt: number;
};

const pullRequestAuthorCache = new Map<string, PullRequestAuthorCacheEntry>();

type GitHubTagCacheEntry = {
  tags: Promise<GitHubTag[]>;
  expiresAt: number;
};

const gitHubTagCache = new Map<string, GitHubTagCacheEntry>();
const gitHubPullRequestInboxCache = new Map<string, GitHubPullRequestInbox>();
const gitHubPullRequestSuggestionCache = new Map<
  string,
  {
    expiresAt: number;
    suggestions: GitHubPullRequestSuggestion[];
    errorMessage?: string;
    retryAfter?: number;
  }
>();

type GitHubRecentPushCandidate = {
  owner: string;
  repository: string;
  branch: string;
  headSha: string;
  pushedAt: string;
};

type GitHubReviewFileContext = Pick<
  GitReviewFileContext,
  'path' | 'originalPath' | 'oldContents' | 'newContents'
>;

type GitHubReviewFileAnalysis = {
  fileContexts: GitHubReviewFileContext[];
  syntaxByPath: Map<string, ReviewPatchSyntax | undefined>;
};

type GitHubReviewPlanPreparation = {
  reviewPlan: GitReviewPlan;
  syntaxByPath: Map<string, ReviewPatchSyntax | undefined>;
};

type GitHubPullRequestReviewSeed = {
  context: GitHubContext;
  locator: GitHubPullRequestLocator;
  pullRequest: GitHubPullRequestSummary;
  headSha: string;
  files: GitHubPullRequestFile[];
  initialPreparation: GitHubReviewPlanPreparation;
  mergeBaseSha: Promise<string | undefined>;
  enrichment?: Promise<GitReviewPlan>;
};

const gitHubPullRequestReviewSeeds = new Map<string, GitHubPullRequestReviewSeed>();

type GitHubFileTextRequest = {
  path: string;
  ref: string;
};

type GitHubFileTextBatchQuery = {
  query: string;
  variables: Record<string, string>;
};

const INBOX_QUERY = `
query GitGudPullRequestInbox($reviewQuery: String!, $authoredQuery: String!) {
  viewer { login }
  review: search(type: ISSUE, query: $reviewQuery, first: 50) {
    nodes {
      ... on PullRequest {
        id number title url updatedAt isDraft state reviewDecision mergeStateStatus mergeable
        viewerCanUpdate viewerCanClose changedFiles additions deletions headRefName headRefOid baseRefName
        author { login avatarUrl }
        repository { nameWithOwner }
        headRepository { nameWithOwner }
        totalCommentsCount
        latestReviews(first: 20) {
          nodes {
            state
            submittedAt
            author { login avatarUrl }
          }
        }
        reviewRequests(first: 20) {
          nodes {
            requestedReviewer {
              __typename
              ... on User { login avatarUrl }
              ... on Team { slug name organization { login } }
            }
          }
        }
        statusCheckRollup {
          state
          contexts(first: 100) {
            totalCount
            nodes {
              __typename
              ... on CheckRun { status conclusion }
              ... on StatusContext { state }
            }
          }
        }
      }
    }
  }
  authored: search(type: ISSUE, query: $authoredQuery, first: 50) {
    nodes {
      ... on PullRequest {
        id number title url updatedAt isDraft state reviewDecision mergeStateStatus mergeable
        viewerCanUpdate viewerCanClose changedFiles additions deletions headRefName headRefOid baseRefName
        author { login avatarUrl }
        repository { nameWithOwner }
        headRepository { nameWithOwner }
        totalCommentsCount
        latestReviews(first: 20) {
          nodes {
            state
            submittedAt
            author { login avatarUrl }
          }
        }
        reviewRequests(first: 20) {
          nodes {
            requestedReviewer {
              __typename
              ... on User { login avatarUrl }
              ... on Team { slug name organization { login } }
            }
          }
        }
        statusCheckRollup {
          state
          contexts(first: 100) {
            totalCount
            nodes {
              __typename
              ... on CheckRun { status conclusion }
              ... on StatusContext { state }
            }
          }
        }
      }
    }
  }
}`.trim();

const DIRECT_PULL_REQUEST_QUERY = `
query GitGudPullRequest($owner: String!, $repository: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $repository) {
    pullRequest(number: $number) {
      id number title url updatedAt isDraft state reviewDecision mergeStateStatus mergeable
      viewerCanUpdate viewerCanClose changedFiles additions deletions headRefName headRefOid baseRefName
      author { login avatarUrl }
      repository { nameWithOwner }
      headRepository { nameWithOwner }
      totalCommentsCount
      latestReviews(first: 20) {
        nodes {
          state
          submittedAt
          author { login avatarUrl }
        }
      }
      reviewRequests(first: 20) {
        nodes {
          requestedReviewer {
            __typename
            ... on User { login avatarUrl }
            ... on Team { slug name organization { login } }
          }
        }
      }
      statusCheckRollup {
        state
        contexts(first: 100) {
          totalCount
          nodes {
            __typename
            ... on CheckRun { status conclusion }
            ... on StatusContext { state }
          }
        }
      }
    }
  }
}`.trim();

const CATEGORY_ORDER: GitHubPullRequestCategory[] = [
  'needs-your-review',
  'needs-team-review',
  'drafts',
  'waiting',
  'needs-action',
  'ready-to-merge'
];

export async function loadGitHubRepositories(profileId: string): Promise<GitHubRepositorySummary[]> {
  const context = await getGitHubContext(profileId);
  const raw = await runGitHubPaginatedArray(
    context,
    'user/repos?per_page=100&sort=full_name&affiliation=owner%2Ccollaborator%2Corganization_member'
  );

  return parseGitHubRepositoriesResponse(raw);
}

export async function loadGitHubActionsRuns(input: GitHubActionsRunsInput): Promise<GitHubActionsRuns> {
  const context = await getGitHubContext(input.profileId);

  if (input.view === 'pull-requests') {
    return loadGitHubActionsPullRequestGroups(context, input);
  }

  const filtersActive = hasGitHubActionsRunFilters(input.filters);

  if (!filtersActive) {
    const raw = await loadGitHubWorkflowRunsPage(context, input, input.limit, 1);
    const runs = parseGitHubWorkflowRuns(raw).slice(0, input.limit);
    return buildGitHubActionsRuns(input, runs, runs.length, false);
  }

  const tags = input.filters.includeTags
    ? await loadCachedGitHubRepositoryTags(context, input.owner, input.repository)
    : [];
  const search = await searchGitHubActionsRunPages(
    input.limit,
    (page) =>
      loadGitHubWorkflowRunsPage(
        context,
        input,
        GITHUB_ACTIONS_FILTERED_PAGE_SIZE,
        page
      ).then(parseGitHubWorkflowRuns),
    async (runs) => {
      const authoredPullRequestNumbers = input.filters.includeMyPullRequests
        ? await loadAuthoredPullRequestNumbers(context, input, runs)
        : new Set<number>();
      return filterGitHubActionsRuns(
        runs,
        input.filters,
        tags,
        authoredPullRequestNumbers
      );
    }
  );

  return buildGitHubActionsRuns(
    input,
    search.runs,
    search.searchedRunCount,
    search.searchLimitReached
  );
}

export async function loadGitHubWorkflowRunFailedLog(
  input: GitHubWorkflowRunFailureInput
): Promise<string> {
  const context = await getGitHubContext(input.profileId);
  const log = await runGitHubText(
    context,
    gitHubWorkflowRunFailedLogArgs(input, context.host)
  );

  if (!log) {
    throw new Error('GitHub did not return any failed-step logs for this workflow run.');
  }

  return log;
}

export async function loadGitHubWorkflowRunDetail(
  input: GitHubWorkflowRunFailureInput
): Promise<GitHubWorkflowRunDetail> {
  const context = await getGitHubContext(input.profileId);
  const [rawRun, rawJobs] = await Promise.all([
    runGitHubJson(context, gitHubWorkflowRunDetailArgs(input, context.host)),
    runGitHubJson(context, gitHubWorkflowRunJobsArgs(input, context.host))
  ]);
  const run = readRecord(rawRun, 'workflow run response');
  const workflowPath = readOptionalString(run.path);
  const headSha = readOptionalString(run.head_sha);
  let workflowJobs: GitHubWorkflowJobDefinition[] = [];

  if (workflowPath && headSha) {
    try {
      const source = await runGitHubText(
        context,
        gitHubWorkflowFileArgs(input, workflowPath, headSha, context.host)
      );
      workflowJobs = parseGitHubWorkflowJobGraph(source);
    } catch {
      // Job details remain useful when the workflow file is inaccessible or invalid.
    }
  }

  return parseGitHubWorkflowRunJobsResponse(
    rawJobs,
    input,
    workflowJobs,
    workflowPath
  );
}

export function gitHubWorkflowRunDetailArgs(
  input: GitHubWorkflowRunFailureInput,
  host: string
): string[] {
  return [
    'api',
    '--hostname',
    host,
    `repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}/actions/runs/${input.runId}`
  ];
}

export function gitHubWorkflowRunJobsArgs(
  input: GitHubWorkflowRunFailureInput,
  host: string
): string[] {
  return [
    'api',
    '--hostname',
    host,
    `repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}/actions/runs/${input.runId}/jobs?per_page=100`
  ];
}

export function gitHubWorkflowFileArgs(
  input: GitHubWorkflowRunFailureInput,
  workflowPath: string,
  headSha: string,
  host: string
): string[] {
  const encodedPath = workflowPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return [
    'api',
    '--hostname',
    host,
    '-H',
    'Accept: application/vnd.github.raw+json',
    `repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}/contents/${encodedPath}?ref=${encodeURIComponent(headSha)}`
  ];
}

export function gitHubWorkflowRunFailedLogArgs(
  input: GitHubWorkflowRunFailureInput,
  host: string
): string[] {
  return [
    'run',
    'view',
    String(input.runId),
    '--repo',
    `${host}/${input.owner}/${input.repository}`,
    '--log-failed'
  ];
}

async function loadGitHubActionsPullRequestGroups(
  context: GitHubContext,
  input: GitHubActionsRunsInput
): Promise<GitHubActionsRuns> {
  const cachedInbox = gitHubPullRequestInboxCache.get(input.profileId);
  const inbox =
    cachedInbox && canReuseGitHubPullRequestInbox(cachedInbox)
      ? cachedInbox
      : await loadGitHubPullRequestInboxForContext(context, input.profileId);
  const groupsWithoutRuns = buildGitHubActionsPullRequestGroups(
    inbox.pullRequests,
    [],
    inbox.viewerLogin,
    input.owner,
    input.repository,
    input.limit
  );

  if (groupsWithoutRuns.length === 0) {
    return buildGitHubActionsRuns(input, [], 0, false, []);
  }

  const openPullRequestNumbers = new Set(
    groupsWithoutRuns.map((pullRequest) => pullRequest.number)
  );
  const search = await searchGitHubActionsRunPages(
    GITHUB_ACTIONS_FILTERED_RUN_CAP,
    (page) =>
      loadGitHubWorkflowRunsPage(
        context,
        input,
        GITHUB_ACTIONS_FILTERED_PAGE_SIZE,
        page
      ).then(parseGitHubWorkflowRuns),
    async (runs) =>
      runs.filter((run) =>
        run.pullRequestNumbers.some((number) => openPullRequestNumbers.has(number))
      )
  );
  const pullRequests = buildGitHubActionsPullRequestGroups(
    inbox.pullRequests,
    search.runs,
    inbox.viewerLogin,
    input.owner,
    input.repository,
    input.limit
  );
  const runs = [
    ...new Map(
      pullRequests.flatMap((pullRequest) =>
        pullRequest.runs.map((run) => [run.id, run] as const)
      )
    ).values()
  ];

  return buildGitHubActionsRuns(
    input,
    runs,
    search.searchedRunCount,
    search.searchLimitReached,
    pullRequests
  );
}

function loadGitHubWorkflowRunsPage(
  context: GitHubContext,
  input: GitHubActionsRunsInput,
  perPage: number,
  page: number
): Promise<unknown> {
  return runGitHubJson(context, [
    'api',
    '--hostname',
    context.host,
    `repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repository)}/actions/runs?per_page=${perPage}&page=${page}`
  ]);
}

export async function loadGitHubPullRequestInbox(profileId: string): Promise<GitHubPullRequestInbox> {
  const context = await getGitHubContext(profileId);
  return loadGitHubPullRequestInboxForContext(context, profileId);
}

async function loadGitHubPullRequestInboxForContext(
  context: GitHubContext,
  profileId: string
): Promise<GitHubPullRequestInbox> {
  const [raw, suggestionResult] = await Promise.all([
    runGitHubJson(context, [
      'api',
      'graphql',
      '--hostname',
      context.host,
      '-f',
      `query=${INBOX_QUERY}`,
      '-F',
      'reviewQuery=is:open is:pr archived:false review-requested:@me sort:updated-desc',
      '-F',
      'authoredQuery=is:open is:pr archived:false author:@me sort:updated-desc'
    ]),
    loadGitHubPullRequestSuggestions(context, profileId)
  ]);
  const inbox = parseGitHubInboxResponse(raw, profileId, context.host);
  inbox.suggestions = suggestionResult.suggestions;
  inbox.suggestionsError = suggestionResult.errorMessage;

  gitHubPullRequestInboxCache.set(profileId, inbox);
  return inbox;
}

async function loadGitHubPullRequestSuggestions(
  context: GitHubContext,
  profileId: string
): Promise<{ suggestions: GitHubPullRequestSuggestion[]; errorMessage?: string }> {
  const viewerLogin = context.profile.githubLogin;
  if (!viewerLogin) {
    return { suggestions: [] };
  }

  const cacheKey = [
    profileId,
    context.host.toLowerCase(),
    viewerLogin.toLowerCase(),
    context.profile.ghConfigDir ?? ''
  ].join('\n');
  const cached = gitHubPullRequestSuggestionCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    if (cached.retryAfter && cached.retryAfter > Date.now()) {
      return {
        suggestions: cached.suggestions.slice(0, GITHUB_PULL_REQUEST_SUGGESTION_LIMIT),
        errorMessage: cached.errorMessage
      };
    }

    try {
      const suggestions = await filterSuggestionsWithoutOpenPullRequests(
        context,
        cached.suggestions
      );
      cached.suggestions = suggestions;
      return {
        suggestions: suggestions.slice(0, GITHUB_PULL_REQUEST_SUGGESTION_LIMIT),
        errorMessage: cached.errorMessage
      };
    } catch {
      cached.retryAfter = Date.now() + GITHUB_PULL_REQUEST_SUGGESTION_RETRY_BACKOFF_MS;
      cached.errorMessage = 'Could not recheck recently pushed branches. GitHub may be temporarily unavailable.';
      return {
        suggestions: cached.suggestions.slice(0, GITHUB_PULL_REQUEST_SUGGESTION_LIMIT),
        errorMessage: cached.errorMessage
      };
    }
  }

  let rawEvents: unknown[];
  try {
    rawEvents = await runGitHubLimitedPaginatedArray(
      context,
      `users/${encodeURIComponent(viewerLogin)}/events`,
      GITHUB_RECENT_PUSH_EVENT_PAGE_CAP
    );
  } catch {
    const errorMessage = 'Could not check recently pushed branches. Your pull request inbox is still available.';
    gitHubPullRequestSuggestionCache.set(cacheKey, {
      expiresAt: Date.now() + GITHUB_PULL_REQUEST_SUGGESTION_RETRY_BACKOFF_MS,
      suggestions: [],
      errorMessage
    });
    return { suggestions: [], errorMessage };
  }
  const candidates = parseGitHubRecentPushEvents(
    rawEvents,
    viewerLogin,
    Date.now() - GITHUB_RECENT_PUSH_MAX_AGE_MS
  ).slice(0, GITHUB_RECENT_PUSH_CANDIDATE_LIMIT);
  const repositoryMetadata = new Map<string, Promise<unknown>>();
  const suggestions: GitHubPullRequestSuggestion[] = [];
  let hadCandidateFailure = false;

  for (
    let offset = 0;
    offset < candidates.length;
    offset += GITHUB_RECENT_PUSH_EVALUATION_BATCH_SIZE
  ) {
    const batch = candidates.slice(offset, offset + GITHUB_RECENT_PUSH_EVALUATION_BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (candidate) => {
        try {
          return await loadGitHubPullRequestSuggestionCandidate(
            context,
            candidate,
            repositoryMetadata
          );
        } catch {
          hadCandidateFailure = true;
          return undefined;
        }
      })
    );
    suggestions.push(
      ...results.filter(
        (suggestion): suggestion is GitHubPullRequestSuggestion => Boolean(suggestion)
      )
    );
  }

  const errorMessage = hadCandidateFailure
    ? 'Some recently pushed branches could not be checked. GitHub may be temporarily unavailable.'
    : undefined;
  gitHubPullRequestSuggestionCache.set(cacheKey, {
    expiresAt: Date.now() + (
      hadCandidateFailure
        ? GITHUB_PULL_REQUEST_SUGGESTION_RETRY_BACKOFF_MS
        : GITHUB_PULL_REQUEST_SUGGESTION_CACHE_TTL_MS
    ),
    suggestions,
    errorMessage
  });
  return {
    suggestions: suggestions.slice(0, GITHUB_PULL_REQUEST_SUGGESTION_LIMIT),
    errorMessage
  };
}

async function loadGitHubPullRequestSuggestionCandidate(
  context: GitHubContext,
  candidate: GitHubRecentPushCandidate,
  repositoryMetadata: Map<string, Promise<unknown>>
): Promise<GitHubPullRequestSuggestion | undefined> {
  const repositoryKey = `${candidate.owner.toLowerCase()}/${candidate.repository.toLowerCase()}`;
  let metadataPromise = repositoryMetadata.get(repositoryKey);
  if (!metadataPromise) {
    metadataPromise = runGitHubJson(context, [
      'api',
      '--hostname',
      context.host,
      `repos/${encodeURIComponent(candidate.owner)}/${encodeURIComponent(candidate.repository)}`
    ]);
    repositoryMetadata.set(repositoryKey, metadataPromise);
  }

  const metadata = readRecord(await metadataPromise, 'GitHub repository');
  const defaultBranch = readString(metadata.default_branch, 'GitHub default branch');
  const repositoryOwner = readNestedOptionalString(metadata, ['owner', 'login']) ?? candidate.owner;
  const htmlUrl = readString(metadata.html_url, 'GitHub repository URL');
  const endpoint = gitHubRepositoryEndpoint(candidate.owner, candidate.repository);
  const [openPullRequests, comparison] = await Promise.all([
    loadOpenPullRequestsForBranch(context, endpoint, repositoryOwner, candidate.branch),
    runGitHubJson(context, [
      'api',
      '--hostname',
      context.host,
      `${endpoint}/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(candidate.branch)}`
    ])
  ]);

  return buildGitHubPullRequestSuggestion(
    candidate,
    defaultBranch,
    htmlUrl,
    openPullRequests,
    comparison
  );
}

async function filterSuggestionsWithoutOpenPullRequests(
  context: GitHubContext,
  suggestions: GitHubPullRequestSuggestion[]
): Promise<GitHubPullRequestSuggestion[]> {
  const remaining: GitHubPullRequestSuggestion[] = [];

  for (let index = 0; index < suggestions.length; index += 1) {
    if (remaining.length >= GITHUB_PULL_REQUEST_SUGGESTION_LIMIT) {
      remaining.push(...suggestions.slice(index));
      break;
    }

    const suggestion = suggestions[index];
    if (!suggestion) {
      continue;
    }
    const endpoint = gitHubRepositoryEndpoint(suggestion.owner, suggestion.repository);
    const openPullRequests = await loadOpenPullRequestsForBranch(
      context,
      endpoint,
      suggestion.owner,
      suggestion.branch
    );
    if (openPullRequests.length === 0) {
      remaining.push(suggestion);
    }
  }

  return remaining;
}

async function loadOpenPullRequestsForBranch(
  context: GitHubContext,
  repositoryEndpoint: string,
  repositoryOwner: string,
  branch: string
): Promise<unknown[]> {
  const value = await runGitHubJson(context, [
    'api',
    '--hostname',
    context.host,
    `${repositoryEndpoint}/pulls?state=open&head=${encodeURIComponent(`${repositoryOwner}:${branch}`)}&per_page=1`
  ]);

  if (!Array.isArray(value)) {
    throw new Error('GitHub pull requests must be an array.');
  }
  return value;
}

async function loadGitHubPullRequestSummaryForContext(
  context: GitHubContext,
  locator: GitHubPullRequestLocator
): Promise<{ pullRequest: GitHubPullRequestSummary; viewerLogin: string }> {
  const raw = await runGitHubJson(context, [
    'api',
    'graphql',
    '--hostname',
    context.host,
    '-f',
    `query=${DIRECT_PULL_REQUEST_QUERY}`,
    '-F',
    `owner=${locator.owner}`,
    '-F',
    `repository=${locator.repository}`,
    '-F',
    `number=${locator.number}`
  ]);

  return parseGitHubPullRequestResponse(raw, locator.profileId);
}

export function parseGitHubRepositoriesResponse(raw: unknown): GitHubRepositorySummary[] {
  if (!Array.isArray(raw)) {
    throw new Error('GitHub CLI returned an invalid repository list.');
  }

  return raw
    .map((value) => {
      const repository = readRecord(value, 'repository');
      const owner = readString(nestedValue(repository, ['owner', 'login']), 'repository owner');
      const name = readString(repository.name, 'repository name');

      return {
        owner,
        name,
        fullName: readOptionalString(repository.full_name) ?? `${owner}/${name}`,
        url: readString(repository.html_url, 'repository URL'),
        isPrivate: repository.private === true,
        defaultBranch: readOptionalString(repository.default_branch) ?? 'main'
      };
    })
    .sort((left, right) => left.fullName.localeCompare(right.fullName));
}

export function parseGitHubWorkflowRuns(raw: unknown): GitHubWorkflowRun[] {
  const response = readRecord(raw, 'workflow runs response');
  const workflowRuns = response.workflow_runs;

  if (!Array.isArray(workflowRuns)) {
    throw new Error('GitHub CLI returned an invalid workflow run list.');
  }

  return workflowRuns.map(parseWorkflowRun);
}

function buildGitHubActionsRuns(
  input: GitHubActionsRunsInput,
  runs: GitHubWorkflowRun[],
  searchedRunCount: number,
  searchLimitReached: boolean,
  pullRequests: GitHubActionsPullRequestGroup[] = []
): GitHubActionsRuns {
  return {
    profileId: input.profileId,
    owner: input.owner,
    repository: input.repository,
    runs,
    pullRequests,
    searchedRunCount,
    searchLimitReached,
    loadedAt: new Date().toISOString()
  };
}

export function buildGitHubActionsPullRequestGroups(
  pullRequests: GitHubPullRequestSummary[],
  runs: GitHubWorkflowRun[],
  viewerLogin: string,
  owner: string,
  repository: string,
  limit: number
): GitHubActionsPullRequestGroup[] {
  const normalizedViewerLogin = viewerLogin.toLowerCase();

  return pullRequests
    .filter(
      (pullRequest) =>
        pullRequest.owner === owner &&
        pullRequest.repository === repository &&
        pullRequest.author.toLowerCase() === normalizedViewerLogin
    )
    .sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    )
    .slice(0, limit)
    .map((pullRequest) => {
      const latestRunsByWorkflow = new Map<string, GitHubWorkflowRun>();

      runs
        .filter((run) => run.pullRequestNumbers.includes(pullRequest.number))
        .sort(
          (left, right) =>
            Date.parse(right.createdAt) - Date.parse(left.createdAt)
        )
        .forEach((run) => {
          if (!latestRunsByWorkflow.has(run.name)) {
            latestRunsByWorkflow.set(run.name, run);
          }
        });

      return {
        number: pullRequest.number,
        title: pullRequest.title,
        url: pullRequest.url,
        headRefName: pullRequest.headRefName,
        baseRefName: pullRequest.baseRefName,
        updatedAt: pullRequest.updatedAt,
        runs: [...latestRunsByWorkflow.values()]
      };
    });
}

export type GitHubActionsRunSearchResult = {
  runs: GitHubWorkflowRun[];
  searchedRunCount: number;
  searchLimitReached: boolean;
};

export async function searchGitHubActionsRunPages(
  limit: number,
  loadPage: (page: number) => Promise<GitHubWorkflowRun[]>,
  filterPage: (runs: GitHubWorkflowRun[]) => Promise<GitHubWorkflowRun[]>,
  runCap = GITHUB_ACTIONS_FILTERED_RUN_CAP,
  pageSize = GITHUB_ACTIONS_FILTERED_PAGE_SIZE
): Promise<GitHubActionsRunSearchResult> {
  const runs: GitHubWorkflowRun[] = [];
  let searchedRunCount = 0;
  const pageCount = Math.ceil(runCap / pageSize);

  for (let page = 1; page <= pageCount; page += 1) {
    const loadedRuns = await loadPage(page);
    const runsWithinCap = loadedRuns.slice(0, runCap - searchedRunCount);
    searchedRunCount += runsWithinCap.length;
    const matches = await filterPage(runsWithinCap);
    runs.push(...matches.slice(0, limit - runs.length));

    if (runs.length >= limit || loadedRuns.length < pageSize) {
      return {
        runs,
        searchedRunCount,
        searchLimitReached: false
      };
    }
  }

  return {
    runs,
    searchedRunCount,
    searchLimitReached: true
  };
}

export function hasGitHubActionsRunFilters(filters: GitHubActionsRunFilters): boolean {
  return (
    filters.branches.length > 0 ||
    filters.includeTags ||
    filters.includeMyPullRequests
  );
}

export function filterGitHubActionsRuns(
  runs: GitHubWorkflowRun[],
  filters: GitHubActionsRunFilters,
  tags: GitHubTag[] = [],
  authoredPullRequestNumbers: ReadonlySet<number> = new Set()
): GitHubWorkflowRun[] {
  if (!hasGitHubActionsRunFilters(filters)) {
    return runs;
  }

  const branches = new Set(filters.branches);
  const currentTags = new Set(tags.map((tag) => `${tag.name}\0${tag.sha}`));

  return runs.filter((run) => {
    const matchesBranch = run.branch !== undefined && branches.has(run.branch);
    const matchesTag =
      filters.includeTags &&
      run.event === 'push' &&
      run.branch !== undefined &&
      currentTags.has(`${run.branch}\0${run.sha}`);
    const matchesMyPullRequest =
      filters.includeMyPullRequests &&
      run.pullRequestNumbers.some((number) => authoredPullRequestNumbers.has(number));

    return matchesBranch || matchesTag || matchesMyPullRequest;
  });
}

function parseWorkflowRun(value: unknown): GitHubWorkflowRun {
  const run = readRecord(value, 'workflow run');
  const name = readOptionalString(run.name) ?? 'Workflow';
  const event = readOptionalString(run.event) ?? 'workflow_dispatch';

  return {
    id: readNumber(run.id, 'workflow run id'),
    name,
    displayTitle: readOptionalString(run.display_title) ?? name,
    runNumber: readNumber(run.run_number, 'workflow run number'),
    event,
    branch: event === 'issue_comment' ? undefined : readOptionalString(run.head_branch),
    sha: readString(run.head_sha, 'workflow run SHA'),
    status: normalizeWorkflowRunStatus(readOptionalString(run.status)),
    conclusion: normalizeWorkflowRunConclusion(readOptionalString(run.conclusion)),
    url: readString(run.html_url, 'workflow run URL'),
    actor: readNestedOptionalString(run, ['actor', 'login']),
    pullRequestNumbers: parseWorkflowRunPullRequestNumbers(run.pull_requests),
    createdAt: readString(run.created_at, 'workflow run created time'),
    startedAt: readOptionalString(run.run_started_at),
    updatedAt: readString(run.updated_at, 'workflow run updated time')
  };
}

type GitHubWorkflowJobDefinition = {
  id: string;
  name?: string;
  needs: string[];
};

export function parseGitHubWorkflowJobGraph(
  source: string
): GitHubWorkflowJobDefinition[] {
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  const jobsLineIndex = lines.findIndex((line) => /^jobs:\s*(?:#.*)?$/.test(line));

  if (jobsLineIndex < 0) {
    return [];
  }

  const definitions: GitHubWorkflowJobDefinition[] = [];
  let current: GitHubWorkflowJobDefinition | undefined;
  let readingNeeds = false;

  for (const line of lines.slice(jobsLineIndex + 1)) {
    if (line.trim() && !line.startsWith(' ')) {
      break;
    }

    const jobMatch = /^ {2}(\S[^:]*):\s*(?:#.*)?$/.exec(line);
    if (jobMatch) {
      current = {
        id: parseYamlScalar(jobMatch[1]),
        needs: []
      };
      definitions.push(current);
      readingNeeds = false;
      continue;
    }

    if (!current) {
      continue;
    }

    const nameMatch = /^ {4}name:\s*(.+?)\s*$/.exec(line);
    if (nameMatch) {
      const name = parseYamlScalar(nameMatch[1]);
      current.name = name.includes('${{') ? undefined : name;
      readingNeeds = false;
      continue;
    }

    const needsMatch = /^ {4}needs:\s*(.*?)\s*$/.exec(line);
    if (needsMatch) {
      const needsValue = needsMatch[1];
      readingNeeds = needsValue.length === 0;
      if (needsValue.startsWith('[') && needsValue.endsWith(']')) {
        current.needs.push(
          ...needsValue
            .slice(1, -1)
            .split(',')
            .map(parseYamlScalar)
            .filter(Boolean)
        );
      } else if (needsValue) {
        current.needs.push(parseYamlScalar(needsValue));
      }
      continue;
    }

    if (readingNeeds) {
      const needsItemMatch = /^ {6}-\s+(.+?)\s*$/.exec(line);
      if (needsItemMatch) {
        current.needs.push(parseYamlScalar(needsItemMatch[1]));
        continue;
      }

      if (line.trim() && !line.startsWith('      ')) {
        readingNeeds = false;
      }
    }
  }

  return definitions.filter((definition) => definition.id.length > 0);
}

function parseYamlScalar(value: string): string {
  const withoutComment = value.replace(/\s+#.*$/, '').trim();
  const quote = withoutComment[0];
  return (quote === '"' || quote === "'") && withoutComment.at(-1) === quote
    ? withoutComment.slice(1, -1)
    : withoutComment;
}

export function parseGitHubWorkflowRunJobsResponse(
  raw: unknown,
  input: GitHubWorkflowRunFailureInput,
  workflowJobs: GitHubWorkflowJobDefinition[] = [],
  workflowPath?: string
): GitHubWorkflowRunDetail {
  const response = readRecord(raw, 'workflow run jobs response');
  const rawJobs = response.jobs;

  if (!Array.isArray(rawJobs)) {
    throw new Error('GitHub CLI returned an invalid workflow job list.');
  }

  const jobs: GitHubWorkflowRunDetail['jobs'] = rawJobs.map((value) => {
    const job = readRecord(value, 'workflow job');
    const rawSteps = job.steps;
    const steps = Array.isArray(rawSteps)
      ? rawSteps.map((value) => {
          const step = readRecord(value, 'workflow step');

          return {
            number: readNumber(step.number, 'workflow step number'),
            name: readString(step.name, 'workflow step name'),
            status: normalizeWorkflowRunStatus(readOptionalString(step.status)),
            conclusion: normalizeWorkflowRunConclusion(
              readOptionalString(step.conclusion)
            ),
            startedAt: readOptionalString(step.started_at),
            completedAt: readOptionalString(step.completed_at)
          };
        })
      : [];
    const labels = Array.isArray(job.labels)
      ? job.labels.filter((label): label is string => typeof label === 'string')
      : [];

    return {
      id: readNumber(job.id, 'workflow job id'),
      name: readString(job.name, 'workflow job name'),
      dependencyJobIds: [],
      status: normalizeWorkflowRunStatus(readOptionalString(job.status)),
      conclusion: normalizeWorkflowRunConclusion(readOptionalString(job.conclusion)),
      url: readString(job.html_url, 'workflow job URL'),
      startedAt: readOptionalString(job.started_at),
      completedAt: readOptionalString(job.completed_at),
      runnerName: readOptionalString(job.runner_name),
      labels,
      steps
    };
  });
  const runtimeJobIdsByDefinition = new Map<string, number[]>();

  for (const definition of workflowJobs) {
    const expectedNames = [definition.name, definition.id].filter(
      (name): name is string => Boolean(name)
    );
    const exactMatches = jobs.filter((job) =>
      expectedNames.some(
        (expectedName) => normalizeWorkflowJobName(job.name) === normalizeWorkflowJobName(expectedName)
      )
    );
    const matches =
      exactMatches.length > 0
        ? exactMatches
        : jobs.filter((job) =>
            expectedNames.some((expectedName) => {
              const actual = normalizeWorkflowJobName(job.name);
              const expected = normalizeWorkflowJobName(expectedName);
              return actual.startsWith(`${expected} (`) || actual.startsWith(`${expected} / `);
            })
          );

    if (matches.length > 0) {
      runtimeJobIdsByDefinition.set(
        definition.id,
        matches.map((job) => job.id)
      );
    }
  }

  for (const definition of workflowJobs) {
    const runtimeJobIds = runtimeJobIdsByDefinition.get(definition.id) ?? [];
    const dependencyJobIds = [
      ...new Set(
        definition.needs.flatMap(
          (dependencyId) => runtimeJobIdsByDefinition.get(dependencyId) ?? []
        )
      )
    ];

    for (const runtimeJobId of runtimeJobIds) {
      const job = jobs.find((candidate) => candidate.id === runtimeJobId);
      if (job) {
        job.dependencyJobIds = dependencyJobIds;
      }
    }
  }

  return {
    ...input,
    workflowPath,
    dependencyGraphAvailable: runtimeJobIdsByDefinition.size > 0,
    totalJobCount: readOptionalNumber(response.total_count) ?? jobs.length,
    jobs,
    loadedAt: new Date().toISOString()
  };
}

function normalizeWorkflowJobName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function parseWorkflowRunPullRequestNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((pullRequest) => {
    if (!pullRequest || typeof pullRequest !== 'object') {
      return [];
    }

    const number = readOptionalNumber((pullRequest as Record<string, unknown>).number);
    return number === undefined ? [] : [number];
  });
}

async function loadCachedGitHubRepositoryTags(
  context: GitHubContext,
  owner: string,
  repository: string
): Promise<GitHubTag[]> {
  const cacheKey = `${context.profile.id}\0${context.host}\0${owner}\0${repository}`;
  const cached = gitHubTagCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.tags;
  }

  const tags = loadGitHubRepositoryTags(context, owner, repository).catch((error) => {
    gitHubTagCache.delete(cacheKey);
    throw error;
  });
  gitHubTagCache.set(cacheKey, {
    tags,
    expiresAt: Date.now() + GITHUB_ACTIONS_METADATA_CACHE_TTL_MS
  });
  return tags;
}

async function loadGitHubRepositoryTags(
  context: GitHubContext,
  owner: string,
  repository: string
): Promise<GitHubTag[]> {
  const raw = await runGitHubLimitedPaginatedArray(
    context,
    `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/tags`,
    GITHUB_ACTIONS_TAG_PAGE_CAP
  );

  return raw.map(parseGitHubTag);
}

function parseGitHubTag(value: unknown): GitHubTag {
  const tag = readRecord(value, 'tag');
  return {
    name: readString(tag.name, 'tag name'),
    sha: readNestedString(tag, ['commit', 'sha'], 'tag commit SHA')
  };
}

async function loadAuthoredPullRequestNumbers(
  context: GitHubContext,
  input: GitHubActionsRunsInput,
  runs: GitHubWorkflowRun[]
): Promise<Set<number>> {
  const now = Date.now();
  for (const [key, entry] of pullRequestAuthorCache) {
    if (entry.expiresAt <= now) {
      pullRequestAuthorCache.delete(key);
    }
  }

  const numbers = [
    ...new Set(runs.flatMap((run) => run.pullRequestNumbers))
  ];
  const missingNumbers = numbers.filter((number) => {
    const cached = pullRequestAuthorCache.get(
      pullRequestAuthorCacheKey(context, input.owner, input.repository, number)
    );
    return !cached || cached.expiresAt <= now;
  });

  for (let index = 0; index < missingNumbers.length; index += GITHUB_ACTIONS_PR_AUTHOR_BATCH_SIZE) {
    await loadPullRequestAuthorBatch(
      context,
      input.owner,
      input.repository,
      missingNumbers.slice(index, index + GITHUB_ACTIONS_PR_AUTHOR_BATCH_SIZE)
    );
  }

  return new Set(
    numbers.filter((number) => {
      const cached = pullRequestAuthorCache.get(
        pullRequestAuthorCacheKey(context, input.owner, input.repository, number)
      );
      return cached?.login?.toLowerCase() === context.profile.githubLogin?.toLowerCase();
    })
  );
}

async function loadPullRequestAuthorBatch(
  context: GitHubContext,
  owner: string,
  repository: string,
  numbers: number[]
): Promise<void> {
  if (numbers.length === 0) {
    return;
  }

  const variables = numbers.map((_, index) => `$number${index}: Int!`).join(', ');
  const selections = numbers
    .map((_, index) => `pr${index}: pullRequest(number: $number${index}) { author { login } }`)
    .join('\n');
  const query = `
query GitGudActionsPullRequestAuthors($owner: String!, $repository: String!, ${variables}) {
  repository(owner: $owner, name: $repository) {
    ${selections}
  }
}`.trim();
  const raw = await runGitHubJson(context, [
    'api',
    'graphql',
    '--hostname',
    context.host,
    '-f',
    `query=${query}`,
    '-F',
    `owner=${owner}`,
    '-F',
    `repository=${repository}`,
    ...numbers.flatMap((number, index) => ['-F', `number${index}=${number}`])
  ]);
  const repositoryResult = nestedValue(readRecord(raw, 'pull request authors response'), [
    'data',
    'repository'
  ]);
  const repositoryRecord =
    repositoryResult && typeof repositoryResult === 'object'
      ? repositoryResult as Record<string, unknown>
      : {};
  const expiresAt = Date.now() + GITHUB_ACTIONS_METADATA_CACHE_TTL_MS;

  numbers.forEach((number, index) => {
    pullRequestAuthorCache.set(
      pullRequestAuthorCacheKey(context, owner, repository, number),
      {
        login: readNestedOptionalString(repositoryRecord, [`pr${index}`, 'author', 'login']),
        expiresAt
      }
    );
  });
}

function pullRequestAuthorCacheKey(
  context: GitHubContext,
  owner: string,
  repository: string,
  number: number
): string {
  return `${context.host}\0${owner}\0${repository}\0${number}`;
}

function normalizeWorkflowRunStatus(value: string | undefined): GitHubWorkflowRunStatus {
  const normalized = value?.toLowerCase().replaceAll('_', '-');

  if (
    normalized === 'queued' ||
    normalized === 'in-progress' ||
    normalized === 'completed' ||
    normalized === 'waiting' ||
    normalized === 'requested' ||
    normalized === 'pending'
  ) {
    return normalized;
  }

  return 'unknown';
}

function normalizeWorkflowRunConclusion(
  value: string | undefined
): GitHubWorkflowRunConclusion | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.toLowerCase().replaceAll('_', '-');

  if (
    normalized === 'success' ||
    normalized === 'failure' ||
    normalized === 'cancelled' ||
    normalized === 'skipped' ||
    normalized === 'timed-out' ||
    normalized === 'action-required' ||
    normalized === 'neutral' ||
    normalized === 'stale' ||
    normalized === 'startup-failure'
  ) {
    return normalized;
  }

  return 'unknown';
}

export async function loadGitHubPullRequestDetail(
  locator: GitHubPullRequestLocator
): Promise<GitHubPullRequestDetail> {
  const context = await getGitHubContext(locator.profileId);
  const endpoint = pullRequestEndpoint(locator);
  const [
    summaryResult,
    pullRaw,
    repositoryRaw,
    filesRaw,
    commitsRaw,
    reviewCommentsRaw,
    conversationCommentsRaw,
    reviewsRaw
  ] = await Promise.all([
    loadGitHubPullRequestSummaryForContext(context, locator),
    runGitHubJson(context, [
      'api',
      '--hostname',
      context.host,
      '-H',
      'Accept: application/vnd.github.full+json',
      endpoint
    ]),
    runGitHubJson(context, ['api', '--hostname', context.host, repositoryEndpoint(locator)]),
    runGitHubPaginatedArray(context, `${endpoint}/files?per_page=100`),
    runGitHubPaginatedArray(context, `${endpoint}/commits?per_page=100`),
    runGitHubPaginatedArray(context, `${endpoint}/comments?per_page=100`),
    runGitHubPaginatedArray(
      context,
      `repos/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.repository)}/issues/${locator.number}/comments?per_page=100`
    ),
    runGitHubPaginatedArray(context, `${endpoint}/reviews?per_page=100`)
  ]);
  const { pullRequest: summary, viewerLogin } = summaryResult;

  const pull = readRecord(pullRaw, 'pull request');
  const files = filesRaw.map(parsePullRequestFile);
  const headSha = readNestedString(pull, ['head', 'sha'], 'pull request head SHA');
  const baseSha = readNestedString(pull, ['base', 'sha'], 'pull request base SHA');
  const baseRefShaRequest = loadGitHubBranchHeadSha(
    context,
    locator,
    summary.baseRefName,
    baseSha
  );
  const mergeBaseSha = loadGitHubMergeBaseSha(context, locator, baseSha, headSha);
  const [baseRefSha, initialPreparation] = await Promise.all([
    baseRefShaRequest,
    prepareGitHubPullRequestReviewPlan(context.host, summary, headSha, files)
  ]);
  const reviewPlan = initialPreparation.reviewPlan;
  rememberGitHubPullRequestReviewSeed({
    context,
    locator,
    pullRequest: summary,
    headSha,
    files,
    initialPreparation,
    mergeBaseSha
  });
  githubPullRequestReviewPlans.remember(locator, reviewPlan);

  return {
    ...summary,
    body: readOptionalString(pull.body) ?? '',
    bodyImageUrls: parseGitHubBodyImageUrls(
      readOptionalString(pull.body) ?? '',
      readOptionalString(pull.body_html) ?? ''
    ),
    headSha,
    baseSha,
    baseRefSha,
    commits: readNumber(pull.commits, 'pull request commits'),
    commitTimeline: commitsRaw.map(parsePullRequestCommit),
    files,
    reviewPlan,
    mergeSettings: parseGitHubRepositoryMergeSettings(repositoryRaw),
    viewerLogin,
    reviewComments: reviewCommentsRaw.map(parseReviewComment),
    conversationComments: conversationCommentsRaw.map(parseConversationComment),
    reviews: reviewsRaw.map(parseReview),
    loadedAt: new Date().toISOString()
  };
}

export async function loadGitHubPullRequestReviewerCandidates(
  locator: GitHubPullRequestLocator
): Promise<GitHubPullRequestReviewerCandidate[]> {
  const context = await getGitHubContext(locator.profileId);
  const endpoint = repositoryEndpoint(locator);
  const [users, teams] = await Promise.all([
    runGitHubPaginatedArray(
      context,
      `${endpoint}/collaborators?affiliation=all&per_page=100`
    ),
    runGitHubPaginatedArray(context, `${endpoint}/teams?per_page=100`)
  ]);

  return parseGitHubPullRequestReviewerCandidates(users, teams);
}

export function parseGitHubPullRequestReviewerCandidates(
  users: unknown[],
  teams: unknown[]
): GitHubPullRequestReviewerCandidate[] {
  const candidates = new Map<string, GitHubPullRequestReviewerCandidate>();

  for (const value of users) {
    const user = readRecord(value, 'reviewer candidate');
    const login = readString(user.login, 'reviewer login');
    const id = `user:${login.toLowerCase()}`;
    candidates.set(id, {
      id,
      kind: 'user',
      login,
      name: readOptionalString(user.name),
      avatarUrl: readOptionalString(user.avatar_url)
    });
  }

  for (const value of teams) {
    const team = readRecord(value, 'reviewer team candidate');
    const organization = readNestedString(
      team,
      ['organization', 'login'],
      'reviewer team organization'
    );
    const slug = readString(team.slug, 'reviewer team slug');
    const id = `team:${organization.toLowerCase()}/${slug.toLowerCase()}`;
    candidates.set(id, {
      id,
      kind: 'team',
      organization,
      slug,
      name: readString(team.name, 'reviewer team name'),
      avatarUrl: readOptionalString(team.avatar_url)
    });
  }

  return [...candidates.values()].sort((left, right) =>
    reviewerCandidateLabel(left).localeCompare(reviewerCandidateLabel(right), undefined, {
      sensitivity: 'base'
    })
  );
}

function reviewerCandidateLabel(candidate: GitHubPullRequestReviewerCandidate): string {
  return candidate.kind === 'user'
    ? candidate.login
    : `${candidate.organization}/${candidate.slug}`;
}

export async function loadGitHubPullRequestReviewPlan(
  locator: GitHubPullRequestLocator,
  headSha: string
): Promise<GitReviewPlan> {
  const seed = gitHubPullRequestReviewSeeds.get(pullRequestReviewSeedKey(locator));

  if (!seed || seed.headSha !== headSha) {
    throw new Error('Reload the pull request before loading its full review context.');
  }

  seed.enrichment ??= enrichGitHubPullRequestReviewPlan(seed);
  return seed.enrichment;
}

async function enrichGitHubPullRequestReviewPlan(
  seed: GitHubPullRequestReviewSeed
): Promise<GitReviewPlan> {
  const mergeBaseSha = await seed.mergeBaseSha;

  if (!mergeBaseSha) {
    return seed.initialPreparation.reviewPlan;
  }

  const analysis = await loadGitHubPullRequestFileAnalysis(
    seed.context,
    seed.locator,
    mergeBaseSha,
    seed.headSha,
    selectGitHubReviewContextFiles(seed.initialPreparation.reviewPlan, seed.files)
  );
  const preparedSyntaxByPath = new Map(seed.initialPreparation.syntaxByPath);

  for (const [path, syntax] of analysis.syntaxByPath) {
    preparedSyntaxByPath.set(path, syntax);
  }

  const enrichedPlan = await buildGitHubPullRequestReviewPlan(
    seed.context.host,
    seed.pullRequest,
    seed.headSha,
    seed.files,
    analysis.fileContexts,
    preparedSyntaxByPath
  );
  const reviewPlan = mergeGitHubPullRequestReviewPlanContext(
    seed.initialPreparation.reviewPlan,
    enrichedPlan
  );

  if (gitHubPullRequestReviewSeeds.get(pullRequestReviewSeedKey(seed.locator)) === seed) {
    githubPullRequestReviewPlans.remember(seed.locator, reviewPlan);
  }

  return reviewPlan;
}

export function mergeGitHubPullRequestReviewPlanContext(
  initialPlan: GitReviewPlan,
  enrichedPlan: GitReviewPlan
): GitReviewPlan {
  const contextIdByPath = new Map(
    enrichedPlan.fileContexts.map((context) => [context.path, context.id])
  );

  return {
    ...initialPlan,
    units: initialPlan.units.map((unit) => ({
      ...unit,
      chunks: unit.chunks.map((chunk) => {
        const fileContextId = contextIdByPath.get(chunk.path);
        return fileContextId ? { ...chunk, fileContextId } : chunk;
      })
    })),
    fileContexts: enrichedPlan.fileContexts
  };
}

function rememberGitHubPullRequestReviewSeed(seed: GitHubPullRequestReviewSeed): void {
  const key = pullRequestReviewSeedKey(seed.locator);
  gitHubPullRequestReviewSeeds.delete(key);
  gitHubPullRequestReviewSeeds.set(key, seed);

  while (gitHubPullRequestReviewSeeds.size > GITHUB_PULL_REQUEST_REVIEW_SEED_LIMIT) {
    const oldestKey = gitHubPullRequestReviewSeeds.keys().next().value;

    if (typeof oldestKey !== 'string') {
      return;
    }
    gitHubPullRequestReviewSeeds.delete(oldestKey);
  }
}

function pullRequestReviewSeedKey(locator: GitHubPullRequestLocator): string {
  return [
    locator.profileId,
    locator.owner.toLowerCase(),
    locator.repository.toLowerCase(),
    locator.number
  ].join(':');
}

export function canReuseGitHubPullRequestInbox(
  inbox: GitHubPullRequestInbox,
  now = Date.now()
): boolean {
  const loadedAt = Date.parse(inbox.loadedAt);
  return Number.isFinite(loadedAt) &&
    now - loadedAt >= 0 &&
    now - loadedAt < GITHUB_PULL_REQUEST_INBOX_CACHE_TTL_MS;
}

export function selectGitHubReviewContextFiles(
  reviewPlan: GitReviewPlan,
  files: GitHubPullRequestFile[],
  limit = GITHUB_REVIEW_CONTEXT_MAX_FILES
): GitHubPullRequestFile[] {
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const selectedPaths = new Set<string>();
  const selectedFiles: GitHubPullRequestFile[] = [];

  for (const chunk of reviewPlan.units.flatMap((unit) => unit.chunks)) {
    if (selectedFiles.length >= limit || selectedPaths.has(chunk.path)) {
      continue;
    }

    const file = fileByPath.get(chunk.path);

    if (!file || file.omittedReason || !file.patch) {
      continue;
    }

    selectedPaths.add(chunk.path);
    selectedFiles.push(file);
  }

  return selectedFiles;
}

async function loadGitHubBranchHeadSha(
  context: GitHubContext,
  locator: GitHubPullRequestLocator,
  branch: string,
  fallbackSha: string
): Promise<string> {
  const endpoint =
    `${repositoryEndpoint(locator)}/commits/${encodeURIComponent(branch)}`;

  try {
    return await runGitHubText(context, [
      'api',
      '--hostname',
      context.host,
      '--jq',
      '.sha',
      endpoint
    ]) || fallbackSha;
  } catch {
    return fallbackSha;
  }
}

async function loadGitHubMergeBaseSha(
  context: GitHubContext,
  locator: GitHubPullRequestLocator,
  baseSha: string,
  headSha: string
): Promise<string | undefined> {
  const endpoint = `${repositoryEndpoint(locator)}/compare/${encodeURIComponent(baseSha)}...${encodeURIComponent(headSha)}`;

  try {
    return await runGitHubText(context, [
      'api',
      '--hostname',
      context.host,
      '--jq',
      '.merge_base_commit.sha',
      endpoint
    ]) || undefined;
  } catch {
    return undefined;
  }
}

export async function buildGitHubPullRequestReviewPlan(
  host: string,
  pullRequest: GitHubPullRequestSummary,
  headSha: string,
  files: GitHubPullRequestFile[],
  fileContexts: GitHubReviewFileContext[] = [],
  preparedSyntaxByPath?: ReadonlyMap<string, ReviewPatchSyntax | undefined>
): Promise<GitReviewPlan> {
  const preparation = await prepareGitHubPullRequestReviewPlan(
    host,
    pullRequest,
    headSha,
    files,
    fileContexts,
    preparedSyntaxByPath
  );

  return preparation.reviewPlan;
}

async function prepareGitHubPullRequestReviewPlan(
  host: string,
  pullRequest: GitHubPullRequestSummary,
  headSha: string,
  files: GitHubPullRequestFile[],
  fileContexts: GitHubReviewFileContext[] = [],
  preparedSyntaxByPath?: ReadonlyMap<string, ReviewPatchSyntax | undefined>
): Promise<GitHubReviewPlanPreparation> {
  const repoPath = `github://${host}/${pullRequest.owner}/${pullRequest.repository}`;
  const target = {
    kind: 'branch' as const,
    name: pullRequest.headRefName,
    sha: headSha
  };
  const contextByPath = new Map(fileContexts.map((context) => [context.path, context]));
  const patches = await mapWithConcurrency(
    files,
    GITHUB_REVIEW_CONTEXT_CONCURRENCY,
    async (file): Promise<ReviewPatchInput> => {
      const input = createGitHubReviewPatch(repoPath, file, contextByPath.get(file.path));

      if (preparedSyntaxByPath?.has(file.path)) {
        const syntax = preparedSyntaxByPath.get(file.path);
        return syntax ? { ...input, syntax } : input;
      }

      return attachReviewSyntax(repoPath, input);
    }
  );
  const plan = buildReviewPlan(repoPath, target, patches);

  return {
    reviewPlan: {
      ...plan,
      targetKey: `github-pr:${pullRequest.profileId}:${pullRequest.owner}/${pullRequest.repository}#${pullRequest.number}:${headSha}`
    },
    syntaxByPath: new Map(patches.map((patch) => [patch.path, patch.syntax]))
  };
}

function createGitHubReviewPatch(
  repoPath: string,
  file: GitHubPullRequestFile,
  fileContext?: GitHubReviewFileContext
): ReviewPatchInput {
  return {
    path: file.path,
    originalPath: file.previousPath,
    status: gitHubFileStatusToGitStatus(file.status),
    source: 'commit',
    diff: {
      repoPath,
      path: file.path,
      originalPath: file.previousPath,
      mode: 'selection',
      patch: file.patch ?? '',
      isBinary: file.omittedReason === 'binary',
      omittedReason: file.omittedReason,
      loadedAt: new Date().toISOString()
    },
    fileContext: fileContext
      ? {
          oldContents: fileContext.oldContents,
          newContents: fileContext.newContents
        }
      : undefined
  };
}

function emptyGitHubReviewFileAnalysis(): GitHubReviewFileAnalysis {
  return {
    fileContexts: [],
    syntaxByPath: new Map()
  };
}

async function mapWithConcurrency<Value, Result>(
  values: readonly Value[],
  concurrency: number,
  mapper: (value: Value, index: number) => Promise<Result>
): Promise<Result[]> {
  const results = new Array<Result>(values.length);
  const workerCount = Math.min(Math.max(1, concurrency), values.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

async function loadGitHubPullRequestFileAnalysis(
  context: GitHubContext,
  locator: GitHubPullRequestLocator,
  baseSha: string,
  headSha: string,
  files: GitHubPullRequestFile[]
): Promise<GitHubReviewFileAnalysis> {
  const analysis = emptyGitHubReviewFileAnalysis();
  const repoPath = `github://${context.host}/${locator.owner}/${locator.repository}`;
  let retainedBytes = 0;

  for (let index = 0; index < files.length; index += GITHUB_REVIEW_CONTEXT_BATCH_SIZE) {
    const batch = files.slice(index, index + GITHUB_REVIEW_CONTEXT_BATCH_SIZE);
    const batchedContexts = await loadGitHubPullRequestFileContextBatch(
      context,
      locator,
      baseSha,
      headSha,
      batch
    );
    const loadedBatch = await mapWithConcurrency(
      batch,
      GITHUB_REVIEW_CONTEXT_CONCURRENCY,
      async (file, batchIndex) => {
        let fileContext = batchedContexts?.[batchIndex];

        if (!fileContext) {
          fileContext = await loadGitHubPullRequestFileContext(
            context,
            locator,
            baseSha,
            headSha,
            file
          );
        }

        if (!fileContext) {
          return undefined;
        }

        const input = await attachReviewSyntax(
          repoPath,
          createGitHubReviewPatch(repoPath, file, fileContext)
        );

        return { fileContext, syntax: input.syntax };
      }
    );

    for (const loaded of loadedBatch) {
      if (!loaded) {
        continue;
      }

      const { fileContext, syntax } = loaded;
      analysis.syntaxByPath.set(fileContext.path, syntax);
      const contextBytes = Buffer.byteLength(fileContext.oldContents) +
        Buffer.byteLength(fileContext.newContents);

      if (retainedBytes + contextBytes > GITHUB_REVIEW_RETAINED_CONTEXT_MAX_BYTES) {
        continue;
      }

      retainedBytes += contextBytes;
      analysis.fileContexts.push(fileContext);
    }
  }

  return analysis;
}

async function loadGitHubPullRequestFileContextBatch(
  context: GitHubContext,
  locator: GitHubPullRequestLocator,
  baseSha: string,
  headSha: string,
  files: GitHubPullRequestFile[]
): Promise<Array<GitHubReviewFileContext | undefined> | undefined> {
  const requests = files.flatMap((file): GitHubFileTextRequest[] => {
    if (file.omittedReason || !file.patch) {
      return [];
    }

    return [
      ...(file.status === 'added'
        ? []
        : [{ path: file.previousPath ?? file.path, ref: baseSha }]),
      ...(file.status === 'removed' ? [] : [{ path: file.path, ref: headSha }])
    ];
  });

  if (requests.length === 0) {
    return files.map(() => undefined);
  }

  try {
    const { query, variables } = buildGitHubFileTextBatchQuery(
      locator.owner,
      locator.repository,
      requests
    );
    const raw = await runGitHubJson(
      context,
      ['api', '--hostname', context.host, 'graphql', '--input', '-'],
      { query, variables }
    );
    const contents = parseGitHubFileTextBatchResponse(raw, requests.length);
    let requestIndex = 0;

    return files.map((file): GitHubReviewFileContext | undefined => {
      if (file.omittedReason || !file.patch) {
        return undefined;
      }

      const oldContents = file.status === 'added' ? '' : contents[requestIndex++];
      const newContents = file.status === 'removed' ? '' : contents[requestIndex++];

      if (oldContents === undefined || newContents === undefined) {
        return undefined;
      }

      return {
        path: file.path,
        originalPath: file.previousPath,
        oldContents,
        newContents
      };
    });
  } catch {
    return undefined;
  }
}

export function buildGitHubFileTextBatchQuery(
  owner: string,
  repository: string,
  requests: GitHubFileTextRequest[]
): GitHubFileTextBatchQuery {
  const expressionVariables = requests
    .map((_, index) => `$expression${index}: String!`)
    .join(', ');
  const objects = requests
    .map(
      (_, index) =>
        `content${index}: object(expression: $expression${index}) { ... on Blob { text isBinary isTruncated } }`
    )
    .join('\n');
  const variables = Object.fromEntries([
    ['owner', owner],
    ['repository', repository],
    ...requests.map((request, index) => [
      `expression${index}`,
      `${request.ref}:${request.path}`
    ])
  ]);

  return {
    query: `
query GitGudPullRequestFileContents(
  $owner: String!
  $repository: String!
  ${expressionVariables}
) {
  repository(owner: $owner, name: $repository) {
    ${objects}
  }
}`,
    variables
  };
}

export function parseGitHubFileTextBatchResponse(
  value: unknown,
  requestCount: number
): Array<string | undefined> {
  const response = readRecord(value, 'GitHub file contents response');
  const data = readRecord(response.data, 'GitHub file contents data');
  const repository = readRecord(data.repository, 'GitHub file contents repository');

  return Array.from({ length: requestCount }, (_, index) => {
    const blob = repository[`content${index}`];

    if (!blob || typeof blob !== 'object' || Array.isArray(blob)) {
      return undefined;
    }

    const record = blob as Record<string, unknown>;
    return record.isBinary === false &&
      record.isTruncated === false &&
      typeof record.text === 'string'
      ? record.text
      : undefined;
  });
}

async function loadGitHubPullRequestFileContext(
  context: GitHubContext,
  locator: GitHubPullRequestLocator,
  baseSha: string,
  headSha: string,
  file: GitHubPullRequestFile
): Promise<GitHubReviewFileContext | undefined> {
  if (file.omittedReason || !file.patch) {
    return undefined;
  }

  const [oldContents, newContents] = await Promise.all([
    file.status === 'added'
      ? Promise.resolve('')
      : loadGitHubFileText(context, locator, file.previousPath ?? file.path, baseSha),
    file.status === 'removed'
      ? Promise.resolve('')
      : loadGitHubFileText(context, locator, file.path, headSha)
  ]);

  if (oldContents === undefined || newContents === undefined) {
    return undefined;
  }

  return {
    path: file.path,
    originalPath: file.previousPath,
    oldContents,
    newContents
  };
}

async function loadGitHubFileText(
  context: GitHubContext,
  locator: GitHubPullRequestLocator,
  path: string,
  ref: string
): Promise<string | undefined> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const endpoint = `${repositoryEndpoint(locator)}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;

  try {
    const raw = readRecord(
      await runGitHubJson(context, ['api', '--hostname', context.host, endpoint]),
      'GitHub file contents'
    );

    if (raw.type !== 'file' || raw.encoding !== 'base64' || typeof raw.content !== 'string') {
      return undefined;
    }

    const contents = Buffer.from(raw.content.replaceAll('\n', ''), 'base64');
    const text = contents.toString('utf8');
    return Buffer.from(text, 'utf8').equals(contents) ? text : undefined;
  } catch {
    return undefined;
  }
}

export function parseGitHubRepositoryMergeSettings(
  value: unknown
): GitHubRepositoryMergeSettings {
  const repository = readRecord(value, 'GitHub repository');
  const allowedMethods = [
    repository.allow_squash_merge === true ? 'squash' : undefined,
    repository.allow_merge_commit === true ? 'merge' : undefined,
    repository.allow_rebase_merge === true ? 'rebase' : undefined
  ].filter((method): method is GitHubRepositoryMergeSettings['allowedMethods'][number] =>
    method !== undefined
  );

  if (allowedMethods.length === 0) {
    throw new Error('GitHub reports no enabled merge method for this repository.');
  }

  return {
    allowedMethods,
    defaultMethod: allowedMethods[0]
  };
}

export async function submitGitHubPullRequestReview(
  input: GitHubPullRequestReviewInput
): Promise<GitHubPullRequestActionResult> {
  const context = await getGitHubContext(input.profileId);
  const event =
    input.event === 'approve'
      ? 'APPROVE'
      : input.event === 'request-changes'
        ? 'REQUEST_CHANGES'
        : 'COMMENT';
  const endpoint = pullRequestEndpoint(input);
  const shouldSubmitReview =
    input.event !== 'comment' ||
    input.body.trim().length > 0 ||
    input.comments.length > 0;
  let reviewSubmitted = false;

  if (shouldSubmitReview) {
    const pendingReviewRaw = await runGitHubJson(
      context,
      [
        'api',
        '--hostname',
        context.host,
        '--method',
        'POST',
        '--input',
        '-',
        `${endpoint}/reviews`
      ],
      {
        commit_id: input.commitId,
        comments: input.comments.map((comment) => ({
          body: comment.body,
          path: comment.path,
          line: comment.line,
          side: comment.side === 'right' ? 'RIGHT' : 'LEFT',
          ...(comment.startLine !== undefined
            ? {
                start_line: comment.startLine,
                start_side: comment.startSide === 'left' ? 'LEFT' : 'RIGHT'
              }
            : {})
        }))
      }
    );
    const pendingReview = readRecord(pendingReviewRaw, 'pending pull request review');
    const reviewId = readNumber(pendingReview.id, 'pending pull request review ID');

    try {
      await runGitHubJson(
        context,
        [
          'api',
          '--hostname',
          context.host,
          '--method',
          'POST',
          '--input',
          '-',
          `${endpoint}/reviews/${reviewId}/events`
        ],
        {
          event,
          ...(input.body.trim() ? { body: input.body.trim() } : {})
        }
      );
      reviewSubmitted = true;
    } catch (error) {
      await deletePendingReview(context, endpoint, reviewId);
      throw error;
    }
  }

  const failedDraftIds: string[] = [];
  let submittedFileComments = 0;
  let submittedReplies = 0;
  let firstStandaloneCommentError: Error | undefined;

  for (const comment of input.fileComments) {
    try {
      await runGitHubJson(
        context,
        [
          'api',
          '--hostname',
          context.host,
          '--method',
          'POST',
          '--input',
          '-',
          `${endpoint}/comments`
        ],
        createGitHubFileReviewCommentPayload(comment, input.commitId)
      );
      submittedFileComments += 1;
    } catch (error) {
      failedDraftIds.push(comment.id);
      firstStandaloneCommentError ??=
        error instanceof Error ? error : new Error('Could not submit a file review comment.');
    }
  }

  for (const reply of input.replies) {
    try {
      await runGitHubJson(
        context,
        [
          'api',
          '--hostname',
          context.host,
          '--method',
          'POST',
          '--input',
          '-',
          `${pullRequestEndpoint(input)}/comments/${reply.inReplyToId}/replies`
        ],
        { body: reply.body }
      );
      submittedReplies += 1;
    } catch (error) {
      failedDraftIds.push(reply.id);
      firstStandaloneCommentError ??=
        error instanceof Error ? error : new Error('Could not submit a review reply.');
    }
  }

  if (
    !reviewSubmitted &&
    submittedFileComments === 0 &&
    submittedReplies === 0 &&
    firstStandaloneCommentError
  ) {
    throw firstStandaloneCommentError;
  }

  const submittedDraftCount = input.comments.length + submittedFileComments + submittedReplies;
  const actionMessage =
    input.event === 'approve'
      ? 'Pull request approved'
      : input.event === 'request-changes'
        ? 'Changes requested'
        : input.body.trim() || submittedDraftCount === 0
          ? 'Review submitted'
          : `${submittedDraftCount} review ${submittedDraftCount === 1 ? 'comment' : 'comments'} submitted`;
  const failureMessage =
    failedDraftIds.length > 0
      ? ` ${failedDraftIds.length} draft ${failedDraftIds.length === 1 ? 'comment was' : 'comments were'} not sent and ${failedDraftIds.length === 1 ? 'remains' : 'remain'} in Git Gud.`
      : '.';

  return {
    message: `${actionMessage}${failureMessage}`,
    submitted: reviewSubmitted || submittedFileComments > 0 || submittedReplies > 0,
    failedDraftIds
  };
}

export function createGitHubFileReviewCommentPayload(
  comment: GitHubPullRequestReviewInput['fileComments'][number],
  commitId: string
): Record<string, string> {
  return {
    body: comment.body,
    commit_id: commitId,
    path: comment.path,
    subject_type: 'file'
  };
}

export async function updateGitHubPullRequestReviewComment(
  input: GitHubPullRequestReviewCommentUpdateInput
): Promise<GitHubPullRequestActionResult> {
  const context = await getGitHubContext(input.profileId);
  const commentEndpoint = `${repositoryEndpoint(input)}/pulls/comments/${input.commentId}`;
  const existingComment = readRecord(
    await runGitHubJson(context, ['api', '--hostname', context.host, commentEndpoint]),
    'review comment'
  );
  const pullRequestUrl = readString(
    existingComment.pull_request_url,
    'review comment pull request URL'
  );
  if (!reviewCommentBelongsToPullRequest(pullRequestUrl, input)) {
    throw new Error('The review comment no longer belongs to this pull request. Refresh and try again.');
  }
  await runGitHubJson(
    context,
    [
      'api',
      '--hostname',
      context.host,
      '--method',
      'PATCH',
      '--input',
      '-',
      commentEndpoint
    ],
    { body: input.body }
  );
  return { message: 'Review comment updated.' };
}

export async function updateGitHubPullRequestReviewer(
  input: GitHubPullRequestReviewerUpdateInput
): Promise<GitHubPullRequestActionResult> {
  const context = await getGitHubContext(input.profileId);
  await runGitHubJson(
    context,
    [
      'api',
      '--hostname',
      context.host,
      '--method',
      input.requested ? 'POST' : 'DELETE',
      '--input',
      '-',
      `${pullRequestEndpoint(input)}/requested_reviewers`
    ],
    createGitHubReviewerRequestPayload(input.reviewer)
  );
  gitHubPullRequestInboxCache.delete(input.profileId);

  const reviewer = input.reviewer.kind === 'user'
    ? input.reviewer.login
    : input.reviewer.slug;
  return {
    message: input.requested
      ? `Review requested from ${reviewer}.`
      : `Review request removed from ${reviewer}.`
  };
}

export function createGitHubReviewerRequestPayload(
  reviewer: GitHubPullRequestReviewerUpdateInput['reviewer']
): { reviewers?: string[]; team_reviewers?: string[] } {
  return reviewer.kind === 'user'
    ? { reviewers: [reviewer.login] }
    : { team_reviewers: [reviewer.slug] };
}

export function reviewCommentBelongsToPullRequest(
  pullRequestUrl: string,
  locator: GitHubPullRequestLocator
): boolean {
  try {
    const path = decodeURIComponent(new URL(pullRequestUrl).pathname).replace(/\/$/u, '');
    const expectedPath = `/repos/${locator.owner}/${locator.repository}/pulls/${locator.number}`;
    return path === expectedPath || path === `/api/v3${expectedPath}`;
  } catch {
    return false;
  }
}

export async function mergeGitHubPullRequest(
  input: GitHubPullRequestMergeInput
): Promise<GitHubPullRequestActionResult> {
  const context = await getGitHubContext(input.profileId);
  const mergeSettings = parseGitHubRepositoryMergeSettings(
    await runGitHubJson(context, [
      'api',
      '--hostname',
      context.host,
      repositoryEndpoint(input)
    ])
  );

  if (!mergeSettings.allowedMethods.includes(input.method)) {
    throw new Error(`GitHub does not allow ${input.method} merges for this repository.`);
  }

  const raw = await runGitHubJson(context, [
    'api',
    '--hostname',
    context.host,
    '--method',
    'PUT',
    `${pullRequestEndpoint(input)}/merge`,
    '-f',
    `merge_method=${input.method}`
  ]);
  const result = readRecord(raw, 'merge result');
  const merged = result.merged === true;
  const message = readOptionalString(result.message) ?? (merged ? 'Pull request merged.' : 'GitHub did not merge the pull request.');

  if (!merged) {
    throw new Error(message);
  }

  return {
    message,
    merged,
    sha: readOptionalString(result.sha)
  };
}

export function parseGitHubInboxResponse(
  value: unknown,
  profileId: string,
  host: string
): GitHubPullRequestInbox {
  const root = readRecord(value, 'GitHub GraphQL response');
  const data = readRecord(root.data, 'GitHub GraphQL data');
  const viewer = readRecord(data.viewer, 'GitHub viewer');
  const viewerLogin = readString(viewer.login, 'GitHub viewer login');
  const reviewNodes = readSearchNodes(data.review, 'review search');
  const authoredNodes = readSearchNodes(data.authored, 'authored search');
  const deduplicated = new Map<string, GitHubPullRequestSummary>();

  for (const node of reviewNodes) {
    const summary = parsePullRequestSummary(node, profileId, viewerLogin, 'review');
    deduplicated.set(summary.id, summary);
  }

  for (const node of authoredNodes) {
    const summary = parsePullRequestSummary(node, profileId, viewerLogin, 'authored');

    if (!deduplicated.has(summary.id)) {
      deduplicated.set(summary.id, summary);
    }
  }

  const categoryIndex = new Map(CATEGORY_ORDER.map((category, index) => [category, index]));
  const pullRequests = [...deduplicated.values()].sort((first, second) => {
    const byCategory =
      (categoryIndex.get(first.category) ?? CATEGORY_ORDER.length) -
      (categoryIndex.get(second.category) ?? CATEGORY_ORDER.length);
    return byCategory || Date.parse(second.updatedAt) - Date.parse(first.updatedAt);
  });

  return {
    profileId,
    viewerLogin,
    host,
    pullRequests,
    suggestions: [],
    loadedAt: new Date().toISOString()
  };
}

export function parseGitHubRecentPushEvents(
  value: unknown,
  viewerLogin: string,
  earliestPushedAt = Date.now() - GITHUB_RECENT_PUSH_MAX_AGE_MS
): GitHubRecentPushCandidate[] {
  if (!Array.isArray(value)) {
    throw new Error('GitHub events must be an array.');
  }

  const candidates = new Map<string, GitHubRecentPushCandidate>();

  for (const eventValue of value) {
    if (!isRecord(eventValue) || eventValue.type !== 'PushEvent') {
      continue;
    }

    const actorLogin = readNestedOptionalString(eventValue, ['actor', 'login']);
    const pushedAt = readOptionalString(eventValue.created_at);
    const repositoryName = readNestedOptionalString(eventValue, ['repo', 'name']);
    const payload = nestedRecord(eventValue, ['payload']);
    const ref = payload ? readOptionalString(payload.ref) : undefined;
    const headSha = payload ? readOptionalString(payload.head) : undefined;
    const pushedAtTime = pushedAt ? Date.parse(pushedAt) : Number.NaN;

    if (
      !actorLogin ||
      actorLogin.toLowerCase() !== viewerLogin.toLowerCase() ||
      !pushedAt ||
      !repositoryName ||
      !ref?.startsWith('refs/heads/') ||
      !headSha ||
      !Number.isFinite(pushedAtTime) ||
      pushedAtTime < earliestPushedAt
    ) {
      continue;
    }

    const { owner, repository } = parseRepositoryNameWithOwner(repositoryName, 'event repository');
    const branch = ref.slice('refs/heads/'.length);
    if (!branch) {
      continue;
    }

    const id = `${owner.toLowerCase()}/${repository.toLowerCase()}:${branch}`;
    const existing = candidates.get(id);
    if (!existing || Date.parse(pushedAt) > Date.parse(existing.pushedAt)) {
      candidates.set(id, { owner, repository, branch, headSha, pushedAt });
    }
  }

  return [...candidates.values()].sort(
    (first, second) => Date.parse(second.pushedAt) - Date.parse(first.pushedAt)
  );
}

export function buildGitHubPullRequestSuggestion(
  candidate: GitHubRecentPushCandidate,
  defaultBranch: string,
  repositoryHtmlUrl: string,
  openPullRequestsValue: unknown,
  comparisonValue: unknown
): GitHubPullRequestSuggestion | undefined {
  if (!Array.isArray(openPullRequestsValue)) {
    throw new Error('GitHub pull requests must be an array.');
  }

  const comparison = readRecord(comparisonValue, 'GitHub branch comparison');
  const aheadBy = readOptionalNumber(comparison.ahead_by) ?? 0;

  if (
    candidate.branch === defaultBranch ||
    openPullRequestsValue.length > 0 ||
    aheadBy <= 0
  ) {
    return undefined;
  }

  const compareUrl = `${repositoryHtmlUrl.replace(/\/$/, '')}/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(candidate.branch)}?quick_pull=1`;

  return {
    id: `${candidate.owner}/${candidate.repository}:${candidate.branch}`,
    owner: candidate.owner,
    repository: candidate.repository,
    branch: candidate.branch,
    defaultBranch,
    headSha: candidate.headSha,
    pushedAt: candidate.pushedAt,
    compareUrl
  };
}

export function parseGitHubPullRequestResponse(
  value: unknown,
  profileId: string
): { pullRequest: GitHubPullRequestSummary; viewerLogin: string } {
  const root = readRecord(value, 'GitHub GraphQL response');
  const data = readRecord(root.data, 'GitHub GraphQL data');
  const viewer = readRecord(data.viewer, 'GitHub viewer');
  const viewerLogin = readString(viewer.login, 'GitHub viewer login');
  const repository = readRecord(data.repository, 'GitHub repository');
  const pullRequest = readRecord(repository.pullRequest, 'pull request');
  const author = readNestedString(pullRequest, ['author', 'login'], 'pull request author');

  return {
    pullRequest: parsePullRequestSummary(
      pullRequest,
      profileId,
      viewerLogin,
      author.toLowerCase() === viewerLogin.toLowerCase() ? 'authored' : 'review'
    ),
    viewerLogin
  };
}

function parsePullRequestSummary(
  value: unknown,
  profileId: string,
  viewerLogin: string,
  source: 'review' | 'authored'
): GitHubPullRequestSummary {
  const pullRequest = readRecord(value, 'pull request');
  const repository = readRecord(pullRequest.repository, 'pull request repository');
  const nameWithOwner = readString(repository.nameWithOwner, 'repository name');
  const { owner, repository: repositoryName } = parseRepositoryNameWithOwner(
    nameWithOwner,
    'repository'
  );
  const headNameWithOwner = readNestedOptionalString(
    pullRequest,
    ['headRepository', 'nameWithOwner']
  );
  const headRepository = headNameWithOwner
    ? parseRepositoryNameWithOwner(headNameWithOwner, 'head repository')
    : undefined;

  const checks = parseChecks(pullRequest);
  const reviewDecision = normalizeReviewDecision(readOptionalString(pullRequest.reviewDecision));
  const mergeState = normalizeMergeState(readOptionalString(pullRequest.mergeStateStatus));
  const mergeable = normalizeMergeable(readOptionalString(pullRequest.mergeable));
  const reviewers = parsePullRequestReviewers(pullRequest);
  const category = categorizePullRequest({
    source,
    viewerLogin,
    isDraft: pullRequest.isDraft === true,
    reviewDecision,
    mergeState,
    mergeable,
    checks,
    reviewers,
    reviewRequests: pullRequest.reviewRequests
  });

  return {
    profileId,
    id: readString(pullRequest.id, 'pull request id'),
    owner,
    repository: repositoryName,
    number: readNumber(pullRequest.number, 'pull request number'),
    title: readString(pullRequest.title, 'pull request title'),
    url: readString(pullRequest.url, 'pull request URL'),
    author: readNestedString(pullRequest, ['author', 'login'], 'pull request author'),
    authorAvatarUrl: readNestedOptionalString(pullRequest, ['author', 'avatarUrl']),
    updatedAt: readString(pullRequest.updatedAt, 'pull request updated time'),
    state: normalizePullRequestState(readOptionalString(pullRequest.state)),
    category,
    isDraft: pullRequest.isDraft === true,
    reviewDecision,
    mergeState,
    mergeable,
    canMerge: pullRequest.viewerCanUpdate === true,
    reviewers,
    comments: readNumber(pullRequest.totalCommentsCount, 'pull request comments'),
    changedFiles: readNumber(pullRequest.changedFiles, 'pull request changed files'),
    additions: readNumber(pullRequest.additions, 'pull request additions'),
    deletions: readNumber(pullRequest.deletions, 'pull request deletions'),
    headRefName: readString(pullRequest.headRefName, 'pull request head branch'),
    headRepositoryOwner: headRepository?.owner,
    headRepository: headRepository?.repository,
    headSha: readString(pullRequest.headRefOid, 'pull request head SHA'),
    baseRefName: readString(pullRequest.baseRefName, 'pull request base branch'),
    checks
  };
}

function parseRepositoryNameWithOwner(
  nameWithOwner: string,
  label: string
): { owner: string; repository: string } {
  const [owner, repository, ...extraParts] = nameWithOwner.split('/');

  if (!owner || !repository || extraParts.length > 0) {
    throw new Error(
      `GitHub returned an invalid ${label} name: ${nameWithOwner}`
    );
  }

  return { owner, repository };
}

export function categorizePullRequest(input: {
  source: 'review' | 'authored';
  viewerLogin: string;
  isDraft: boolean;
  reviewDecision: GitHubPullRequestSummary['reviewDecision'];
  mergeState: GitHubPullRequestSummary['mergeState'];
  mergeable: GitHubPullRequestSummary['mergeable'];
  checks: GitHubPullRequestChecks;
  reviewers: GitHubPullRequestReviewer[];
  reviewRequests: unknown;
}): GitHubPullRequestCategory {
  if (input.source === 'review') {
    return hasDirectReviewRequest(input.reviewRequests, input.viewerLogin)
      ? 'needs-your-review'
      : 'needs-team-review';
  }

  if (input.isDraft) {
    return 'drafts';
  }

  const needsAction =
    input.reviewDecision === 'changes-requested' ||
    input.reviewers.some((reviewer) => reviewer.state === 'changes-requested') ||
    input.checks.state === 'failure' ||
    input.checks.state === 'error';

  if (needsAction) {
    return 'needs-action';
  }

  const readyToMerge =
    input.reviewDecision !== 'review-required' &&
    input.mergeable === 'mergeable' &&
    input.mergeState === 'clean' &&
    (input.checks.total === 0 || input.checks.state === 'success');

  return readyToMerge ? 'ready-to-merge' : 'waiting';
}

function hasDirectReviewRequest(value: unknown, viewerLogin: string): boolean {
  if (!isRecord(value) || !Array.isArray(value.nodes)) {
    return false;
  }

  return value.nodes.some((node) => {
    if (!isRecord(node) || !isRecord(node.requestedReviewer)) {
      return false;
    }

    return (
      node.requestedReviewer.__typename === 'User' &&
      node.requestedReviewer.login === viewerLogin
    );
  });
}

function parseChecks(pullRequest: Record<string, unknown>): GitHubPullRequestChecks {
  const rollup = nestedRecord(pullRequest, ['statusCheckRollup']);

  if (!rollup) {
    return {
      state: 'unknown',
      total: 0,
      passed: 0,
      failed: 0,
      pending: 0
    };
  }

  const contexts = nestedRecord(rollup, ['contexts']);
  const nodes = contexts && Array.isArray(contexts.nodes) ? contexts.nodes : [];
  const total = contexts ? readNumber(contexts.totalCount, 'check count') : nodes.length;
  let passed = 0;
  let failed = 0;

  for (const node of nodes) {
    if (!isRecord(node)) {
      continue;
    }

    if (node.__typename === 'StatusContext') {
      if (node.state === 'SUCCESS') {
        passed += 1;
      } else if (node.state === 'FAILURE' || node.state === 'ERROR') {
        failed += 1;
      }
      continue;
    }

    if (node.__typename === 'CheckRun') {
      if (node.conclusion === 'SUCCESS') {
        passed += 1;
      } else if (
        node.conclusion === 'FAILURE' ||
        node.conclusion === 'TIMED_OUT' ||
        node.conclusion === 'CANCELLED' ||
        node.conclusion === 'ACTION_REQUIRED' ||
        node.conclusion === 'STARTUP_FAILURE'
      ) {
        failed += 1;
      }
    }
  }

  return {
    state: normalizeCheckState(readOptionalString(rollup.state)),
    total,
    passed,
    failed,
    pending: Math.max(0, total - passed - failed)
  };
}

function parsePullRequestFile(value: unknown): GitHubPullRequestFile {
  const file = readRecord(value, 'pull request file');
  const patch = readOptionalString(file.patch);

  return {
    sha: readString(file.sha, 'file SHA'),
    path: readString(file.filename, 'file path'),
    previousPath: readOptionalString(file.previous_filename),
    status: normalizeFileStatus(readString(file.status, 'file status')),
    additions: readNumber(file.additions, 'file additions'),
    deletions: readNumber(file.deletions, 'file deletions'),
    changes: readNumber(file.changes, 'file changes'),
    patch: patch ? buildCompleteFilePatch(file, patch) : undefined,
    omittedReason: patch === undefined ? 'binary' : undefined
  };
}

export function buildCompleteFilePatch(file: Record<string, unknown>, patch: string): string {
  const path = readString(file.filename, 'file path');
  const previousPath = readOptionalString(file.previous_filename) ?? path;
  const status = readString(file.status, 'file status');
  const oldPath = status === 'added' ? '/dev/null' : formatDiffPath(`a/${previousPath}`);
  const newPath = status === 'removed' ? '/dev/null' : formatDiffPath(`b/${path}`);
  const metadata =
    status === 'added'
      ? 'new file mode 100644\n'
      : status === 'removed'
        ? 'deleted file mode 100644\n'
        : '';

  return [
    `diff --git ${formatDiffPath(`a/${previousPath}`)} ${formatDiffPath(`b/${path}`)}`,
    metadata.trimEnd(),
    `--- ${oldPath}`,
    `+++ ${newPath}`,
    patch
  ]
    .filter(Boolean)
    .join('\n');
}

function formatDiffPath(path: string): string {
  return /[\s"\\]/u.test(path) ? JSON.stringify(path) : path;
}

export function parseReviewComment(value: unknown): GitHubPullRequestReviewComment {
  const comment = readRecord(value, 'review comment');
  const line = readOptionalNumber(comment.line) ?? readOptionalNumber(comment.original_line);
  const side = normalizeSide(readOptionalString(comment.side) ?? readOptionalString(comment.original_side));
  const startLine = readOptionalNumber(comment.start_line) ?? readOptionalNumber(comment.original_start_line);

  return {
    id: readNumber(comment.id, 'review comment id'),
    reviewId: readOptionalNumber(comment.pull_request_review_id),
    body: readString(comment.body, 'review comment body'),
    author: readNestedString(comment, ['user', 'login'], 'review comment author'),
    authorAvatarUrl: readNestedOptionalString(comment, ['user', 'avatar_url']),
    url: readString(comment.html_url, 'review comment URL'),
    path: readString(comment.path, 'review comment path'),
    createdAt: readString(comment.created_at, 'review comment created time'),
    updatedAt: readString(comment.updated_at, 'review comment updated time'),
    subjectType: readOptionalString(comment.subject_type)?.toLowerCase() === 'file' ? 'file' : 'line',
    line,
    side,
    startLine,
    startSide: normalizeSide(
      readOptionalString(comment.start_side) ?? readOptionalString(comment.original_start_side)
    ),
    inReplyToId: readOptionalNumber(comment.in_reply_to_id)
  };
}

const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/gu;
const HTML_IMAGE_PATTERN = /<img\b[^>]*>/giu;

export function parseGitHubBodyImageUrls(
  body: string,
  renderedBody: string
): Record<string, string> {
  const sourceUrls = extractBodyImageUrls(body);
  const renderedUrls = [...renderedBody.matchAll(HTML_IMAGE_PATTERN)]
    .map((match) => readHtmlAttribute(match[0], 'src'))
    .filter((url): url is string => Boolean(url));
  const urls: Record<string, string> = {};

  for (const [index, sourceUrl] of sourceUrls.entries()) {
    const renderedUrl = renderedUrls[index];
    if (
      renderedUrl &&
      renderedUrl !== sourceUrl &&
      isGitHubRenderedImageUrl(renderedUrl)
    ) {
      urls[sourceUrl] = renderedUrl;
    }
  }

  return urls;
}

function extractBodyImageUrls(body: string): string[] {
  const images: Array<{ index: number; url: string }> = [];

  for (const match of body.matchAll(HTML_IMAGE_PATTERN)) {
    const url = readHtmlAttribute(match[0], 'src');
    if (url) {
      images.push({ index: match.index, url });
    }
  }

  for (const match of body.matchAll(MARKDOWN_IMAGE_PATTERN)) {
    const url = match[1] ?? match[2];
    if (url) {
      images.push({ index: match.index, url: decodeHtmlAttribute(url) });
    }
  }

  return images
    .sort((left, right) => left.index - right.index)
    .map((image) => image.url);
}

function readHtmlAttribute(tag: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(
    `\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'iu'
  ).exec(tag);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value ? decodeHtmlAttribute(value) : undefined;
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function isGitHubRenderedImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (
      url.hostname === 'private-user-images.githubusercontent.com' ||
      url.hostname === 'user-images.githubusercontent.com' ||
      url.hostname === 'raw.githubusercontent.com' ||
      url.hostname === 'github.com'
    );
  } catch {
    return false;
  }
}

export function parsePullRequestCommit(value: unknown): GitHubPullRequestCommit {
  const pullRequestCommit = readRecord(value, 'pull request commit');
  const commit = readRecord(pullRequestCommit.commit, 'pull request commit detail');
  const commitAuthor = nestedRecord(commit, ['author']);
  const author = nestedRecord(pullRequestCommit, ['author']);

  return {
    sha: readString(pullRequestCommit.sha, 'commit SHA'),
    message: readString(commit.message, 'commit message'),
    author:
      readOptionalString(author?.login) ??
      readOptionalString(commitAuthor?.name) ??
      'Unknown author',
    authorAvatarUrl: readOptionalString(author?.avatar_url),
    committedAt:
      readOptionalString(commitAuthor?.date) ??
      readNestedString(commit, ['committer', 'date'], 'commit date'),
    url: readString(pullRequestCommit.html_url, 'commit URL')
  };
}

function parseConversationComment(value: unknown): GitHubPullRequestConversationComment {
  const comment = readRecord(value, 'conversation comment');
  return {
    id: readNumber(comment.id, 'conversation comment id'),
    body: readString(comment.body, 'conversation comment body'),
    author: readNestedString(comment, ['user', 'login'], 'conversation comment author'),
    authorAvatarUrl: readNestedOptionalString(comment, ['user', 'avatar_url']),
    url: readString(comment.html_url, 'conversation comment URL'),
    createdAt: readString(comment.created_at, 'conversation comment created time'),
    updatedAt: readString(comment.updated_at, 'conversation comment updated time')
  };
}

function parsePullRequestReviewers(
  pullRequest: Record<string, unknown>
): GitHubPullRequestReviewer[] {
  const latestReviews = nestedRecord(pullRequest, ['latestReviews']);
  const latestReviewNodes = latestReviews && Array.isArray(latestReviews.nodes)
    ? latestReviews.nodes
    : [];
  const reviewers = new Map<string, GitHubPullRequestReviewer>();

  for (const value of latestReviewNodes) {
    if (!isRecord(value)) {
      continue;
    }

    const author = nestedRecord(value, ['author']);
    const login = readOptionalString(author?.login);
    const state =
      value.state === 'APPROVED'
        ? 'approved'
        : value.state === 'CHANGES_REQUESTED'
          ? 'changes-requested'
          : undefined;

    if (!login || !state) {
      continue;
    }

    reviewers.set(login, {
      author: login,
      authorAvatarUrl: readOptionalString(author?.avatarUrl),
      state,
      submittedAt: readOptionalString(value.submittedAt)
    });
  }

  const reviewRequests = nestedRecord(pullRequest, ['reviewRequests']);
  const requestNodes = reviewRequests && Array.isArray(reviewRequests.nodes)
    ? reviewRequests.nodes
    : [];

  for (const value of requestNodes) {
    if (!isRecord(value)) {
      continue;
    }

    const requestedReviewer = nestedRecord(value, ['requestedReviewer']);
    if (!requestedReviewer) {
      continue;
    }

    const author =
      requestedReviewer.__typename === 'User'
        ? readOptionalString(requestedReviewer.login)
        : requestedReviewer.__typename === 'Team'
          ? formatRequestedTeam(requestedReviewer)
          : undefined;

    if (!author || reviewers.has(author)) {
      continue;
    }

    reviewers.set(author, {
      author,
      authorAvatarUrl: readOptionalString(requestedReviewer.avatarUrl),
      state: 'pending'
    });
  }

  return [...reviewers.values()];
}

function formatRequestedTeam(team: Record<string, unknown>): string | undefined {
  const slug = readOptionalString(team.slug);
  if (!slug) {
    return undefined;
  }

  const organization = nestedRecord(team, ['organization']);
  const organizationLogin = readOptionalString(organization?.login);
  return organizationLogin ? `${organizationLogin}/${slug}` : slug;
}

function parseReview(value: unknown): GitHubPullRequestReview {
  const review = readRecord(value, 'pull request review');
  return {
    id: readNumber(review.id, 'review id'),
    author: readNestedString(review, ['user', 'login'], 'review author'),
    authorAvatarUrl: readNestedOptionalString(review, ['user', 'avatar_url']),
    body: readOptionalString(review.body) ?? '',
    state: normalizeReviewState(readOptionalString(review.state)),
    submittedAt: readOptionalString(review.submitted_at),
    url: readString(review.html_url, 'review URL')
  };
}

function normalizeReviewDecision(value: string | undefined): GitHubPullRequestSummary['reviewDecision'] {
  if (value === 'APPROVED') {
    return 'approved';
  }
  if (value === 'CHANGES_REQUESTED') {
    return 'changes-requested';
  }
  if (value === 'REVIEW_REQUIRED') {
    return 'review-required';
  }
  return 'unknown';
}

function normalizePullRequestState(
  value: string | undefined
): GitHubPullRequestSummary['state'] {
  const normalized = value?.toLowerCase();

  return normalized === 'open' || normalized === 'closed' || normalized === 'merged'
    ? normalized
    : undefined;
}

function normalizeMergeState(value: string | undefined): GitHubPullRequestSummary['mergeState'] {
  const normalized = value?.toLowerCase();
  return normalized === 'clean' ||
    normalized === 'blocked' ||
    normalized === 'behind' ||
    normalized === 'dirty' ||
    normalized === 'unstable'
    ? normalized
    : 'unknown';
}

function normalizeMergeable(value: string | undefined): GitHubPullRequestSummary['mergeable'] {
  const normalized = value?.toLowerCase();
  return normalized === 'mergeable' || normalized === 'conflicting' ? normalized : 'unknown';
}

function normalizeCheckState(value: string | undefined): GitHubPullRequestChecks['state'] {
  const normalized = value?.toLowerCase();
  return normalized === 'success' ||
    normalized === 'failure' ||
    normalized === 'pending' ||
    normalized === 'expected' ||
    normalized === 'error'
    ? normalized
    : 'unknown';
}

function normalizeFileStatus(value: string): GitHubPullRequestFile['status'] {
  return value === 'added' ||
    value === 'modified' ||
    value === 'removed' ||
    value === 'renamed' ||
    value === 'copied' ||
    value === 'changed' ||
    value === 'unchanged'
    ? value
    : 'changed';
}

function gitHubFileStatusToGitStatus(status: GitHubPullRequestFile['status']): GitStatusCode {
  if (status === 'removed') {
    return 'deleted';
  }
  if (status === 'renamed' || status === 'copied' || status === 'added' || status === 'modified') {
    return status;
  }
  return 'modified';
}

function normalizeSide(value: string | undefined): 'left' | 'right' | undefined {
  if (value === 'LEFT') {
    return 'left';
  }
  if (value === 'RIGHT') {
    return 'right';
  }
  return undefined;
}

function normalizeReviewState(value: string | undefined): GitHubPullRequestReview['state'] {
  if (value === 'APPROVED') {
    return 'approved';
  }
  if (value === 'CHANGES_REQUESTED') {
    return 'changes-requested';
  }
  if (value === 'COMMENTED') {
    return 'commented';
  }
  if (value === 'DISMISSED') {
    return 'dismissed';
  }
  if (value === 'PENDING') {
    return 'pending';
  }
  return 'unknown';
}

async function getGitHubContext(profileId: string): Promise<GitHubContext> {
  const profile = listProfiles().find((candidate) => candidate.id === profileId);

  if (!profile) {
    throw new Error('The selected Git profile no longer exists.');
  }

  if (!profile.ghConfigDir || !profile.githubLogin) {
    throw new Error('Connect a GitHub CLI account to this Git profile before using GitHub features.');
  }

  return {
    executable: await findGhExecutable(),
    profile,
    host: profile.githubHost || 'github.com'
  };
}

async function runGitHubJson(
  context: GitHubContext,
  args: string[],
  inputBody?: Record<string, unknown>
): Promise<unknown> {
  const output = await runGitHubText(context, args, inputBody);

  if (!output) {
    return {};
  }

  try {
    return JSON.parse(output) as unknown;
  } catch {
    throw new Error('GitHub CLI returned an invalid JSON response.');
  }
}

function runGitHubText(
  context: GitHubContext,
  args: string[],
  inputBody?: Record<string, unknown>
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      context.executable,
      args,
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          GH_CONFIG_DIR: context.profile.ghConfigDir
        },
        maxBuffer: GITHUB_API_MAX_BUFFER,
        timeout: GITHUB_API_TIMEOUT_MS,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }

        resolve(stdout.trim());
      }
    );

    if (inputBody) {
      child.stdin?.end(JSON.stringify(inputBody));
    }
  });
}

async function deletePendingReview(
  context: GitHubContext,
  pullRequestPath: string,
  reviewId: number
): Promise<void> {
  try {
    await runGitHubJson(context, [
      'api',
      '--hostname',
      context.host,
      '--method',
      'DELETE',
      `${pullRequestPath}/reviews/${reviewId}`
    ]);
  } catch {
    // Preserve the original submit error; GitHub will expose any pending review for manual cleanup.
  }
}

async function runGitHubPaginatedArray(context: GitHubContext, endpoint: string): Promise<unknown[]> {
  const raw = await runGitHubJson(context, [
    'api',
    '--hostname',
    context.host,
    '--paginate',
    '--slurp',
    endpoint
  ]);

  if (!Array.isArray(raw)) {
    throw new Error('GitHub CLI returned an invalid paginated response.');
  }

  return raw.flatMap((page) => {
    if (!Array.isArray(page)) {
      throw new Error('GitHub CLI returned an invalid page.');
    }
    return page;
  });
}

async function runGitHubLimitedPaginatedArray(
  context: GitHubContext,
  endpoint: string,
  maxPages: number
): Promise<unknown[]> {
  const values: unknown[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const raw = await runGitHubJson(context, [
      'api',
      '--hostname',
      context.host,
      `${endpoint}?per_page=100&page=${page}`
    ]);

    if (!Array.isArray(raw)) {
      throw new Error('GitHub CLI returned an invalid paginated response.');
    }

    values.push(...raw);
    if (raw.length < 100) {
      break;
    }
  }

  return values;
}

function pullRequestEndpoint(locator: GitHubPullRequestLocator): string {
  return `${repositoryEndpoint(locator)}/pulls/${locator.number}`;
}

function repositoryEndpoint(locator: GitHubPullRequestLocator): string {
  return gitHubRepositoryEndpoint(locator.owner, locator.repository);
}

function gitHubRepositoryEndpoint(owner: string, repository: string): string {
  return `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
}

function readSearchNodes(value: unknown, label: string): unknown[] {
  const search = readRecord(value, label);

  if (!Array.isArray(search.nodes)) {
    throw new Error(`${label} nodes must be an array.`);
  }

  return search.nodes;
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`);
  }
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a number.`);
  }
  return value;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readNestedString(
  record: Record<string, unknown>,
  path: Array<string | number>,
  label: string
): string {
  return readString(nestedValue(record, path), label);
}

function readNestedOptionalString(
  record: Record<string, unknown>,
  path: Array<string | number>
): string | undefined {
  return readOptionalString(nestedValue(record, path));
}

function nestedRecord(
  record: Record<string, unknown>,
  path: Array<string | number>
): Record<string, unknown> | undefined {
  const value = nestedValue(record, path);
  return isRecord(value) ? value : undefined;
}

function nestedValue(record: Record<string, unknown>, path: Array<string | number>): unknown {
  let value: unknown = record;

  for (const part of path) {
    if (typeof part === 'number') {
      if (!Array.isArray(value)) {
        return undefined;
      }
      value = value[part];
    } else {
      if (!isRecord(value)) {
        return undefined;
      }
      value = value[part];
    }
  }

  return value;
}
