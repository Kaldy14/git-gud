import { execFile } from 'node:child_process';

import type {
  GitHubActionsRuns,
  GitHubActionsRunFilters,
  GitHubActionsRunsInput,
  GitHubPullRequestActionResult,
  GitHubPullRequestCategory,
  GitHubPullRequestChecks,
  GitHubPullRequestConversationComment,
  GitHubPullRequestDetail,
  GitHubPullRequestFile,
  GitHubPullRequestInbox,
  GitHubPullRequestLocator,
  GitHubPullRequestMergeInput,
  GitHubPullRequestReview,
  GitHubPullRequestReviewComment,
  GitHubPullRequestReviewCommentUpdateInput,
  GitHubPullRequestReviewInput,
  GitHubPullRequestSummary,
  GitHubRepositorySummary,
  GitHubRepositoryMergeSettings,
  GitHubWorkflowRun,
  GitHubWorkflowRunConclusion,
  GitHubWorkflowRunStatus,
  GitProfile,
  GitReviewFileContext,
  GitReviewPlan,
  GitStatusCode
} from '@shared/types';

import { findGhExecutable, listProfiles } from './profiles';
import { buildReviewPlan, type ReviewPatchInput } from './git/reviewPlan';
import { githubPullRequestReviewPlans } from './githubReviewPlans';

type GitHubContext = {
  executable: string;
  profile: GitProfile;
  host: string;
};

const GITHUB_API_TIMEOUT_MS = 30_000;
const GITHUB_API_MAX_BUFFER = 32 * 1024 * 1024;
const GITHUB_REVIEW_CONTEXT_MAX_BYTES = 32 * 1024 * 1024;
const GITHUB_REVIEW_CONTEXT_CONCURRENCY = 6;
const GITHUB_REVIEW_CONTEXT_MAX_FILES = 24;
const GITHUB_ACTIONS_FILTERED_PAGE_SIZE = 100;
const GITHUB_ACTIONS_FILTERED_RUN_CAP = 500;
const GITHUB_ACTIONS_PR_AUTHOR_BATCH_SIZE = 100;
const GITHUB_ACTIONS_METADATA_CACHE_TTL_MS = 10 * 60_000;
const GITHUB_ACTIONS_TAG_PAGE_CAP = 5;

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

type GitHubReviewFileContext = Pick<
  GitReviewFileContext,
  'path' | 'originalPath' | 'oldContents' | 'newContents'
>;

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
        reviewRequests(first: 20) {
          nodes {
            requestedReviewer {
              __typename
              ... on User { login }
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
        reviewRequests(first: 20) {
          nodes {
            requestedReviewer {
              __typename
              ... on User { login }
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
  const raw = await runGitHubJson(context, [
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
  ]);

  return parseGitHubInboxResponse(raw, profileId, context.host);
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

export function parseGitHubActionsRunsResponse(
  raw: unknown,
  input: GitHubActionsRunsInput
): GitHubActionsRuns {
  const runs = parseGitHubWorkflowRuns(raw).slice(0, input.limit);
  return buildGitHubActionsRuns(
    input,
    runs,
    runs.length,
    false
  );
}

function parseGitHubWorkflowRuns(raw: unknown): GitHubWorkflowRun[] {
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
  searchLimitReached: boolean
): GitHubActionsRuns {
  return {
    profileId: input.profileId,
    owner: input.owner,
    repository: input.repository,
    runs,
    searchedRunCount,
    searchLimitReached,
    loadedAt: new Date().toISOString()
  };
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

  return {
    id: readNumber(run.id, 'workflow run id'),
    name,
    displayTitle: readOptionalString(run.display_title) ?? name,
    runNumber: readNumber(run.run_number, 'workflow run number'),
    event: readOptionalString(run.event) ?? 'workflow_dispatch',
    branch: readOptionalString(run.head_branch),
    sha: readString(run.head_sha, 'workflow run SHA'),
    status: normalizeWorkflowRunStatus(readOptionalString(run.status)),
    conclusion: normalizeWorkflowRunConclusion(readOptionalString(run.conclusion)),
    url: readString(run.html_url, 'workflow run URL'),
    actor: readNestedOptionalString(run, ['actor', 'login']),
    pullRequestNumbers: parseWorkflowRunPullRequestNumbers(run.pull_requests),
    createdAt: readString(run.created_at, 'workflow run created time'),
    updatedAt: readString(run.updated_at, 'workflow run updated time')
  };
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
    inbox,
    pullRaw,
    repositoryRaw,
    filesRaw,
    reviewCommentsRaw,
    conversationCommentsRaw,
    reviewsRaw
  ] = await Promise.all([
    loadGitHubPullRequestInbox(locator.profileId),
    runGitHubJson(context, ['api', '--hostname', context.host, endpoint]),
    runGitHubJson(context, ['api', '--hostname', context.host, repositoryEndpoint(locator)]),
    runGitHubPaginatedArray(context, `${endpoint}/files?per_page=100`),
    runGitHubPaginatedArray(context, `${endpoint}/comments?per_page=100`),
    runGitHubPaginatedArray(
      context,
      `repos/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.repository)}/issues/${locator.number}/comments?per_page=100`
    ),
    runGitHubPaginatedArray(context, `${endpoint}/reviews?per_page=100`)
  ]);
  const summary = inbox.pullRequests.find((pullRequest) => samePullRequest(pullRequest, locator));

  if (!summary) {
    throw new Error('This pull request is no longer in the selected account inbox. Refresh the inbox and try again.');
  }

  const pull = readRecord(pullRaw, 'pull request');
  const files = filesRaw.map(parsePullRequestFile);
  const headSha = readNestedString(pull, ['head', 'sha'], 'pull request head SHA');
  const baseSha = readNestedString(pull, ['base', 'sha'], 'pull request base SHA');
  const mergeBaseSha = await loadGitHubMergeBaseSha(context, locator, baseSha, headSha);
  const patchOnlyReviewPlan = buildGitHubPullRequestReviewPlan(context.host, summary, headSha, files);
  const fileContexts = mergeBaseSha
    ? await loadGitHubPullRequestFileContexts(
        context,
        locator,
        mergeBaseSha,
        headSha,
        selectGitHubReviewContextFiles(patchOnlyReviewPlan, files)
      )
    : [];
  const reviewPlan = buildGitHubPullRequestReviewPlan(
    context.host,
    summary,
    headSha,
    files,
    fileContexts
  );
  githubPullRequestReviewPlans.remember(locator, reviewPlan);

  return {
    ...summary,
    body: readOptionalString(pull.body) ?? '',
    headSha,
    baseSha,
    commits: readNumber(pull.commits, 'pull request commits'),
    files,
    reviewPlan,
    mergeSettings: parseGitHubRepositoryMergeSettings(repositoryRaw),
    viewerLogin: inbox.viewerLogin,
    reviewComments: reviewCommentsRaw.map(parseReviewComment),
    conversationComments: conversationCommentsRaw.map(parseConversationComment),
    reviews: reviewsRaw.map(parseReview),
    loadedAt: new Date().toISOString()
  };
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

    if (!file || file.omittedReason || !file.patch || file.status === 'added' || file.status === 'removed') {
      continue;
    }

    selectedPaths.add(chunk.path);
    selectedFiles.push(file);
  }

  return selectedFiles;
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

export function buildGitHubPullRequestReviewPlan(
  host: string,
  pullRequest: GitHubPullRequestSummary,
  headSha: string,
  files: GitHubPullRequestFile[],
  fileContexts: GitHubReviewFileContext[] = []
): GitReviewPlan {
  const repoPath = `github://${host}/${pullRequest.owner}/${pullRequest.repository}`;
  const target = {
    kind: 'branch' as const,
    name: pullRequest.headRefName,
    sha: headSha
  };
  const contextByPath = new Map(fileContexts.map((context) => [context.path, context]));
  const patches: ReviewPatchInput[] = files.map((file) => {
    const fileContext = contextByPath.get(file.path);

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
  });
  const plan = buildReviewPlan(repoPath, target, patches);

  return {
    ...plan,
    targetKey: `github-pr:${pullRequest.profileId}:${pullRequest.owner}/${pullRequest.repository}#${pullRequest.number}:${headSha}`
  };
}

async function loadGitHubPullRequestFileContexts(
  context: GitHubContext,
  locator: GitHubPullRequestLocator,
  baseSha: string,
  headSha: string,
  files: GitHubPullRequestFile[]
): Promise<GitHubReviewFileContext[]> {
  const fileContexts: GitHubReviewFileContext[] = [];
  let loadedBytes = 0;

  for (let index = 0; index < files.length; index += GITHUB_REVIEW_CONTEXT_CONCURRENCY) {
    const batch = files.slice(index, index + GITHUB_REVIEW_CONTEXT_CONCURRENCY);
    const loadedBatch = await Promise.all(
      batch.map((file) => loadGitHubPullRequestFileContext(context, locator, baseSha, headSha, file))
    );

    for (const fileContext of loadedBatch) {
      if (!fileContext) {
        continue;
      }

      const contextBytes = Buffer.byteLength(fileContext.oldContents) +
        Buffer.byteLength(fileContext.newContents);

      if (loadedBytes + contextBytes > GITHUB_REVIEW_CONTEXT_MAX_BYTES) {
        continue;
      }

      loadedBytes += contextBytes;
      fileContexts.push(fileContext);
    }

    if (loadedBytes >= GITHUB_REVIEW_CONTEXT_MAX_BYTES) {
      break;
    }
  }

  return fileContexts;
}

async function loadGitHubPullRequestFileContext(
  context: GitHubContext,
  locator: GitHubPullRequestLocator,
  baseSha: string,
  headSha: string,
  file: GitHubPullRequestFile
): Promise<GitHubReviewFileContext | undefined> {
  if (file.omittedReason || !file.patch || file.status === 'added' || file.status === 'removed') {
    return undefined;
  }

  const [oldContents, newContents] = await Promise.all([
    loadGitHubFileText(context, locator, file.previousPath ?? file.path, baseSha),
    loadGitHubFileText(context, locator, file.path, headSha)
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
    loadedAt: new Date().toISOString()
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
  const category = categorizePullRequest({
    source,
    viewerLogin,
    isDraft: pullRequest.isDraft === true,
    reviewDecision,
    mergeState,
    mergeable,
    checks,
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
    category,
    isDraft: pullRequest.isDraft === true,
    reviewDecision,
    mergeState,
    mergeable,
    canMerge: pullRequest.viewerCanUpdate === true,
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
    input.checks.state === 'failure' ||
    input.checks.state === 'error';

  if (needsAction) {
    return 'needs-action';
  }

  const readyToMerge =
    input.reviewDecision === 'approved' &&
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
    throw new Error('Connect a GitHub CLI account to this Git profile before opening the pull request inbox.');
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
  return `repos/${encodeURIComponent(locator.owner)}/${encodeURIComponent(locator.repository)}`;
}

function samePullRequest(
  pullRequest: GitHubPullRequestLocator,
  locator: GitHubPullRequestLocator
): boolean {
  return (
    pullRequest.profileId === locator.profileId &&
    pullRequest.owner === locator.owner &&
    pullRequest.repository === locator.repository &&
    pullRequest.number === locator.number
  );
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
