import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { BranchVisibilityTarget } from '@renderer/workspace/branchVisibility';
import type { GitRepositoryOverview } from '@shared/types';

import { Sidebar } from './Sidebar';

describe('Sidebar remote section', () => {
  it('renders configured remotes with nested branches and management controls', () => {
    const markup = renderSidebar();

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

describe('Sidebar compact modes', () => {
  it('reports an unavailable count as unknown rather than zero', () => {
    const rail = renderSidebar({ isCollapsed: true, pullRequestCount: undefined });
    expect(rail).toContain('aria-label="Pull request inbox, unavailable"');
    expect(rail).not.toContain('Pull request inbox, 0 items');
  });

  it('omits the docked count badge when the inbox count is unavailable', () => {
    const unavailable = renderSidebar({ pullRequestCount: undefined });
    const empty = renderSidebar({ pullRequestCount: 0 });

    expect(unavailable).toContain('aria-label="Pull request inbox, unavailable"');
    expect(unavailable).not.toContain('pr-count-badge');
    expect(empty).toContain('class="pr-count-badge">0</span>');
  });

  it('does not announce a false zero while the inbox is loading', () => {
    const rail = renderSidebar({ isCollapsed: true, isPullRequestLoading: true });

    expect(rail).toContain('aria-label="Pull request inbox, loading"');
    expect(rail).toContain('title="Pull requests: loading"');
    expect(rail).not.toContain('Pull request inbox, 0 items');
  });

  it('keeps the resize handle only when docked', () => {
    expect(renderSidebar()).toContain('aria-label="Resize sidebar"');
    expect(renderSidebar()).not.toContain('workspace-sidebar-flyout-slot');

    const flyout = renderSidebar({ isFlyout: true });

    expect(flyout).toContain('workspace-sidebar-flyout-slot');
    expect(flyout).not.toContain('aria-label="Resize sidebar"');
  });

  it('shows active branch filters on the rail', () => {
    const rail = renderSidebar({
      isCollapsed: true,
      branchVisibility: {
        solo: [branchTarget('a'), branchTarget('b')],
        hidden: [branchTarget('c')]
      }
    });

    expect(rail).toContain('aria-label="2 solo, 1 hidden, open repository sidebar"');
    expect(rail).toContain('<span>3</span>');
  });

  it('omits the filter item when no branch filters are active', () => {
    expect(renderSidebar({ isCollapsed: true })).not.toContain('open repository sidebar');
  });
});

function branchTarget(path: string): BranchVisibilityTarget {
  return { scope: 'local', kind: 'branch', path };
}

function renderSidebar(props: Partial<ComponentProps<typeof Sidebar>> = {}): string {
  return renderToStaticMarkup(
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
      onTogglePullRequestInbox={vi.fn()}
      onResize={vi.fn()}
      onResizeCommit={vi.fn()}
      onResizeReset={vi.fn()}
      branchVisibility={{ solo: [], hidden: [] }}
      onToggleBranchVisibility={vi.fn()}
      onClearBranchVisibility={vi.fn()}
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
      onPushBranchWithTag={vi.fn()}
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
      {...props}
    />
  );
}

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
