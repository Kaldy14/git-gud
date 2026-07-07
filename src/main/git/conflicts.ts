import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { GitConflictOperation, GitConflictState, GitFileChange, GitFileChangeDetail, GitStatusSummary } from '@shared/types';

import { gitExecutor } from './exec';
import { parseStatusPorcelainV2 } from './parsers/status';

export async function loadConflictState(
  repoPath: string,
  env?: NodeJS.ProcessEnv,
  status?: GitStatusSummary
): Promise<GitConflictState> {
  const resolvedStatus = status ?? (await loadConflictStatus(repoPath, env));
  const [rebaseMerge, rebaseApply, mergeHead, cherryPickHead, revertHead] = await Promise.all([
    gitPathExists(repoPath, 'rebase-merge', env),
    gitPathExists(repoPath, 'rebase-apply', env),
    gitPathExists(repoPath, 'MERGE_HEAD', env),
    gitPathExists(repoPath, 'CHERRY_PICK_HEAD', env),
    gitPathExists(repoPath, 'REVERT_HEAD', env)
  ]);
  const operation = selectConflictOperation({
    rebaseMerge,
    rebaseApply,
    mergeHead,
    cherryPickHead,
    revertHead
  });
  const files = resolvedStatus.files.filter((file) => file.conflicted).map(conflictedFileToDetail);
  const isActive = Boolean(operation) || files.length > 0;

  return {
    isActive,
    ...(operation ? { operation } : {}),
    files,
    canContinue: Boolean(operation),
    canSkip: operation === 'rebase' || operation === 'cherry-pick' || operation === 'revert',
    canAbort: Boolean(operation),
    ...(isActive ? { message: createConflictMessage(operation, files.length) } : {})
  };
}

async function loadConflictStatus(repoPath: string, env: NodeJS.ProcessEnv | undefined): Promise<GitStatusSummary> {
  const result = await gitExecutor.run(['status', '--porcelain=v2', '--branch', '-z'], { cwd: repoPath, env });
  return parseStatusPorcelainV2(result.stdout);
}

function selectConflictOperation(paths: {
  rebaseMerge: boolean;
  rebaseApply: boolean;
  mergeHead: boolean;
  cherryPickHead: boolean;
  revertHead: boolean;
}): GitConflictOperation | undefined {
  if (paths.rebaseMerge || paths.rebaseApply) {
    return 'rebase';
  }

  if (paths.mergeHead) {
    return 'merge';
  }

  if (paths.cherryPickHead) {
    return 'cherry-pick';
  }

  if (paths.revertHead) {
    return 'revert';
  }

  return undefined;
}

async function gitPathExists(repoPath: string, pathName: string, env: NodeJS.ProcessEnv | undefined): Promise<boolean> {
  const result = await gitExecutor.run(['rev-parse', '--git-path', pathName], { cwd: repoPath, env });
  const gitPath = result.stdout.trim();

  if (!gitPath) {
    return false;
  }

  try {
    await access(resolve(repoPath, gitPath));
    return true;
  } catch {
    return false;
  }
}

function conflictedFileToDetail(file: GitFileChange): GitFileChangeDetail {
  return {
    path: file.path,
    originalPath: file.originalPath,
    status: file.status,
    staged: file.staged,
    unstaged: file.unstaged,
    conflicted: file.conflicted
  };
}

function createConflictMessage(operation: GitConflictOperation | undefined, conflictedFileCount: number): string {
  const operationLabel = operation ? operation.replace('-', ' ') : 'Git operation';

  if (conflictedFileCount === 0) {
    return `${operationLabel} is waiting for you to continue, skip, or abort.`;
  }

  return `${operationLabel} has ${conflictedFileCount} conflicted file${conflictedFileCount === 1 ? '' : 's'}.`;
}
