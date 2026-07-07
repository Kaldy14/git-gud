import type {
  GitCommitDetail,
  GitCommitInput,
  GitFileChange,
  GitFileChangeDetail,
  GitFileDiff,
  GitFileDiffRequest,
  GitOperationResult,
  GitUndoEntry,
  GitWipDetail,
  RepoTab
} from '@shared/types';

import { createProfileCommandEnv } from '../profiles';
import { GitCommandError, gitExecutor } from './exec';
import { createUndoEntryForCommit, getCurrentHead } from './operations';
import { parseNameStatus, parseShortStat } from './parsers/details';
import { loadStatus } from './repositoryOverview';

type DetailTab = Pick<RepoTab, 'path' | 'assignedProfileId'>;

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

export async function stageFile(tab: DetailTab, path: string): Promise<GitOperationResult> {
  await gitExecutor.run(['add', '--', path], {
    cwd: tab.path,
    kind: 'mutation',
    env: createProfileCommandEnv(tab.assignedProfileId)
  });
  return createOperationResult(tab.path);
}

export async function unstageFile(tab: DetailTab, path: string): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const status = await loadStatus(tab.path, env);
  const statusFile = status.files.find((file) => file.path === path);
  const pathspec = createDiffPathspec(path, statusFile?.originalPath);

  if (await hasHead(tab.path)) {
    await gitExecutor.run(['restore', '--staged', '--', ...pathspec], { cwd: tab.path, kind: 'mutation', env });
    return createOperationResult(tab.path);
  }

  await gitExecutor.run(['rm', '--cached', '--quiet', '--', ...pathspec], { cwd: tab.path, kind: 'mutation', env });
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
      date: tokens[4] || undefined
    },
    committer: {
      name: tokens[5] ?? '',
      email: tokens[6] || undefined,
      date: tokens[7] || undefined
    }
  };
}

async function loadCommitFiles(
  repoPath: string,
  sha: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<GitFileChangeDetail[]> {
  const result = await gitExecutor.run(
    ['show', '--format=', '--name-status', '-z', '--find-renames', '--find-copies', sha],
    { cwd: repoPath, env }
  );

  return parseNameStatus(result.stdout);
}

async function loadCommitStats(
  repoPath: string,
  sha: string,
  env: NodeJS.ProcessEnv | undefined
): Promise<GitCommitDetail['stats']> {
  const result = await gitExecutor.run(['show', '--format=', '--shortstat', sha], { cwd: repoPath, env });
  return parseShortStat(result.stdout);
}

async function loadCommitFileDiff(
  repoPath: string,
  request: Extract<GitFileDiffRequest, { kind: 'commit' }>,
  env: NodeJS.ProcessEnv | undefined
): Promise<GitFileDiff> {
  const args = [
    'show',
    '--format=',
    '--patch',
    '--binary',
    '--find-renames',
    '--find-copies',
    request.sha,
    '--',
    ...createDiffPathspec(request.path, request.originalPath)
  ];
  const patch = (await gitExecutor.run(args, { cwd: repoPath, env })).stdout;

  return {
    repoPath,
    path: request.path,
    originalPath: request.originalPath,
    mode: 'commit',
    patch,
    isBinary: isBinaryPatch(patch),
    loadedAt: new Date().toISOString()
  };
}

async function loadWipFileDiff(
  repoPath: string,
  request: Extract<GitFileDiffRequest, { kind: 'wip' }>,
  env: NodeJS.ProcessEnv | undefined
): Promise<GitFileDiff> {
  const status = await loadStatus(repoPath, env);
  const statusFile = status.files.find((file) => file.path === request.path);
  const patch = request.staged
    ? await loadStagedPatch(repoPath, request.path, statusFile, env)
    : await loadUnstagedPatch(repoPath, request.path, statusFile, env);

  return {
    repoPath,
    path: request.path,
    originalPath: statusFile?.originalPath,
    mode: request.staged ? 'wip-staged' : 'wip-unstaged',
    patch,
    isBinary: isBinaryPatch(patch),
    loadedAt: new Date().toISOString()
  };
}

async function loadStagedPatch(
  repoPath: string,
  path: string,
  statusFile: GitFileChange | undefined,
  env: NodeJS.ProcessEnv | undefined
): Promise<string> {
  return (
    await gitExecutor.run(
      ['diff', '--cached', '--binary', '--patch', '--find-renames', '--find-copies', '--', ...createDiffPathspec(path, statusFile?.originalPath)],
      { cwd: repoPath, env }
    )
  ).stdout;
}

async function loadUnstagedPatch(
  repoPath: string,
  path: string,
  statusFile: GitFileChange | undefined,
  env: NodeJS.ProcessEnv | undefined
): Promise<string> {
  if (statusFile?.status === 'untracked') {
    return (
      await gitExecutor.run(['diff', '--no-index', '--binary', '--patch', '--', '/dev/null', path], {
        cwd: repoPath,
        env,
        allowedExitCodes: [1]
      })
    ).stdout;
  }

  return (
    await gitExecutor.run(
      ['diff', '--binary', '--patch', '--find-renames', '--find-copies', '--', ...createDiffPathspec(path, statusFile?.originalPath)],
      { cwd: repoPath, env }
    )
  ).stdout;
}

function createDiffPathspec(path: string, originalPath: string | undefined): string[] {
  if (!originalPath || originalPath === path) {
    return [path];
  }

  return [originalPath, path];
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

function isBinaryPatch(patch: string): boolean {
  return /^(Binary files |Binary file |GIT binary patch)/m.test(patch);
}

function createOperationResult(repoPath: string, undoEntry?: GitUndoEntry): GitOperationResult {
  return {
    repoPath,
    happenedAt: new Date().toISOString(),
    undoEntry
  };
}
