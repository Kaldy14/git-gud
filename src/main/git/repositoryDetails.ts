import type {
  GitCommitDetail,
  GitCommitInput,
  GitCommitSelectionDetail,
  GitFileChange,
  GitFileChangeDetail,
  GitFileDiff,
  GitFileDiffRequest,
  GitOperationResult,
  GitPatchApplyInput,
  GitQueryInvalidation,
  GitReviewPlan,
  GitReviewTarget,
  GitUndoEntry,
  GitWipDetail,
  RepoTab
} from '@shared/types';

import { readFile, stat } from 'node:fs/promises';
import pathModule from 'node:path';

import { createProfileCommandEnv } from '../profiles';
import { GitCommandError, GitOutputLimitError, gitExecutor } from './exec';
import { createUndoEntryForCommit, getCurrentHead } from './operations';
import { parseNameStatus, parseShortStat } from './parsers/details';
import { loadStatus } from './repositoryOverview';
import { gravatarUrlForEmail } from './gravatar';
import { buildReviewPlan, type ReviewPatchInput } from './reviewPlan';
import { analyzeReviewStructure } from './reviewStructure';
import {
  canAnalyzeReviewSyntaxContext,
  releaseReviewSyntaxDocument,
  treeSitterReviewStructureProvider
} from './reviewSyntax';

type DetailTab = Pick<RepoTab, 'path' | 'assignedProfileId'>;

const MAX_DIFF_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_REVIEW_PLAN_PATCH_BYTES = 24 * 1024 * 1024;
const MAX_REVIEW_PLAN_CONTEXT_BYTES = 32 * 1024 * 1024;
const MAX_COMMIT_SELECTION_SIZE = 100;
const SPARSE_SELECTION_CONCURRENCY = 3;
const WIP_QUERY_INVALIDATIONS: readonly GitQueryInvalidation[] = [
  'overview',
  'wip-detail',
  'file-diff',
  'review-plan'
];

export async function loadCommitDetail(tab: DetailTab, sha: string): Promise<GitCommitDetail> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const [metadata, files, stats] = await Promise.all([
    loadCommitMetadata(tab.path, sha, env),
    loadCommitFiles(tab.path, sha, env),
    loadCommitStats(tab.path, sha, env)
  ]);

  return {
    kind: 'commit',
    repoPath: tab.path,
    sha: metadata.sha,
    shortSha: metadata.sha.slice(0, 8),
    parentShas: metadata.parentShas,
    subject: metadata.subject,
    body: metadata.body,
    message: metadata.message,
    author: metadata.author,
    committer: metadata.committer,
    stats,
    files,
    loadedAt: new Date().toISOString()
  };
}

export async function loadCommitSelectionDetail(
  tab: DetailTab,
  shas: string[]
): Promise<GitCommitSelectionDetail> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const selection = await resolveCommitSelection(tab.path, shas, env);
  let files: GitFileChangeDetail[];
  let stats: GitCommitDetail['stats'];

  if (selection.range) {
    [files, stats] = await Promise.all([
      loadCommitRangeFiles(tab.path, selection.range.baseSha, selection.range.headSha, env),
      loadCommitRangeStats(tab.path, selection.range.baseSha, selection.range.headSha, env)
    ]);
  } else {
    const details = await mapWithConcurrency(
      selection.metadata,
      SPARSE_SELECTION_CONCURRENCY,
      async (metadata) => ({
        files: await loadCommitFiles(tab.path, metadata.sha, env),
        stats: await loadCommitStats(tab.path, metadata.sha, env)
      })
    );
    files = combineSelectionFiles(details.map((detail) => detail.files));
    stats = {
      filesChanged: files.length,
      additions: details.reduce((total, detail) => total + detail.stats.additions, 0),
      deletions: details.reduce((total, detail) => total + detail.stats.deletions, 0)
    };
  }

  return {
    kind: 'selection',
    repoPath: tab.path,
    shas: selection.metadata.map((metadata) => metadata.sha),
    commits: selection.metadata.map((metadata) => ({
      sha: metadata.sha,
      shortSha: metadata.sha.slice(0, 8),
      subject: metadata.subject,
      author: metadata.author,
      committer: metadata.committer
    })),
    isContiguous: Boolean(selection.range),
    stats,
    files,
    loadedAt: new Date().toISOString()
  };
}

export async function loadWipDetail(tab: DetailTab): Promise<GitWipDetail> {
  const status = await loadStatus(tab.path, createProfileCommandEnv(tab.assignedProfileId));

  return {
    kind: 'wip',
    repoPath: tab.path,
    branch: status.branch,
    files: status.files.filter((file) => file.status !== 'ignored').map(wipFileToDetail),
    stagedCount: status.stagedCount,
    unstagedCount: status.unstagedCount,
    untrackedCount: status.untrackedCount,
    conflictedCount: status.conflictedCount,
    dirtyCount: status.dirtyCount,
    loadedAt: new Date().toISOString()
  };
}

export async function loadFileDiff(tab: DetailTab, request: GitFileDiffRequest): Promise<GitFileDiff> {
  const env = createProfileCommandEnv(tab.assignedProfileId);

  if (request.kind === 'commit') {
    return loadCommitFileDiff(tab.path, request, env);
  }

  if (request.kind === 'selection') {
    return loadCommitSelectionFileDiff(tab.path, request, env);
  }

  return loadWipFileDiff(tab.path, request, env);
}

export async function loadReviewPlan(tab: DetailTab, target: GitReviewTarget): Promise<GitReviewPlan> {
  const env = createProfileCommandEnv(tab.assignedProfileId);

  if (target.kind === 'commit') {
    const detail = await loadCommitDetail(tab, target.sha);
    const canonicalTarget: GitReviewTarget = { kind: 'commit', sha: detail.sha };
    const loadedPatches = await mapWithConcurrency(detail.files, 6, async (file): Promise<ReviewPatchInput> => {
      const diff = await loadFileDiff(tab, {
        kind: 'commit',
        sha: detail.sha,
        path: file.path,
        originalPath: file.originalPath
      });
      const fileContext = diff.omittedReason
        ? undefined
        : await loadCommitReviewFileContext(
            tab.path,
            detail.sha,
            detail.parentShas[0],
            file,
            env
          );
      const input: ReviewPatchInput = {
        path: file.path,
        originalPath: file.originalPath,
        status: file.status,
        source: 'commit',
        diff,
        fileContext
      };

      return input;
    });
    const patches = await mapWithConcurrency(
      limitReviewPatchPayload(loadedPatches),
      6,
      (input) => attachReviewSyntax(tab.path, input)
    );

    return buildReviewPlan(tab.path, canonicalTarget, patches);
  }

  const status = await loadStatus(tab.path, env);
  const requests = status.files.flatMap((file) => {
    const sources: Array<{ staged: boolean; source: ReviewPatchInput['source'] }> = [];

    if ((target.scope === 'all' || target.scope === 'staged') && file.staged) {
      sources.push({ staged: true, source: 'staged' });
    }

    if ((target.scope === 'all' || target.scope === 'unstaged') && file.unstaged) {
      sources.push({ staged: false, source: 'unstaged' });
    }

    return sources.map((source) => ({ file, ...source }));
  });
  const loadedPatches = await mapWithConcurrency(
    requests,
    6,
    async ({ file, staged, source }): Promise<ReviewPatchInput> => {
      const diff = await loadFileDiff(tab, { kind: 'wip', path: file.path, staged });
      const fileContext = diff.omittedReason
        ? undefined
        : await loadWipReviewFileContext(tab.path, file, staged, env);
      const input: ReviewPatchInput = {
        path: file.path,
        originalPath: file.originalPath,
        status: staged ? file.indexStatus : file.worktreeStatus,
        source,
        diff,
        fileContext
      };

      return input;
    }
  );
  const patches = await mapWithConcurrency(
    limitReviewPatchPayload(loadedPatches),
    6,
    (input) => attachReviewSyntax(tab.path, input)
  );

  return buildReviewPlan(tab.path, target, patches);
}

async function attachReviewSyntax(repoPath: string, input: ReviewPatchInput): Promise<ReviewPatchInput> {
  if (
    !input.fileContext ||
    input.diff.omittedReason ||
    !canAnalyzeReviewSyntaxContext(input.fileContext)
  ) {
    return input;
  }

  const documentKey = `${repoPath}\0${input.source}\0${input.path}`;

  try {
    const syntax = await analyzeReviewStructure(treeSitterReviewStructureProvider, {
      filePath: input.path,
      patch: input.diff.patch,
      context: input.fileContext,
      documentKey
    });

    return syntax ? { ...input, syntax } : input;
  } finally {
    if (input.source === 'commit') {
      releaseReviewSyntaxDocument(documentKey);
    }
  }
}

export async function applyWipPatch(tab: DetailTab, input: GitPatchApplyInput): Promise<GitOperationResult> {
  const patch = normalizePatch(input.patch);
  const args = ['apply', '--cached', '--recount', '--unidiff-zero', '--whitespace=nowarn'];

  if (input.mode === 'unstage') {
    args.push('--reverse');
  }

  await gitExecutor.run(args, {
    cwd: tab.path,
    kind: 'mutation',
    env: createProfileCommandEnv(tab.assignedProfileId),
    input: patch
  });

  return createOperationResult(tab.path, undefined, WIP_QUERY_INVALIDATIONS);
}

export async function stageFile(tab: DetailTab, path: string): Promise<GitOperationResult> {
  assertSafeRelativePath(path);
  await gitExecutor.run(withLiteralPathspec('add', '--', path), {
    cwd: tab.path,
    kind: 'mutation',
    env: createProfileCommandEnv(tab.assignedProfileId)
  });
  return createOperationResult(tab.path, undefined, WIP_QUERY_INVALIDATIONS);
}

export async function unstageFile(tab: DetailTab, path: string): Promise<GitOperationResult> {
  assertSafeRelativePath(path);
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const status = await loadMutationPathStatus(tab.path, path, env);
  const statusFile = status.files.find((file) => file.path === path);
  const pathspec = createDiffPathspec(path, statusFile?.originalPath);

  if (status.branch.oid) {
    await gitExecutor.run(withLiteralPathspec('restore', '--staged', '--', ...pathspec), {
      cwd: tab.path,
      kind: 'mutation',
      env
    });
    return createOperationResult(tab.path, undefined, WIP_QUERY_INVALIDATIONS);
  }

  await gitExecutor.run(withLiteralPathspec('rm', '--cached', '--quiet', '--', ...pathspec), {
    cwd: tab.path,
    kind: 'mutation',
    env
  });
  return createOperationResult(tab.path, undefined, WIP_QUERY_INVALIDATIONS);
}

export async function discardFile(tab: DetailTab, path: string): Promise<GitOperationResult> {
  assertSafeRelativePath(path);
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const status = await loadMutationPathStatus(tab.path, path, env);
  const statusFile = status.files.find((file) => file.path === path);

  if (!statusFile || statusFile.status === 'ignored') {
    throw new Error('No changed file was found for that path.');
  }

  if (statusFile.conflicted) {
    throw new Error('Discarding conflicted files is not supported. Resolve or abort the in-progress operation first.');
  }

  const headExists = Boolean(status.branch.oid);
  const pathspec = createDiffPathspec(path, statusFile.originalPath);

  if (statusFile.staged) {
    if (headExists) {
      await gitExecutor.run(withLiteralPathspec('restore', '--staged', '--source=HEAD', '--', ...pathspec), {
        cwd: tab.path,
        kind: 'mutation',
        env
      });
    } else {
      await gitExecutor.run(withLiteralPathspec('rm', '--cached', '-r', '--quiet', '--', ...pathspec), {
        cwd: tab.path,
        kind: 'mutation',
        env
      });
    }
  }

  const restorePaths = headExists ? createHeadRestorePathspec(statusFile) : [];

  if (restorePaths.length > 0) {
    await gitExecutor.run(withLiteralPathspec('restore', '--worktree', '--source=HEAD', '--', ...restorePaths), {
      cwd: tab.path,
      kind: 'mutation',
      env
    });
  }

  if (shouldCleanDiscardedPath(statusFile) || !headExists) {
    await gitExecutor.run(withLiteralPathspec('clean', '-f', '-d', '--', path), {
      cwd: tab.path,
      kind: 'mutation',
      env
    });
  }

  return createOperationResult(tab.path);
}

export async function discardAllChanges(tab: DetailTab): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const status = await loadStatus(tab.path, env);

  if (!status.isDirty) {
    throw new Error('The working directory is already clean.');
  }

  if (status.conflictedCount > 0) {
    throw new Error('Discarding all changes is blocked during a conflict. Resolve or abort the in-progress operation first.');
  }

  if (status.branch.oid) {
    await gitExecutor.run(['reset', '--hard', 'HEAD'], { cwd: tab.path, kind: 'mutation', env });
  } else if (status.stagedCount > 0) {
    await gitExecutor.run(['rm', '--cached', '-r', '--quiet', '--', '.'], { cwd: tab.path, kind: 'mutation', env });
  }

  await gitExecutor.run(['clean', '-f', '-d', '--', '.'], { cwd: tab.path, kind: 'mutation', env });
  return createOperationResult(tab.path);
}

export async function stageAll(tab: DetailTab): Promise<GitOperationResult> {
  await gitExecutor.run(['add', '--all'], {
    cwd: tab.path,
    kind: 'mutation',
    env: createProfileCommandEnv(tab.assignedProfileId)
  });
  return createOperationResult(tab.path, undefined, WIP_QUERY_INVALIDATIONS);
}

export async function unstageAll(tab: DetailTab): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);

  if (await hasHead(tab.path)) {
    await gitExecutor.run(['reset', '-q', 'HEAD', '--'], { cwd: tab.path, kind: 'mutation', env });
    return createOperationResult(tab.path, undefined, WIP_QUERY_INVALIDATIONS);
  }

  await gitExecutor.run(['rm', '--cached', '-r', '--quiet', '--', '.'], { cwd: tab.path, kind: 'mutation', env });
  return createOperationResult(tab.path, undefined, WIP_QUERY_INVALIDATIONS);
}

export async function commitChanges(tab: DetailTab, input: GitCommitInput): Promise<GitOperationResult> {
  const message = input.message.trim();

  if (!message) {
    throw new Error('Commit message is required.');
  }

  const env = createProfileCommandEnv(tab.assignedProfileId);
  const headBefore = await getCurrentHead(tab.path, env);
  const args = input.amend ? ['commit', '--amend', '-m', message] : ['commit', '-m', message];
  await gitExecutor.run(args, {
    cwd: tab.path,
    kind: 'mutation',
    env
  });
  const headAfter = await getCurrentHead(tab.path, env);
  const undoEntry = createUndoEntryForCommit(
    tab,
    input.amend ? 'amend' : 'commit',
    input.amend ? 'Undo amend' : 'Undo commit',
    headBefore,
    headAfter
  );

  return createOperationResult(tab.path, undoEntry);
}

type CommitMetadata = Pick<
  GitCommitDetail,
  'sha' | 'parentShas' | 'subject' | 'body' | 'message' | 'author' | 'committer'
>;

type ResolvedCommitSelection = {
  metadata: CommitMetadata[];
  range?: {
    baseSha: string;
    headSha: string;
  };
};

async function resolveCommitSelection(
  repoPath: string,
  shas: string[],
  env: NodeJS.ProcessEnv | undefined
): Promise<ResolvedCommitSelection> {
  assertValidCommitSelection(shas);
  const metadata = await Promise.all(shas.map((sha) => loadCommitMetadata(repoPath, sha, env)));
  const canonicalShas = metadata.map((commit) => commit.sha);

  if (new Set(canonicalShas).size !== canonicalShas.length) {
    throw new Error('Commit selection must not contain duplicates.');
  }

  const newest = metadata[0];
  const oldest = metadata.at(-1);

  if (!newest || !oldest) {
    throw new Error('Select at least two commits.');
  }

  const oldestParentSha = oldest.parentShas[0];
  const revListArgs = ['rev-list', '--first-parent', newest.sha];

  if (oldestParentSha) {
    revListArgs.push(`^${oldestParentSha}`);
  }

  const chainResult = await gitExecutor.run(revListArgs, { cwd: repoPath, env });
  const chainShas = chainResult.stdout.trim().split('\n').filter(Boolean);
  const isContiguous =
    chainShas.length === canonicalShas.length &&
    chainShas.every((sha, index) => sha === canonicalShas[index]);

  if (!isContiguous) {
    return { metadata };
  }

  return {
    metadata,
    range: {
      baseSha: oldestParentSha ?? (await loadEmptyTreeSha(repoPath, env)),
      headSha: newest.sha
    }
  };
}

function assertValidCommitSelection(shas: string[]): void {
  if (shas.length < 2) {
    throw new Error('Select at least two commits.');
  }

  if (shas.length > MAX_COMMIT_SELECTION_SIZE) {
    throw new Error(`Select no more than ${MAX_COMMIT_SELECTION_SIZE} commits at once.`);
  }
}

async function loadEmptyTreeSha(
  repoPath: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<string> {
  const result = await gitExecutor.run(['hash-object', '-t', 'tree', '--stdin'], {
    cwd: repoPath,
    env,
    input: ''
  });
  const sha = result.stdout.trim();

  if (!sha) {
    throw new Error('Git could not resolve the empty tree.');
  }

  return sha;
}

async function loadCommitRangeFiles(
  repoPath: string,
  baseSha: string,
  headSha: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<GitFileChangeDetail[]> {
  const result = await gitExecutor.run(
    ['diff', '--name-status', '-z', '--find-renames', '--find-copies', baseSha, headSha],
    { cwd: repoPath, env }
  );
  return parseNameStatus(result.stdout);
}

async function loadCommitRangeStats(
  repoPath: string,
  baseSha: string,
  headSha: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<GitCommitDetail['stats']> {
  const result = await gitExecutor.run(['diff', '--shortstat', baseSha, headSha], {
    cwd: repoPath,
    env
  });
  return parseShortStat(result.stdout);
}

function combineSelectionFiles(fileGroups: GitFileChangeDetail[][]): GitFileChangeDetail[] {
  const filesByPath = new Map<string, GitFileChangeDetail>();

  for (const files of fileGroups) {
    for (const file of files) {
      const existing = filesByPath.get(file.path);

      if (!existing) {
        filesByPath.set(file.path, file);
        continue;
      }

      if (!existing.originalPath && file.originalPath) {
        filesByPath.set(file.path, {
          ...existing,
          originalPath: file.originalPath,
          status: existing.status === 'deleted' ? existing.status : file.status
        });
      }
    }
  }

  return [...filesByPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

async function loadCommitMetadata(
  repoPath: string,
  sha: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<CommitMetadata> {
  const result = await gitExecutor.run(
    ['show', '-s', '--date=iso-strict', '--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%B', sha],
    { cwd: repoPath, env }
  );
  const tokens = result.stdout.split('\0');
  const fullSha = tokens[0];

  if (!fullSha) {
    throw new Error(`Commit ${sha} was not found.`);
  }

  const message = (tokens[8] ?? '').trimEnd();
  const [subject = '(no subject)', ...bodyLines] = message.split('\n');

  return {
    sha: fullSha,
    parentShas: splitParents(tokens[1] ?? ''),
    subject,
    body: bodyLines.join('\n').trim(),
    message,
    author: {
      name: tokens[2] ?? '',
      email: tokens[3] || undefined,
      date: tokens[4] || undefined,
      avatarUrl: gravatarUrlForEmail(tokens[3], 96)
    },
    committer: {
      name: tokens[5] ?? '',
      email: tokens[6] || undefined,
      date: tokens[7] || undefined,
      avatarUrl: gravatarUrlForEmail(tokens[6], 96)
    }
  };
}

async function loadCommitFiles(
  repoPath: string,
  sha: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<GitFileChangeDetail[]> {
  const result = await gitExecutor.run(
    [
      'show',
      '--format=',
      '--first-parent',
      '--diff-merges=first-parent',
      '--name-status',
      '-z',
      '--find-renames',
      '--find-copies',
      sha
    ],
    { cwd: repoPath, env }
  );

  return parseNameStatus(result.stdout);
}

async function loadCommitStats(
  repoPath: string,
  sha: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<GitCommitDetail['stats']> {
  const result = await gitExecutor.run(
    ['show', '--format=', '--first-parent', '--diff-merges=first-parent', '--shortstat', sha],
    { cwd: repoPath, env }
  );
  return parseShortStat(result.stdout);
}

async function loadCommitFileDiff(
  repoPath: string,
  request: Extract<GitFileDiffRequest, { kind: 'commit' }>,
  env: NodeJS.ProcessEnv | undefined
): Promise<GitFileDiff> {
  assertDiffPathsAreSafe(request.path, request.originalPath);
  const pathspec = createDiffPathspec(request.path, request.originalPath);
  const isBinary = await isCommitFileBinary(repoPath, request.sha, pathspec, env);

  if (isBinary) {
    return createOmittedDiff(repoPath, request.path, request.originalPath, 'commit', 'binary');
  }

  let patch: string;

  try {
    patch = (
      await gitExecutor.run(
        withLiteralPathspec(
          'show',
          '--format=',
          '--first-parent',
          '--diff-merges=first-parent',
          '--patch',
          '--binary',
          '--find-renames',
          '--find-copies',
          request.sha,
          '--',
          ...pathspec
        ),
        { cwd: repoPath, env, maxStdoutBytes: MAX_DIFF_OUTPUT_BYTES }
      )
    ).stdout;
  } catch (error) {
    if (error instanceof GitOutputLimitError) {
      return createOmittedDiff(repoPath, request.path, request.originalPath, 'commit', 'too-large');
    }

    throw error;
  }

  return {
    repoPath,
    path: request.path,
    originalPath: request.originalPath,
    mode: 'commit',
    patch,
    isBinary: false,
    loadedAt: new Date().toISOString()
  };
}

async function loadCommitSelectionFileDiff(
  repoPath: string,
  request: Extract<GitFileDiffRequest, { kind: 'selection' }>,
  env: NodeJS.ProcessEnv | undefined
): Promise<GitFileDiff> {
  assertDiffPathsAreSafe(request.path, request.originalPath);
  const selection = await resolveCommitSelection(repoPath, request.shas, env);

  if (selection.range) {
    return loadCommitRangeFileDiff(repoPath, request, selection.range, env);
  }

  const segments = (
    await mapWithConcurrency(
      selection.metadata.slice().reverse(),
      SPARSE_SELECTION_CONCURRENCY,
      async (metadata) => {
        const files = await loadCommitFiles(repoPath, metadata.sha, env);
        const file = findSelectionFile(files, request.path, request.originalPath);

        if (!file) {
          return undefined;
        }

        const diff = await loadCommitFileDiff(
          repoPath,
          {
            kind: 'commit',
            sha: metadata.sha,
            path: file.path,
            originalPath: file.originalPath
          },
          env
        );

        return {
          sha: metadata.sha,
          shortSha: metadata.sha.slice(0, 8),
          subject: metadata.subject,
          patch: diff.patch,
          isBinary: diff.isBinary,
          omittedReason: diff.omittedReason
        };
      }
    )
  ).filter((segment) => segment !== undefined);

  return {
    repoPath,
    path: request.path,
    originalPath: request.originalPath,
    mode: 'selection',
    patch: '',
    segments,
    isBinary: false,
    loadedAt: new Date().toISOString()
  };
}

async function loadCommitRangeFileDiff(
  repoPath: string,
  request: Extract<GitFileDiffRequest, { kind: 'selection' }>,
  range: NonNullable<ResolvedCommitSelection['range']>,
  env: NodeJS.ProcessEnv | undefined
): Promise<GitFileDiff> {
  const pathspec = createDiffPathspec(request.path, request.originalPath);
  const binaryResult = await gitExecutor.run(
    withLiteralPathspec(
      'diff',
      '--numstat',
      '--find-renames',
      '--find-copies',
      range.baseSha,
      range.headSha,
      '--',
      ...pathspec
    ),
    { cwd: repoPath, env }
  );

  if (isBinaryNumstat(binaryResult.stdout)) {
    return createOmittedDiff(repoPath, request.path, request.originalPath, 'selection', 'binary');
  }

  try {
    const patch = (
      await gitExecutor.run(
        withLiteralPathspec(
          'diff',
          '--binary',
          '--patch',
          '--find-renames',
          '--find-copies',
          range.baseSha,
          range.headSha,
          '--',
          ...pathspec
        ),
        { cwd: repoPath, env, maxStdoutBytes: MAX_DIFF_OUTPUT_BYTES }
      )
    ).stdout;

    return {
      repoPath,
      path: request.path,
      originalPath: request.originalPath,
      mode: 'selection',
      patch,
      isBinary: false,
      loadedAt: new Date().toISOString()
    };
  } catch (error) {
    if (error instanceof GitOutputLimitError) {
      return createOmittedDiff(repoPath, request.path, request.originalPath, 'selection', 'too-large');
    }

    throw error;
  }
}

function findSelectionFile(
  files: GitFileChangeDetail[],
  path: string,
  originalPath: string | undefined
): GitFileChangeDetail | undefined {
  const candidatePaths = new Set([path, originalPath].filter((candidate): candidate is string => Boolean(candidate)));
  return files.find(
    (file) => candidatePaths.has(file.path) || Boolean(file.originalPath && candidatePaths.has(file.originalPath))
  );
}

async function loadWipFileDiff(
  repoPath: string,
  request: Extract<GitFileDiffRequest, { kind: 'wip' }>,
  env: NodeJS.ProcessEnv | undefined
): Promise<GitFileDiff> {
  assertSafeRelativePath(request.path);
  const status = await loadStatus(repoPath, env);
  const statusFile = status.files.find((file) => file.path === request.path);
  const originalPath = statusFile?.originalPath;
  assertDiffPathsAreSafe(request.path, originalPath);
  const mode = request.staged ? 'wip-staged' : 'wip-unstaged';
  const isBinary = request.staged
    ? await isStagedFileBinary(repoPath, request.path, statusFile, env)
    : await isUnstagedFileBinary(repoPath, request.path, statusFile, env);

  if (isBinary) {
    return createOmittedDiff(repoPath, request.path, originalPath, mode, 'binary');
  }

  let patch: string;
  let stageablePatch: string;

  try {
    patch = request.staged
      ? await loadStagedPatch(repoPath, request.path, statusFile, env)
      : await loadUnstagedPatch(repoPath, request.path, statusFile, env);
    stageablePatch = request.staged
      ? await loadStagedPatch(repoPath, request.path, statusFile, env, 0)
      : await loadUnstagedPatch(repoPath, request.path, statusFile, env, 0);
  } catch (error) {
    if (error instanceof GitOutputLimitError) {
      return createOmittedDiff(repoPath, request.path, originalPath, mode, 'too-large');
    }

    throw error;
  }

  return {
    repoPath,
    path: request.path,
    originalPath,
    mode,
    patch,
    stageablePatch,
    isBinary: false,
    loadedAt: new Date().toISOString()
  };
}

async function loadStagedPatch(
  repoPath: string,
  path: string,
  statusFile: GitFileChange | undefined,
  env: NodeJS.ProcessEnv | undefined,
  unifiedContext?: number
): Promise<string> {
  return (
    await gitExecutor.run(
      [
        '--literal-pathspecs',
        'diff',
        '--cached',
        '--binary',
        '--patch',
        ...unifiedContextArgs(unifiedContext),
        '--find-renames',
        '--find-copies',
        '--',
        ...createDiffPathspec(path, statusFile?.originalPath)
      ],
      { cwd: repoPath, env, maxStdoutBytes: MAX_DIFF_OUTPUT_BYTES }
    )
  ).stdout;
}

async function loadUnstagedPatch(
  repoPath: string,
  path: string,
  statusFile: GitFileChange | undefined,
  env: NodeJS.ProcessEnv | undefined,
  unifiedContext?: number
): Promise<string> {
  if (statusFile?.status === 'untracked') {
    return (
      await gitExecutor.run(
        withLiteralPathspec(
          'diff',
          '--no-index',
          '--binary',
          '--patch',
          ...unifiedContextArgs(unifiedContext),
          '--',
          '/dev/null',
          path
        ),
        {
          cwd: repoPath,
          env,
          allowedExitCodes: [1],
          maxStdoutBytes: MAX_DIFF_OUTPUT_BYTES
        }
      )
    ).stdout;
  }

  return (
    await gitExecutor.run(
      [
        '--literal-pathspecs',
        'diff',
        '--binary',
        '--patch',
        ...unifiedContextArgs(unifiedContext),
        '--find-renames',
        '--find-copies',
        '--',
        ...createDiffPathspec(path, statusFile?.originalPath)
      ],
      { cwd: repoPath, env, maxStdoutBytes: MAX_DIFF_OUTPUT_BYTES }
    )
  ).stdout;
}

function unifiedContextArgs(unifiedContext: number | undefined): string[] {
  return typeof unifiedContext === 'number' ? [`--unified=${unifiedContext}`] : [];
}

function normalizePatch(patch: string): string {
  if (!patch || !patch.includes('@@')) {
    throw new Error('A textual patch hunk is required.');
  }

  return patch.endsWith('\n') ? patch : `${patch}\n`;
}

function createDiffPathspec(path: string, originalPath: string | undefined): string[] {
  if (!originalPath || originalPath === path) {
    return [path];
  }

  return [originalPath, path];
}

async function isCommitFileBinary(
  repoPath: string,
  sha: string,
  pathspec: string[],
  env: NodeJS.ProcessEnv | undefined
): Promise<boolean> {
  const result = await gitExecutor.run(
    withLiteralPathspec(
      'show',
      '--format=',
      '--first-parent',
      '--diff-merges=first-parent',
      '--numstat',
      '--find-renames',
      '--find-copies',
      sha,
      '--',
      ...pathspec
    ),
    { cwd: repoPath, env }
  );
  return isBinaryNumstat(result.stdout);
}

async function isStagedFileBinary(
  repoPath: string,
  path: string,
  statusFile: GitFileChange | undefined,
  env: NodeJS.ProcessEnv | undefined
): Promise<boolean> {
  const result = await gitExecutor.run(
    withLiteralPathspec(
      'diff',
      '--cached',
      '--numstat',
      '--find-renames',
      '--find-copies',
      '--',
      ...createDiffPathspec(path, statusFile?.originalPath)
    ),
    { cwd: repoPath, env }
  );
  return isBinaryNumstat(result.stdout);
}

async function isUnstagedFileBinary(
  repoPath: string,
  path: string,
  statusFile: GitFileChange | undefined,
  env: NodeJS.ProcessEnv | undefined
): Promise<boolean> {
  if (statusFile?.status === 'untracked') {
    const result = await gitExecutor.run(withLiteralPathspec('diff', '--no-index', '--numstat', '--', '/dev/null', path), {
      cwd: repoPath,
      env,
      allowedExitCodes: [1]
    });
    return isBinaryNumstat(result.stdout);
  }

  const result = await gitExecutor.run(
    withLiteralPathspec(
      'diff',
      '--numstat',
      '--find-renames',
      '--find-copies',
      '--',
      ...createDiffPathspec(path, statusFile?.originalPath)
    ),
    { cwd: repoPath, env }
  );
  return isBinaryNumstat(result.stdout);
}

function createOmittedDiff(
  repoPath: string,
  path: string,
  originalPath: string | undefined,
  mode: GitFileDiff['mode'],
  omittedReason: NonNullable<GitFileDiff['omittedReason']>
): GitFileDiff {
  return {
    repoPath,
    path,
    originalPath,
    mode,
    patch: '',
    isBinary: omittedReason === 'binary',
    omittedReason,
    loadedAt: new Date().toISOString()
  };
}

function isBinaryNumstat(output: string): boolean {
  return output.split('\n').some((line) => line.startsWith('-\t-\t'));
}

function withLiteralPathspec(...args: string[]): string[] {
  return ['--literal-pathspecs', ...args];
}

function assertDiffPathsAreSafe(path: string, originalPath: string | undefined): void {
  assertSafeRelativePath(path);

  if (originalPath) {
    assertSafeRelativePath(originalPath);
  }
}

function createHeadRestorePathspec(file: GitFileChange): string[] {
  if (file.indexStatus === 'added' || file.indexStatus === 'copied' || file.status === 'untracked') {
    return [];
  }

  if (file.indexStatus === 'renamed' && file.originalPath) {
    return [file.originalPath];
  }

  return [file.path];
}

function shouldCleanDiscardedPath(file: GitFileChange): boolean {
  return file.status === 'untracked' || file.indexStatus === 'added' || file.indexStatus === 'copied' || file.indexStatus === 'renamed';
}

function wipFileToDetail(file: GitFileChange): GitFileChangeDetail {
  return {
    path: file.path,
    originalPath: file.originalPath,
    status: file.status,
    staged: file.staged,
    unstaged: file.unstaged,
    conflicted: file.conflicted
  };
}

function assertSafeRelativePath(path: string): void {
  const normalizedPath = pathModule.normalize(path);

  if (!path || pathModule.isAbsolute(path) || normalizedPath === '..' || normalizedPath.startsWith(`..${pathModule.sep}`)) {
    throw new Error('A repository-relative file path is required.');
  }
}

function splitParents(value: string): string[] {
  return value.split(' ').filter((parent) => parent.length > 0);
}

async function hasHead(repoPath: string): Promise<boolean> {
  try {
    await gitExecutor.run(['rev-parse', '--verify', 'HEAD'], { cwd: repoPath });
    return true;
  } catch (error) {
    if (error instanceof GitCommandError) {
      return false;
    }

    throw error;
  }
}

async function loadMutationPathStatus(
  repoPath: string,
  path: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<Awaited<ReturnType<typeof loadStatus>>> {
  const scopedStatus = await loadStatus(repoPath, env, [path]);
  const scopedFile = scopedStatus.files.find((file) => file.path === path);

  if (
    !scopedFile?.staged ||
    (scopedFile.indexStatus !== 'added' && scopedFile.indexStatus !== 'deleted')
  ) {
    return scopedStatus;
  }

  const fullStatus = await loadStatus(repoPath, env);
  return fullStatus.files.some(
    (file) => file.path === path && file.originalPath
  )
    ? fullStatus
    : scopedStatus;
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

async function loadCommitReviewFileContext(
  repoPath: string,
  sha: string,
  parentSha: string | undefined,
  file: GitFileChangeDetail,
  env: NodeJS.ProcessEnv | undefined
): Promise<ReviewPatchInput['fileContext']> {
  const oldContents = file.status === 'added'
    ? ''
    : parentSha
      ? await loadGitObjectText(repoPath, `${parentSha}:${file.originalPath ?? file.path}`, env)
      : '';
  const newContents = file.status === 'deleted'
    ? ''
    : await loadGitObjectText(repoPath, `${sha}:${file.path}`, env);

  if (oldContents === undefined || newContents === undefined) {
    return undefined;
  }

  return { oldContents, newContents };
}

async function loadWipReviewFileContext(
  repoPath: string,
  file: GitFileChange,
  staged: boolean,
  env: NodeJS.ProcessEnv | undefined
): Promise<ReviewPatchInput['fileContext']> {
  const status = staged ? file.indexStatus : file.worktreeStatus;
  const oldContents = status === 'added' || status === 'untracked'
    ? ''
    : staged
      ? await loadGitObjectText(repoPath, `HEAD:${file.originalPath ?? file.path}`, env)
      : await loadGitObjectText(repoPath, `:${file.path}`, env);
  const newContents = status === 'deleted'
    ? ''
    : staged
      ? await loadGitObjectText(repoPath, `:${file.path}`, env)
      : await loadWorktreeText(repoPath, file.path);

  if (oldContents === undefined || newContents === undefined) {
    return undefined;
  }

  return { oldContents, newContents };
}

async function loadGitObjectText(
  repoPath: string,
  object: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<string | undefined> {
  try {
    return (
      await gitExecutor.run(['show', object], {
        cwd: repoPath,
        env,
        maxStdoutBytes: MAX_DIFF_OUTPUT_BYTES
      })
    ).stdout;
  } catch (error) {
    if (error instanceof GitCommandError || error instanceof GitOutputLimitError) {
      return undefined;
    }

    throw error;
  }
}

async function loadWorktreeText(repoPath: string, relativePath: string): Promise<string | undefined> {
  try {
    const filePath = pathModule.join(repoPath, relativePath);
    const fileStats = await stat(filePath);

    if (fileStats.size > MAX_DIFF_OUTPUT_BYTES) {
      return undefined;
    }

    const contents = await readFile(filePath, 'utf8');
    return Buffer.byteLength(contents) <= MAX_DIFF_OUTPUT_BYTES ? contents : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

function limitReviewPatchPayload(patches: ReviewPatchInput[]): ReviewPatchInput[] {
  let loadedPatchBytes = 0;
  let loadedContextBytes = 0;

  return patches.map((patch) => {
    const patchBytes = Buffer.byteLength(patch.diff.patch);
    let limitedPatch = patch;

    if (loadedPatchBytes + patchBytes <= MAX_REVIEW_PLAN_PATCH_BYTES) {
      loadedPatchBytes += patchBytes;
    } else {
      limitedPatch = {
        ...patch,
        fileContext: undefined,
        diff: {
          ...patch.diff,
          patch: '',
          stageablePatch: undefined,
          isBinary: false,
          omittedReason: 'too-large'
        }
      };
    }

    if (!limitedPatch.fileContext) {
      return limitedPatch;
    }

    const contextBytes = Buffer.byteLength(limitedPatch.fileContext.oldContents) +
      Buffer.byteLength(limitedPatch.fileContext.newContents);

    if (loadedContextBytes + contextBytes > MAX_REVIEW_PLAN_CONTEXT_BYTES) {
      return { ...limitedPatch, fileContext: undefined };
    }

    loadedContextBytes += contextBytes;
    return limitedPatch;
  });
}

function createOperationResult(
  repoPath: string,
  undoEntry?: GitUndoEntry,
  invalidates: readonly GitQueryInvalidation[] = [
    'overview',
    'graph',
    'wip-detail',
    'file-diff',
    'review-plan'
  ]
): GitOperationResult {
  return {
    repoPath,
    happenedAt: new Date().toISOString(),
    undoEntry,
    invalidates: [...invalidates]
  };
}
