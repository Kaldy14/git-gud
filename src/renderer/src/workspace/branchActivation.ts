import { branchNameFromRemoteRef } from '@renderer/lib/gitRefs';
import type { GitBranchRef, GitWorktree } from '@shared/types';

export type LocalBranchActivation =
  | { kind: 'activate-worktree'; branchName: string; worktreePath: string }
  | { kind: 'checkout-local'; branchName: string };

export type RemoteBranchActivation =
  | { kind: 'pull'; branchName: string }
  | { kind: 'checkout-and-pull'; branchName: string }
  | { kind: 'checkout-local'; branchName: string }
  | { kind: 'checkout-remote' }
  | { kind: 'none' };

export function resolveLocalBranchActivation(
  branchName: string,
  worktrees: readonly GitWorktree[]
): LocalBranchActivation {
  const linkedWorktree = worktrees.find(
    (worktree) => !worktree.current && !worktree.bare && worktree.branch === branchName
  );

  return linkedWorktree
    ? { kind: 'activate-worktree', branchName, worktreePath: linkedWorktree.path }
    : { kind: 'checkout-local', branchName };
}

export function resolveRemoteBranchActivation(
  remoteBranchName: string,
  localBranches: readonly GitBranchRef[]
): RemoteBranchActivation {
  const localBranch = resolveLocalTrackingBranch(remoteBranchName, localBranches);

  if (!localBranch) {
    return { kind: 'checkout-remote' };
  }

  if (localBranch.behind > 0) {
    return localBranch.current
      ? { kind: 'pull', branchName: localBranch.name }
      : { kind: 'checkout-and-pull', branchName: localBranch.name };
  }

  return localBranch.current
    ? { kind: 'none' }
    : { kind: 'checkout-local', branchName: localBranch.name };
}

function resolveLocalTrackingBranch(
  remoteBranchName: string,
  localBranches: readonly GitBranchRef[]
): GitBranchRef | undefined {
  const trackingBranches = localBranches.filter((branch) => branch.upstream === remoteBranchName);
  const matchingName = branchNameFromRemoteRef(remoteBranchName);
  const exactMatch = trackingBranches.find((branch) => branch.name === matchingName);

  if (exactMatch) {
    return exactMatch;
  }

  return trackingBranches.length === 1 ? trackingBranches[0] : undefined;
}
