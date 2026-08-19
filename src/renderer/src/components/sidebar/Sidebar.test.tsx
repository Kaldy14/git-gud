import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { GitRepositoryOverview } from '@shared/types';

import { Sidebar } from './Sidebar';

describe('Sidebar remote section', () => {
  it('renders configured remotes with nested branches and management controls', () => {
    const markup = renderToStaticMarkup(
      <Sidebar
        repositoryOverview={repositoryOverview}
        isLoading={false}
        isRefreshing={false}
        isCollapsed={false}
        width={280}
        filterFocusSignal={0}
        onToggleCollapsed={vi.fn()}
        pullRequestCount={0}
        isPullRequestLoading={false}
        isPullRequestInboxActive={false}
        onOpenPullRequestInbox={vi.fn()}
        onResize={vi.fn()}
        onResizeCommit={vi.fn()}
        isOperationBusy={false}
        onAddRemote={vi.fn()}
        onFetchRemote={vi.fn()}
        onEditRemote={vi.fn()}
        onRemoveRemote={vi.fn()}
        onCheckoutBranch={vi.fn()}
        onCheckoutRemoteBranch={vi.fn()}
        onCopyBranchName={vi.fn()}
        onPullBranch={vi.fn()}
        onPushBranch={vi.fn()}
        onSetBranchUpstream={vi.fn()}
        onRenameBranch={vi.fn()}
        onReviewBranch={vi.fn()}
        onViewPullRequest={vi.fn()}
        localPullRequestsByBranch={new Map()}
        remotePullRequestsByBranch={new Map()}
        onMergeBranch={vi.fn()}
        onRebaseOntoBranch={vi.fn()}
        onCreateTagAtCommit={vi.fn()}
        onCreateSuggestedTagAtCommit={vi.fn(async () => true)}
        onDeleteBranch={vi.fn()}
        onDeleteRemoteBranch={vi.fn()}
        onPushTag={vi.fn()}
        onDeleteTag={vi.fn()}
        onStashApply={vi.fn()}
        onStashPop={vi.fn()}
        onStashDrop={vi.fn()}
      />
    );

    expect(markup).toContain('aria-label="Add remote"');
    expect(markup).toContain('aria-label="origin remote"');
    expect(markup).toContain('aria-label="Actions for remote origin"');
    expect(markup).toContain('title="git@github.com:acme/widgets.git"');
    expect(markup).toContain('>main</span>');
    expect(markup).toContain('title="feature"');
    expect(markup).toContain('>topic</span>');
    expect(markup).toContain('aria-label="team/origin remote"');
    expect(markup).toContain('>release</span>');
  });
});

const repositoryOverview = {
  repoPath: '/repo',
  loadedAt: '2026-08-19T12:00:00.000Z',
  status: {
    branch: { head: 'main', ahead: 0, behind: 0, isDetached: false },
    files: [],
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    conflictedCount: 0,
    dirtyCount: 0,
    isDirty: false
  },
  conflictState: {
    isActive: false,
    files: [],
    canContinue: false,
    canSkip: false,
    canAbort: false
  },
  refs: {
    localBranches: [],
    remoteBranches: [
      {
        name: 'origin/main',
        fullName: 'refs/remotes/origin/main',
        sha: 'a'.repeat(40),
        remote: 'origin'
      },
      {
        name: 'origin/feature/topic',
        fullName: 'refs/remotes/origin/feature/topic',
        sha: 'c'.repeat(40),
        remote: 'origin'
      },
      {
        name: 'team/origin/release',
        fullName: 'refs/remotes/team/origin/release',
        sha: 'b'.repeat(40),
        remote: 'team'
      }
    ],
    tags: []
  },
  remotes: [
    {
      name: 'origin',
      fetchUrl: 'git@github.com:acme/widgets.git',
      pushUrl: 'git@github.com:acme/widgets.git'
    },
    {
      name: 'team/origin',
      fetchUrl: 'git@github.com:acme/team-widgets.git',
      pushUrl: 'git@github.com:acme/team-widgets.git'
    }
  ],
  worktrees: [],
  stashes: [],
  profileState: {
    profiles: [],
    effectiveIdentity: { source: 'unknown' }
  }
} satisfies GitRepositoryOverview;
