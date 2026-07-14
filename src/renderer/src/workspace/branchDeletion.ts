import type { GitBranchRef, GitDeleteBranchInput, GitRemoteBranchRef } from '@shared/types';

export function resolveRemoteBranchForLocalBranch(
  localBranch: GitBranchRef,
  remoteBranches: GitRemoteBranchRef[]
): GitRemoteBranchRef | undefined {
  if (localBranch.upstream) {
    return remoteBranches.find((branch) => branch.name === localBranch.upstream);
  }

  const originPeer = remoteBranches.find((branch) => branch.name === `origin/${localBranch.name}`);

  if (originPeer) {
    return originPeer;
  }

  const peers = remoteBranches.filter((branch) => remoteBranchDeleteTarget(branch).branch === localBranch.name);
  return peers.length === 1 ? peers[0] : undefined;
}

export function remoteBranchDeleteTarget(
  remoteBranch: GitRemoteBranchRef
): NonNullable<GitDeleteBranchInput['remote']> {
  const prefix = `${remoteBranch.remote}/`;
  return {
    name: remoteBranch.remote,
    branch: remoteBranch.name.startsWith(prefix) ? remoteBranch.name.slice(prefix.length) : remoteBranch.name
  };
}
