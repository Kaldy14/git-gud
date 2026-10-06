import type { GitOperationResult } from './types';

export type BranchCleanupEvidence = 'merged' | 'patch-equivalent' | 'content-integrated' | 'unmerged' | 'unknown';

export type BranchCleanupOptions = {
  /** Full local or remote-tracking branch ref. Omit to choose the default mainline. */
  baseRef?: string;
  olderThanDays: number;
};

export type BranchCleanupCandidate = {
  ref: string;
  name: string;
  sha: string;
  scope: 'local' | 'remote';
  remote?: string;
  branchName: string;
  tipCommittedAt?: string;
  ageDays?: number;
  oldEnough: boolean;
  evidence: BranchCleanupEvidence;
  explanation: string;
  protectedReason?: string;
  upstreamGone: boolean;
};

export type BranchCleanupPlan = {
  repoPath: string;
  scannedAt: string;
  baseRef: string;
  baseSha: string;
  olderThanDays: number;
  branches: BranchCleanupCandidate[];
  warnings: string[];
};

export type BranchCleanupInput = {
  baseRef: string;
  expectedBaseSha: string;
  olderThanDays: number;
  branches: Array<{ ref: string; expectedSha: string }>;
  /** Explicit acknowledgement for heuristic evidence or age-only deletion. */
  allowUnverified: boolean;
};

export type BranchCleanupResult = GitOperationResult & {
  outcomes: Array<{
    ref: string;
    status: 'deleted' | 'failed';
    message: string;
    recoveryRef?: string;
  }>;
};

export type ArtifactCleanupCandidate = {
  kind: 'stash' | 'worktree';
  /** Stash selector or absolute worktree path. */
  id: string;
  name: string;
  sha: string;
  date?: string;
  ageDays?: number;
  oldEnough: boolean;
  protectedReason?: string;
  /** Worktree branch, if attached. Removing a worktree retains this branch. */
  branch?: string;
  /** Worktree age is the last HEAD reflog activity, falling back to its tip commit. */
  ageSource?: 'head-activity' | 'tip-commit';
};

export type ArtifactCleanupPlan = {
  repoPath: string;
  scannedAt: string;
  olderThanDays: number;
  candidates: ArtifactCleanupCandidate[];
  warnings: string[];
};

export type ArtifactCleanupInput = {
  olderThanDays: number;
  items: Array<{ kind: ArtifactCleanupCandidate['kind']; id: string; expectedSha: string }>;
};

export type ArtifactCleanupResult = GitOperationResult & {
  outcomes: Array<{
    kind: ArtifactCleanupCandidate['kind'];
    id: string;
    status: 'deleted' | 'failed';
    message: string;
    recoveryRef?: string;
  }>;
};
