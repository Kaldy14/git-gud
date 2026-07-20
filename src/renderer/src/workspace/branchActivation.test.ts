import { describe, expect, it } from 'vitest';

import type { GitBranchRef, GitWorktree } from '@shared/types';

import { resolveLocalBranchActivation, resolveRemoteBranchActivation } from './branchActivation';

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

function worktree(overrides: Partial<GitWorktree> = {}): GitWorktree {
  return {
    path: '/repos/project-main',
    head: 'local-sha',
    branch: 'main',
    detached: false,
    bare: false,
    current: false,
    ...overrides
  };
}

describe('local branch activation', () => {
  it('activates the linked worktree that already owns the branch', () => {
    expect(resolveLocalBranchActivation('main', [worktree()])).toEqual({
      kind: 'activate-worktree',
      branchName: 'main',
      worktreePath: '/repos/project-main'
    });
  });

  it('checks out a branch that is not owned by another worktree', () => {
    expect(resolveLocalBranchActivation('feature/next', [
      worktree(),
      worktree({ path: '/repos/current', branch: 'feature/next', current: true }),
      worktree({ path: '/repos/bare.git', branch: 'feature/next', bare: true })
    ])).toEqual({ kind: 'checkout-local', branchName: 'feature/next' });
  });
});

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

  it('prefers the same-named tracking branch when multiple local branches share an upstream', () => {
    const staleCurrentBranch = branch({
      name: 'bugfix/ITE-422-keboola-analytics-importer-rebuild',
      fullName: 'refs/heads/bugfix/ITE-422-keboola-analytics-importer-rebuild',
      current: true,
      ahead: 11,
      behind: 73
    });
    const mainBranch = branch({ current: false, behind: 2 });

    expect(resolveRemoteBranchActivation('origin/main', [staleCurrentBranch, mainBranch])).toEqual({
      kind: 'checkout-and-pull',
      branchName: 'main'
    });
  });

  it('matches nested branch names independently of local branch ordering', () => {
    const renamedBranch = branch({
      name: 'local-feature-copy',
      fullName: 'refs/heads/local-feature-copy',
      current: true,
      upstream: 'origin/feature/ITE-526-wall',
      behind: 4
    });
    const matchingBranch = branch({
      name: 'feature/ITE-526-wall',
      fullName: 'refs/heads/feature/ITE-526-wall',
      current: false,
      upstream: 'origin/feature/ITE-526-wall',
      behind: 4
    });

    expect(resolveRemoteBranchActivation('origin/feature/ITE-526-wall', [renamedBranch, matchingBranch])).toEqual({
      kind: 'checkout-and-pull',
      branchName: 'feature/ITE-526-wall'
    });
  });

  it('supports a sole renamed local tracking branch', () => {
    const renamedBranch = branch({
      name: 'integration',
      fullName: 'refs/heads/integration',
      current: false,
      behind: 1
    });

    expect(resolveRemoteBranchActivation('origin/main', [renamedBranch])).toEqual({
      kind: 'checkout-and-pull',
      branchName: 'integration'
    });
  });

  it('does not guess between multiple renamed branches tracking the same remote branch', () => {
    const firstBranch = branch({ name: 'integration-a', fullName: 'refs/heads/integration-a', current: true });
    const secondBranch = branch({ name: 'integration-b', fullName: 'refs/heads/integration-b', current: false });

    expect(resolveRemoteBranchActivation('origin/main', [firstBranch, secondBranch])).toEqual({
      kind: 'checkout-remote'
    });
  });
});
