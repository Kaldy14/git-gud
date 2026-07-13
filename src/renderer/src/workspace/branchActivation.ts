import type { GitBranchRef } from '@shared/types';

export type RemoteBranchActivation =
  | { kind: 'pull'; branchName: string }
  | { kind: 'checkout-and-pull'; branchName: string }
  | { kind: 'checkout-local'; branchName: string }
  | { kind: 'checkout-remote' }
  | { kind: 'none' };

export function resolveRemoteBranchActivation(
  remoteBranchName: string,
  localBranches: GitBranchRef[]
): RemoteBranchActivation {
  const localBranch = localBranches.find((branch) => branch.upstream === remoteBranchName);

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
