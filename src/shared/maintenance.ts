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
