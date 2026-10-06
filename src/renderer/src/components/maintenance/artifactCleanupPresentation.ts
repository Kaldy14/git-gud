import type { ArtifactCleanupCandidate } from '@shared/maintenance';

import { shellQuote } from './branchCleanupPresentation';

/** Per-cleanup limit for stashes and worktrees together. */
export const MAX_CLEANUP_ARTIFACTS = 100;

export const ARTIFACT_NOUNS: Record<ArtifactCleanupCandidate['kind'], { one: string; many: string }> = {
  stash: { one: 'stash', many: 'stashes' },
  worktree: { one: 'worktree', many: 'worktrees' }
};

/**
 * Builds a copyable command that restores a dropped stash from its recovery
 * ref. `git stash store` adds the commit back to the stash list; it never
 * applies changes to the working tree.
 */
export function buildStashRestoreCommand(candidate: Pick<ArtifactCleanupCandidate, 'name'>, recoveryRef: string): string {
  return `git stash store -m ${shellQuote(candidate.name)} ${shellQuote(recoveryRef)}`;
}

/**
 * Builds a copyable command that recreates a removed worktree. The branch is
 * retained by cleanup, so an attached worktree checks it out again; a detached
 * worktree is recreated at the backup ref.
 */
export function buildWorktreeRestoreCommand(candidate: Pick<ArtifactCleanupCandidate, 'id' | 'branch'>, recoveryRef: string): string {
  const branch = candidate.branch?.replace(/^refs\/heads\//, '');
  return branch
    ? `git worktree add -- ${shellQuote(candidate.id)} ${shellQuote(branch)}`
    : `git worktree add --detach -- ${shellQuote(candidate.id)} ${shellQuote(recoveryRef)}`;
}

export function formatAgeSource(source: ArtifactCleanupCandidate['ageSource']): string | undefined {
  return source === 'head-activity' ? 'Last checkout or commit in this worktree' : source === 'tip-commit' ? 'Commit date of the checked-out commit' : undefined;
}
