import type {
  GitBranchRef,
  GitPushTarget,
  GitRemote,
  GitRemoteBranchRef
} from '@shared/types';

export type PushPlan = {
  branchName: string;
  isCurrentBranch: boolean;
  expectedLocalSha: string;
  target: GitPushTarget;
};

export type PushRejectionPrompt = PushPlan & {
  repoPath: string;
  remoteBranchName: string;
  target: GitPushTarget & { expectedSha: string };
};

const NON_FAST_FORWARD_PATTERNS = [
  /\[rejected\].*\(non-fast-forward\)/i,
  /\[rejected\].*\(fetch first\)/i,
  /updates were rejected because the tip of your current branch is behind/i,
  /updates were rejected because the remote contains work that you do not have locally/i,
  /non-fast-forward/i
];

export function isNonFastForwardPushError(message: string): boolean {
  return NON_FAST_FORWARD_PATTERNS.some((pattern) => pattern.test(message));
}

export function createPushPlan(
  branch: GitBranchRef,
  remotes: readonly GitRemote[]
): PushPlan | undefined {
  const upstreamRemote = branch.upstream
    ? [...remotes]
        .sort((left, right) => right.name.length - left.name.length)
        .find((remote) => branch.upstream?.startsWith(`${remote.name}/`))
    : undefined;
  const remote =
    upstreamRemote ??
    remotes.find((candidate) => candidate.name === 'origin') ??
    remotes[0];

  if (!remote) {
    return undefined;
  }

  const remoteBranchName =
    upstreamRemote && branch.upstream
      ? branch.upstream.slice(upstreamRemote.name.length + 1)
      : branch.name;
  return {
    branchName: branch.name,
    isCurrentBranch: branch.current,
    expectedLocalSha: branch.sha,
    target: {
      remote: remote.name,
      branch: remoteBranchName,
      setUpstream: !upstreamRemote
    }
  };
}

export function createPushRejectionPrompt(
  repoPath: string,
  plan: PushPlan,
  remoteBranches: readonly GitRemoteBranchRef[]
): PushRejectionPrompt | undefined {
  const remoteBranch = remoteBranches.find(
    (candidate) =>
      candidate.remote === plan.target.remote &&
      candidate.fullName ===
        `refs/remotes/${plan.target.remote}/${plan.target.branch}`
  );

  if (!remoteBranch) {
    return undefined;
  }

  return {
    ...plan,
    repoPath,
    remoteBranchName: `${plan.target.remote}/${plan.target.branch}`,
    target: {
      ...plan.target,
      expectedSha: remoteBranch.sha
    }
  };
}
