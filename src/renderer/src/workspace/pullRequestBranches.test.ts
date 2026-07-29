import { describe, expect, it } from 'vitest';

import type {
  GitBranchRef,
  GitHubPullRequestSummary,
  GitRemote,
  GitRemoteBranchRef
} from '@shared/types';

import {
  indexPullRequestsByBranch,
  repositoryMatchesPullRequest
} from './pullRequestBranches';

describe('pull request branch matching', () => {
  it('matches a local branch only within the repository identified by its remotes', () => {
    const matches = indexPullRequestsByBranch(
      [
        pullRequest('acme', 'widgets', 'feature/menu', 42),
        pullRequest('other', 'project', 'feature/menu', 7)
      ],
      sources({
        localBranches: [localBranch('feature/menu', 'sha-42')],
        remotes: [{ name: 'origin', fetchUrl: 'git@github.com:acme/widgets.git' }]
      })
    );

    expect(matches.local.get('feature/menu')?.number).toBe(42);
  });

  it('supports HTTPS and SSH remotes, including GitHub Enterprise hosts', () => {
    const pullRequests = [
      pullRequest('Acme', 'Widgets', 'feature/https', 1),
      {
        ...pullRequest('team', 'desktop', 'feature/ssh', 2),
        url: 'https://github.example.com/team/desktop/pull/2'
      }
    ];
    const remotes: GitRemote[] = [
      { name: 'origin', fetchUrl: 'https://github.com/acme/widgets.git' },
      {
        name: 'enterprise',
        fetchUrl: 'ssh://git@github.example.com/team/desktop.git'
      }
    ];

    const matches = indexPullRequestsByBranch(
      pullRequests,
      sources({
        localBranches: [
          localBranch('feature/https', 'sha-1'),
          localBranch('feature/ssh', 'sha-2')
        ],
        remotes
      })
    );

    expect(matches.local.get('feature/https')?.number).toBe(1);
    expect(matches.local.get('feature/ssh')?.number).toBe(2);
  });

  it('omits ambiguous branch matches instead of opening the wrong pull request', () => {
    const matches = indexPullRequestsByBranch(
      [
        pullRequest('acme', 'widgets', 'feature/menu', 41, 'same-sha'),
        pullRequest('acme', 'widgets', 'feature/menu', 42, 'same-sha')
      ],
      sources({
        localBranches: [localBranch('feature/menu', 'same-sha')],
        remotes: [{ name: 'origin', fetchUrl: 'git@github.com:acme/widgets.git' }]
      })
    );

    expect(matches.local.has('feature/menu')).toBe(false);
  });

  it('does not expose pull requests when the repository remote cannot be trusted', () => {
    const matches = indexPullRequestsByBranch(
      [pullRequest('acme', 'widgets', 'feature/menu', 42)],
      sources({
        localBranches: [localBranch('feature/menu', 'sha-42')],
        remotes: [{ name: 'origin', fetchUrl: '/local/path/widgets.git' }]
      })
    );

    expect(matches.local.size).toBe(0);
    expect(matches.remote.size).toBe(0);
  });

  it('does not associate a same-named local branch with an unconfigured fork PR', () => {
    const forkPullRequest = {
      ...pullRequest('acme', 'widgets', 'feature/menu', 42),
      headRepositoryOwner: 'contributor',
      headRepository: 'widgets-fork'
    };
    const matches = indexPullRequestsByBranch(
      [forkPullRequest],
      sources({
        localBranches: [localBranch('feature/menu', 'sha-42')],
        remotes: [{ name: 'origin', fetchUrl: 'git@github.com:acme/widgets.git' }]
      })
    );

    expect(matches.local.has('feature/menu')).toBe(false);
  });

  it('matches a configured fork only when branch name and head SHA agree', () => {
    const forkPullRequest = {
      ...pullRequest('acme', 'widgets', 'feature/menu', 42),
      headRepositoryOwner: 'contributor',
      headRepository: 'widgets-fork'
    };
    const matches = indexPullRequestsByBranch(
      [forkPullRequest],
      sources({
        localBranches: [
          localBranch('feature/menu', 'sha-42', 'fork/feature/menu')
        ],
        remotes: [
          { name: 'origin', fetchUrl: 'git@github.com:acme/widgets.git' },
          {
            name: 'fork',
            fetchUrl: 'git@github.com:contributor/widgets-fork.git'
          }
        ]
      })
    );

    expect(matches.local.get('feature/menu')?.number).toBe(42);
  });

  it('indexes remote branches by full remote identity', () => {
    const matches = indexPullRequestsByBranch(
      [pullRequest('acme', 'widgets', 'main', 42)],
      sources({
        remoteBranches: [remoteBranch('upstream/main', 'upstream', 'sha-42')],
        remotes: [
          { name: 'origin', fetchUrl: 'git@github.com:other/project.git' },
          { name: 'upstream', fetchUrl: 'git@github.com:acme/widgets.git' }
        ]
      })
    );

    expect(matches.remote.get('upstream/main')?.number).toBe(42);
    expect(matches.remote.has('origin/main')).toBe(false);
  });

  it('matches a pull request to its local repository without requiring the head branch', () => {
    expect(
      repositoryMatchesPullRequest(
        pullRequest('acme', 'widgets', 'feature/remote-only', 42),
        [{ name: 'origin', pushUrl: 'git@github.com:acme/widgets.git' }]
      )
    ).toBe(true);
    expect(
      repositoryMatchesPullRequest(
        pullRequest('other', 'project', 'feature/remote-only', 7),
        [{ name: 'origin', fetchUrl: 'https://github.com/acme/widgets.git' }]
      )
    ).toBe(false);
  });
});

function sources(input: {
  localBranches?: GitBranchRef[];
  remoteBranches?: GitRemoteBranchRef[];
  remotes: GitRemote[];
}) {
  return {
    localBranches: input.localBranches ?? [],
    remoteBranches: input.remoteBranches ?? [],
    remotes: input.remotes
  };
}

function localBranch(
  name: string,
  sha: string,
  upstream?: string
): GitBranchRef {
  return {
    name,
    fullName: `refs/heads/${name}`,
    sha,
    current: false,
    upstream,
    ahead: 0,
    behind: 0
  };
}

function remoteBranch(
  name: string,
  remote: string,
  sha: string
): GitRemoteBranchRef {
  return {
    name,
    fullName: `refs/remotes/${name}`,
    remote,
    sha
  };
}

function pullRequest(
  owner: string,
  repository: string,
  headRefName: string,
  number: number,
  headSha = `sha-${number}`
): GitHubPullRequestSummary {
  return {
    profileId: 'profile:richie',
    owner,
    repository,
    number,
    id: `pr-${number}`,
    title: `Pull request ${number}`,
    url: `https://github.com/${owner}/${repository}/pull/${number}`,
    author: 'richie',
    updatedAt: '2026-07-27T10:00:00.000Z',
    category: 'ready-to-merge',
    isDraft: false,
    reviewDecision: 'review-required',
    mergeState: 'clean',
    mergeable: 'mergeable',
    canMerge: true,
    reviewers: [],
    comments: 0,
    changedFiles: 1,
    additions: 1,
    deletions: 0,
    headRefName,
    headRepositoryOwner: owner,
    headRepository: repository,
    headSha,
    baseRefName: 'main',
    checks: {
      state: 'success',
      total: 1,
      passed: 1,
      failed: 0,
      pending: 0
    }
  };
}
