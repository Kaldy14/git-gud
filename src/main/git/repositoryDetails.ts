import type {
  GitCommitDetail,
  GitCommitInput,
  GitFileChange,
  GitFileChangeDetail,
  GitFileDiff,
  GitFileDiffRequest,
  GitOperationResult,
  GitPatchApplyInput,
  GitUndoEntry,
  GitWipDetail,
  RepoTab
} from '@shared/types';

import pathModule from 'node:path';

import { createProfileCommandEnv } from '../profiles';
import { GitCommandError, GitOutputLimitError, gitExecutor } from './exec';
import { createUndoEntryForCommit, getCurrentHead } from './operations';
import { parseNameStatus, parseShortStat } from './parsers/details';
import { loadStatus } from './repositoryOverview';
import { gravatarUrlForEmail } from './gravatar';

type DetailTab = Pick<RepoTab, 'path' | 'assignedProfileId'>;

const MAX_DIFF_OUTPUT_BYTES = 8 * 1024 * 1024;

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

  return loadWipFileDiff(tab.path, request, env);
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

  return createOperationResult(tab.path);
}

export async function stageFile(tab: DetailTab, path: string): Promise<GitOperationResult> {
  assertSafeRelativePath(path);
  await gitExecutor.run(withLiteralPathspec('add', '--', path), {
    cwd: tab.path,
    kind: 'mutation',
    env: createProfileCommandEnv(tab.assignedProfileId)
  });
  return createOperationResult(tab.path);
}

export async function unstageFile(tab: DetailTab, path: string): Promise<GitOperationResult> {
  assertSafeRelativePath(path);
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const status = await loadStatus(tab.path, env);
  const statusFile = status.files.find((file) => file.path === path);
  const pathspec = createDiffPathspec(path, statusFile?.originalPath);

  if (await hasHead(tab.path)) {
    await gitExecutor.run(withLiteralPathspec('restore', '--staged', '--', ...pathspec), {
      cwd: tab.path,
      kind: 'mutation',
      env
    });
    return createOperationResult(tab.path);
  }

  await gitExecutor.run(withLiteralPathspec('rm', '--cached', '--quiet', '--', ...pathspec), {
    cwd: tab.path,
    kind: 'mutation',
    env
  });
  return createOperationResult(tab.path);
}

export async function discardFile(tab: DetailTab, path: string): Promise<GitOperationResult> {
  assertSafeRelativePath(path);
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const status = await loadStatus(tab.path, env);
  const statusFile = status.files.find((file) => file.path === path);

  if (!statusFile || statusFile.status === 'ignored') {
    throw new Error('No changed file was found for that path.');
  }

  if (statusFile.conflicted) {
    throw new Error('Discarding conflicted files is not supported. Resolve or abort the in-progress operation first.');
  }

  const headExists = await hasHead(tab.path);
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

  if (await hasHead(tab.path)) {
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
  return createOperationResult(tab.path);
}

export async function unstageAll(tab: DetailTab): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);

  if (await hasHead(tab.path)) {
    await gitExecutor.run(['reset', '-q', 'HEAD', '--'], { cwd: tab.path, kind: 'mutation', env });
    return createOperationResult(tab.path);
  }

  await gitExecutor.run(['rm', '--cached', '-r', '--quiet', '--', '.'], { cwd: tab.path, kind: 'mutation', env });
  return createOperationResult(tab.path);
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

function createOperationResult(repoPath: string, undoEntry?: GitUndoEntry): GitOperationResult {
  return {
    repoPath,
    happenedAt: new Date().toISOString(),
    undoEntry,
    invalidates: ['overview', 'graph', 'wip-detail', 'file-diff']
  };
}
