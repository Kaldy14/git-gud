import { realpath } from 'node:fs/promises';

import type { GitRepositoryOverview, RepoTab } from '@shared/types';

import { createProfileCommandEnv, getRepoProfileState } from '../profiles';
import { loadConflictState } from './conflicts';
import { GitCommandError, gitExecutor } from './exec';
import { parseForEachRef, parseRemoteVerbose } from './parsers/refs';
import { parseStashList } from './parsers/stash';
import { parseStatusPorcelainV2 } from './parsers/status';
import { parseWorktreeList } from './parsers/worktree';
import { loadLatestUndoEntry } from './undo';

const inFlightGitReads = new Map<string, Promise<unknown>>();

export async function loadRepositoryOverview(tab: Pick<RepoTab, 'path' | 'assignedProfileId'>): Promise<GitRepositoryOverview> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const [status, refs, remotes, worktrees, stashes] = await Promise.all([
    loadStatus(tab.path, env),
    loadRefs(tab.path, env),
    loadRemotes(tab.path, env),
    loadWorktrees(tab.path, env),
    loadStashes(tab.path, env)
  ]);
  const remoteUrls = remotes
    .flatMap((remote) => [remote.fetchUrl, remote.pushUrl])
    .filter((url): url is string => typeof url === 'string');
  const [conflictState, latestUndo, profileState] = await Promise.all([
    loadConflictState(tab.path, env, status),
    loadLatestUndoEntry(tab.path, env),
    getRepoProfileState(tab.path, tab.assignedProfileId, remoteUrls)
  ]);

  return {
    repoPath: tab.path,
    loadedAt: new Date().toISOString(),
    status,
    conflictState,
    refs,
    remotes,
    worktrees,
    stashes,
    profileState,
    latestUndo
  };
}

export async function loadStatus(
  repoPath: string,
  env?: NodeJS.ProcessEnv,
  paths: readonly string[] = []
): Promise<GitRepositoryOverview['status']> {
  const pathCacheKey = paths.join('\0');
  return coalesceGitRead(repoPath, `status:${repoPath}:${gitExecutor.getMutationGeneration(repoPath)}:${envCacheKey(env)}:${pathCacheKey}`, async () => {
    const args = ['status', '--porcelain=v2', '--branch', '--untracked-files=all', '-z'];

    if (paths.length > 0) {
      args.unshift('--literal-pathspecs');
      args.push('--', ...paths);
    }

    const result = await gitExecutor.run(args, { cwd: repoPath, env });
    return parseStatusPorcelainV2(result.stdout);
  });
}

export async function loadRefs(repoPath: string, env?: NodeJS.ProcessEnv): Promise<GitRepositoryOverview['refs']> {
  return coalesceGitRead(repoPath, `refs:${repoPath}:${gitExecutor.getMutationGeneration(repoPath)}:${envCacheKey(env)}`, async () => {
    const result = await gitExecutor.run(
      [
        'for-each-ref',
        '--format=%(refname)%00%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track)%00%(HEAD)%00%(creatordate:iso-strict)%00%(objecttype)%00%(*objectname)%00%(*objecttype)',
        'refs/heads',
        'refs/remotes',
        'refs/tags'
      ],
      { cwd: repoPath, env }
    );

    return parseForEachRef(result.stdout);
  });
}

export async function loadRemotes(repoPath: string, env?: NodeJS.ProcessEnv): Promise<GitRepositoryOverview['remotes']> {
  const result = await gitExecutor.run(['remote', '-v'], { cwd: repoPath, env });
  return parseRemoteVerbose(result.stdout);
}

export async function loadWorktrees(repoPath: string, env?: NodeJS.ProcessEnv): Promise<GitRepositoryOverview['worktrees']> {
  const currentWorktreePath = await canonicalPath(repoPath);

  try {
    const result = await gitExecutor.run(['worktree', 'list', '--porcelain', '-z'], { cwd: repoPath, env });
    return parseWorktreeList(result.stdout, currentWorktreePath);
  } catch (error) {
    if (!(error instanceof GitCommandError) || error.exitCode !== 129) {
      throw error;
    }

    const result = await gitExecutor.run(['worktree', 'list', '--porcelain'], { cwd: repoPath, env });
    return parseWorktreeList(result.stdout, currentWorktreePath);
  }
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

export async function loadStashes(repoPath: string, env?: NodeJS.ProcessEnv): Promise<GitRepositoryOverview['stashes']> {
  return coalesceGitRead(repoPath, `stashes:${repoPath}:${gitExecutor.getMutationGeneration(repoPath)}:${envCacheKey(env)}`, async () => {
    const result = await gitExecutor.run(['stash', 'list', '--format=%H%x00%P%x00%gd%x00%aI%x00%s%x00'], {
      cwd: repoPath,
      env
    });
    return parseStashList(result.stdout);
  });
}

async function coalesceGitRead<T>(repoPath: string, cacheKey: string, load: () => Promise<T>): Promise<T> {
  if (gitExecutor.isInTransaction(repoPath)) {
    return load();
  }

  const existingRead = inFlightGitReads.get(cacheKey);

  if (existingRead) {
    return existingRead as Promise<T>;
  }

  const nextRead = load().finally(() => {
    inFlightGitReads.delete(cacheKey);
  });
  inFlightGitReads.set(cacheKey, nextRead);
  return nextRead;
}

function envCacheKey(env: NodeJS.ProcessEnv | undefined): string {
  return env?.GH_CONFIG_DIR ?? '';
}
