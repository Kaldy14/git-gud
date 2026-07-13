import { describe, expect, it } from 'vitest';

import type { GitBranchRef } from '@shared/types';

import { resolveRemoteBranchActivation } from './branchActivation';

function branch(overrides: Partial<GitBranchRef> = {}): GitBranchRef {
  return {
    name: 'main',
    fullName: 'refs/heads/main',
    sha: 'local-sha',
    current: true,
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    ...overrides
  };
}

describe('remote branch activation', () => {
  it('pulls a checked-out tracking branch when it is behind', () => {
    expect(resolveRemoteBranchActivation('origin/main', [branch({ behind: 2 })])).toEqual({
      kind: 'pull',
      branchName: 'main'
    });
  });

  it('checks out and pulls a behind tracking branch when it is not current', () => {
    expect(resolveRemoteBranchActivation('origin/main', [branch({ current: false, behind: 2 })])).toEqual({
      kind: 'checkout-and-pull',
      branchName: 'main'
    });
  });

  it('checks out an existing tracking branch without pulling when it is not behind', () => {
    expect(resolveRemoteBranchActivation('origin/main', [branch({ current: false })])).toEqual({
      kind: 'checkout-local',
      branchName: 'main'
    });
  });

  it('uses the remote checkout flow when no local branch tracks the ref', () => {
    expect(resolveRemoteBranchActivation('origin/feature', [branch()])).toEqual({ kind: 'checkout-remote' });
  });
});
