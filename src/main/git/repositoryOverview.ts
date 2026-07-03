import type { GitRepositoryOverview, RepoTab } from '@shared/types';

import { getRepoProfileState } from '../profiles';
import { gitExecutor } from './exec';
import { parseForEachRef, parseRemoteVerbose } from './parsers/refs';
import { parseStashList } from './parsers/stash';
import { parseStatusPorcelainV2 } from './parsers/status';
import { parseWorktreeList } from './parsers/worktree';

export async function loadRepositoryOverview(tab: Pick<RepoTab, 'path' | 'assignedProfileId'>): Promise<GitRepositoryOverview> {
  const [status, refs, remotes, worktrees, stashes, profileState] = await Promise.all([
    loadStatus(tab.path),
    loadRefs(tab.path),
    loadRemotes(tab.path),
    loadWorktrees(tab.path),
    loadStashes(tab.path),
    getRepoProfileState(tab.path, tab.assignedProfileId)
  ]);

  return {
    repoPath: tab.path,
    loadedAt: new Date().toISOString(),
    status,
    refs,
    remotes,
    worktrees,
    stashes,
    profileState
  };
}

async function loadStatus(repoPath: string): Promise<GitRepositoryOverview['status']> {
  const result = await gitExecutor.run(['status', '--porcelain=v2', '--branch', '-z'], { cwd: repoPath });
  return parseStatusPorcelainV2(result.stdout);
}

async function loadRefs(repoPath: string): Promise<GitRepositoryOverview['refs']> {
  const result = await gitExecutor.run(
    [
      'for-each-ref',
      '--format=%(refname)%00%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track)%00%(HEAD)%00%(creatordate:iso-strict)',
      'refs/heads',
      'refs/remotes',
      'refs/tags'
    ],
    { cwd: repoPath }
  );

  return parseForEachRef(result.stdout);
}

async function loadRemotes(repoPath: string): Promise<GitRepositoryOverview['remotes']> {
  const result = await gitExecutor.run(['remote', '-v'], { cwd: repoPath });
  return parseRemoteVerbose(result.stdout);
}

async function loadWorktrees(repoPath: string): Promise<GitRepositoryOverview['worktrees']> {
  const result = await gitExecutor.run(['worktree', 'list', '--porcelain', '-z'], { cwd: repoPath });
  return parseWorktreeList(result.stdout, repoPath);
}

async function loadStashes(repoPath: string): Promise<GitRepositoryOverview['stashes']> {
  const result = await gitExecutor.run(['stash', 'list', '--format=%H%x00%P%x00%gd%x00%aI%x00%s%x00'], {
    cwd: repoPath
  });
  return parseStashList(result.stdout);
}
