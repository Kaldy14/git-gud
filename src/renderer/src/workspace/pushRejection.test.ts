import { describe, expect, it } from 'vitest';

import type { GitBranchRef, GitRemoteBranchRef } from '@shared/types';

import {
  createPushPlan,
  createPushRejectionPrompt,
  isNonFastForwardPushError
} from './pushRejection';

const localBranch: GitBranchRef = {
  name: 'feature/rewrite',
  fullName: 'refs/heads/feature/rewrite',
  sha: 'a'.repeat(40),
  current: true,
  ahead: 2,
  behind: 1
};

function remoteBranch(remote: string, branch: string, sha: string): GitRemoteBranchRef {
  return {
    name: `${remote}/${branch}`,
    fullName: `refs/remotes/${remote}/${branch}`,
    remote,
    sha
  };
}

describe('push rejection detection', () => {
  it.each([
    "! [rejected]        feature/demo -> feature/demo (non-fast-forward)",
    "! [rejected]        main -> main (fetch first)",
    'Updates were rejected because the tip of your current branch is behind',
    'Updates were rejected because the remote contains work that you do not have locally.'
  ])('recognizes a remote-history rejection: %s', (message) => {
    expect(isNonFastForwardPushError(message)).toBe(true);
  });

  it.each([
    'remote: Permission to acme/widgets.git denied.',
    'fatal: Could not read from remote repository.',
    '! [remote rejected] main -> main (pre-receive hook declined)',
    'stale info'
  ])('does not offer force push for unrelated failures: %s', (message) => {
    expect(isNonFastForwardPushError(message)).toBe(false);
  });

  it('captures the exact origin target and commit leases used for an untracked branch', () => {
    expect(
      createPushRejectionPrompt(
        '/repo',
        createPushPlan(localBranch, [{ name: 'backup' }, { name: 'origin' }])!,
        [
          remoteBranch('backup', 'feature/rewrite', 'b'.repeat(40)),
          remoteBranch('origin', 'feature/rewrite', 'c'.repeat(40))
        ]
      )
    ).toEqual({
      repoPath: '/repo',
      branchName: 'feature/rewrite',
      remoteBranchName: 'origin/feature/rewrite',
      isCurrentBranch: true,
      expectedLocalSha: 'a'.repeat(40),
      target: {
        remote: 'origin',
        branch: 'feature/rewrite',
        expectedSha: 'c'.repeat(40),
        setUpstream: true
      }
    });
  });

  it('uses the configured upstream remote and renamed branch', () => {
    expect(
      createPushPlan(
        { ...localBranch, upstream: 'company/review/rewrite' },
        [{ name: 'origin' }, { name: 'company' }]
      )?.target
    ).toEqual({
      remote: 'company',
      branch: 'review/rewrite',
      setUpstream: false
    });
  });

  it('does not offer force push without an exact remote-tracking lease', () => {
    expect(
      createPushRejectionPrompt(
        '/repo',
        createPushPlan(localBranch, [{ name: 'origin' }])!,
        []
      )
    ).toBeUndefined();
  });
});
