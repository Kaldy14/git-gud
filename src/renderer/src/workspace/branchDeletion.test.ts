import { describe, expect, it } from 'vitest';

import type { GitBranchRef, GitRemoteBranchRef } from '@shared/types';

import { remoteBranchDeleteTarget, resolveRemoteBranchForLocalBranch } from './branchDeletion';

const localBranch: GitBranchRef = {
  name: 'feature/delete-me',
  fullName: 'refs/heads/feature/delete-me',
  sha: 'local-sha',
  current: false,
  upstream: 'fork/published-name',
  ahead: 0,
  behind: 0
};

function remoteBranch(name: string, remote: string): GitRemoteBranchRef {
  return {
    name,
    fullName: `refs/remotes/${name}`,
    sha: 'remote-sha',
    remote
  };
}

describe('branch deletion targets', () => {
  it('prefers the configured upstream even when its branch name differs', () => {
    const upstream = remoteBranch('fork/published-name', 'fork');

    expect(
      resolveRemoteBranchForLocalBranch(localBranch, [
        remoteBranch('origin/feature/delete-me', 'origin'),
        upstream
      ])
    ).toBe(upstream);
    expect(remoteBranchDeleteTarget(upstream)).toEqual({ name: 'fork', branch: 'published-name' });
  });

  it('falls back to the matching origin branch', () => {
    const origin = remoteBranch('origin/feature/delete-me', 'origin');

    expect(resolveRemoteBranchForLocalBranch({ ...localBranch, upstream: undefined }, [origin])).toBe(origin);
  });

  it('does not substitute origin when the configured upstream is unavailable', () => {
    expect(
      resolveRemoteBranchForLocalBranch(localBranch, [
        remoteBranch('origin/feature/delete-me', 'origin')
      ])
    ).toBeUndefined();
  });

  it('does not guess when multiple non-origin remotes match', () => {
    expect(
      resolveRemoteBranchForLocalBranch({ ...localBranch, upstream: undefined }, [
        remoteBranch('fork/feature/delete-me', 'fork'),
        remoteBranch('backup/feature/delete-me', 'backup')
      ])
    ).toBeUndefined();
  });
});
