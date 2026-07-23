import { execFile } from 'node:child_process';

import type {
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
  GitHubPullRequestReviewInput,
  GitHubPullRequestSummary,
  GitHubRepositoryMergeSettings,
  GitProfile,
  GitReviewPlan,
  GitStatusCode
} from '@shared/types';

import { findGhExecutable, listProfiles } from './profiles';
import { buildReviewPlan, type ReviewPatchInput } from './git/reviewPlan';

type GitHubContext = {
  executable: string;
  profile: GitProfile;
  host: string;
};

const GITHUB_API_TIMEOUT_MS = 30_000;
const GITHUB_API_MAX_BUFFER = 32 * 1024 * 1024;

const INBOX_QUERY = `
query GitGudPullRequestInbox($reviewQuery: String!, $authoredQuery: String!) {
  viewer { login }
  review: search(type: ISSUE, query: $reviewQuery, first: 50) {
    nodes {
      ... on PullRequest {
        id number title url updatedAt isDraft state reviewDecision mergeStateStatus mergeable
        viewerCanUpdate viewerCanClose changedFiles additions deletions headRefName baseRefName
        author { login avatarUrl }
        repository { nameWithOwner }
        comments { totalCount }
        reviewRequests(first: 20) {
          nodes {
            requestedReviewer {
              __typename
              ... on User { login }
              ... on Team { slug name organization { login } }
            }
          }
        }
        commits(last: 1) {
          nodes {
            commit {
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
      }
    }
  }
  authored: search(type: ISSUE, query: $authoredQuery, first: 50) {
    nodes {
      ... on PullRequest {
        id number title url updatedAt isDraft state reviewDecision mergeStateStatus mergeable
        viewerCanUpdate viewerCanClose changedFiles additions deletions headRefName baseRefName
        author { login avatarUrl }
        repository { nameWithOwner }
        comments { totalCount }
        reviewRequests(first: 20) {
          nodes {
            requestedReviewer {
              __typename
              ... on User { login }
              ... on Team { slug name organization { login } }
            }
          }
        }
        commits(last: 1) {
          nodes {
            commit {
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

  return {
    ...summary,
    body: readOptionalString(pull.body) ?? '',
    headSha,
    baseSha: readNestedString(pull, ['base', 'sha'], 'pull request base SHA'),
    commits: readNumber(pull.commits, 'pull request commits'),
    files,
    reviewPlan: buildGitHubPullRequestReviewPlan(context.host, summary, headSha, files),
    mergeSettings: parseGitHubRepositoryMergeSettings(repositoryRaw),
    viewerLogin: inbox.viewerLogin,
    reviewComments: reviewCommentsRaw.map(parseReviewComment),
    conversationComments: conversationCommentsRaw.map(parseConversationComment),
    reviews: reviewsRaw.map(parseReview),
    loadedAt: new Date().toISOString()
  };
}

export function buildGitHubPullRequestReviewPlan(
  host: string,
  pullRequest: GitHubPullRequestSummary,
  headSha: string,
  files: GitHubPullRequestFile[]
): GitReviewPlan {
  const repoPath = `github://${host}/${pullRequest.owner}/${pullRequest.repository}`;
  const target = {
    kind: 'branch' as const,
    name: pullRequest.headRefName,
    sha: headSha
  };
  const patches: ReviewPatchInput[] = files.map((file) => ({
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
    }
  }));
  const plan = buildReviewPlan(repoPath, target, patches);

  return {
    ...plan,
    targetKey: `github-pr:${pullRequest.profileId}:${pullRequest.owner}/${pullRequest.repository}#${pullRequest.number}:${headSha}`
  };
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
  let submittedReplies = 0;
  let firstReplyError: Error | undefined;

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
      firstReplyError ??= error instanceof Error ? error : new Error('Could not submit a review reply.');
    }
  }

  if (!reviewSubmitted && submittedReplies === 0 && firstReplyError) {
    throw firstReplyError;
  }

  const submittedDraftCount = input.comments.length + submittedReplies;
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
      ? ` ${failedDraftIds.length} draft ${failedDraftIds.length === 1 ? 'reply was' : 'replies were'} not sent and ${failedDraftIds.length === 1 ? 'remains' : 'remain'} in Git Gud.`
      : '.';

  return {
    message: `${actionMessage}${failureMessage}`,
    submitted: reviewSubmitted || submittedReplies > 0,
    failedDraftIds
  };
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
  const [owner, repositoryName, ...extraParts] = nameWithOwner.split('/');

  if (!owner || !repositoryName || extraParts.length > 0) {
    throw new Error(`GitHub returned an invalid repository name: ${nameWithOwner}`);
  }

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
    comments: readNestedNumber(pullRequest, ['comments', 'totalCount'], 'pull request comments'),
    changedFiles: readNumber(pullRequest.changedFiles, 'pull request changed files'),
    additions: readNumber(pullRequest.additions, 'pull request additions'),
    deletions: readNumber(pullRequest.deletions, 'pull request deletions'),
    headRefName: readString(pullRequest.headRefName, 'pull request head branch'),
    baseRefName: readString(pullRequest.baseRefName, 'pull request base branch'),
    checks
  };
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
    input.mergeable === 'conflicting' ||
    input.mergeState === 'dirty' ||
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
  const rollup = nestedRecord(pullRequest, ['commits', 'nodes', 0, 'commit', 'statusCheckRollup']);

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

function parseReviewComment(value: unknown): GitHubPullRequestReviewComment {
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

function runGitHubJson(
  context: GitHubContext,
  args: string[],
  inputBody?: Record<string, unknown>
): Promise<unknown> {
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

        const output = stdout.trim();

        if (!output) {
          resolve({});
          return;
        }

        try {
          resolve(JSON.parse(output) as unknown);
        } catch {
          reject(new Error('GitHub CLI returned an invalid JSON response.'));
        }
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

function readNestedNumber(
  record: Record<string, unknown>,
  path: Array<string | number>,
  label: string
): number {
  return readNumber(nestedValue(record, path), label);
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
