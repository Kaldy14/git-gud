import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { BranchContextMenuItems } from './BranchContextMenuItems';
import { TagMenuItems } from './TagMenuItems';

function menuItemLabels(markup: string): string[] {
  return [...markup.matchAll(/<button\b[^>]*role="menuitem"[^>]*>(.*?)<\/button>/g)].map((match) =>
    match[1].replaceAll(/<[^>]+>/g, '')
  );
}

function menuRows(markup: string): string[] {
  return [...markup.matchAll(/<button\b[^>]*role="menuitem"[^>]*>(.*?)<\/button>|role="separator"/g)].map(
    (match) => (match[1] === undefined ? '---' : match[1].replaceAll(/<[^>]+>/g, ''))
  );
}

describe('context menu action order', () => {
  it('keeps every branch action in a fixed group order', () => {
    const markup = renderToStaticMarkup(
      <BranchContextMenuItems
        branchName="main"
        targetSha="abc123"
        currentBranchName="main"
        isCurrentBranch
        hasUpstream
        canSetBranchUpstream
        suggestedTagName="v2026.8.49"
        pullRequest={{ number: 7 } as never}
        isOperationBusy={false}
        onCheckoutBranch={vi.fn()}
        onPushBranch={vi.fn()}
        onPushBranchWithTag={vi.fn()}
        onPullBranch={vi.fn()}
        onReviewBranch={vi.fn()}
        onViewPullRequest={vi.fn()}
        onCreateTagAtCommit={vi.fn()}
        onCreateSuggestedTagAtCommit={vi.fn()}
        onMergeBranch={vi.fn()}
        onRebaseOntoBranch={vi.fn()}
        onInteractiveRebaseOntoBranch={vi.fn()}
        onRenameBranch={vi.fn()}
        onCopyBranchName={vi.fn()}
        onDeleteBranch={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(menuRows(markup)).toEqual([
      'Checkout main',
      'Push branch to remote',
      'Push remote &amp; Create tag v2026.8.49 &amp; push tag',
      'Pull',
      '---',
      'Review entire branch',
      'View pull request #7',
      '---',
      'Create tag here and push',
      'Create v2026.8.49 tag and push',
      '---',
      'Merge main into main',
      'Rebase main onto main',
      'Interactive rebase main onto main',
      '---',
      'Rename branch…',
      'Copy branch name',
      'Delete branch…'
    ]);
  });

  it('keeps integration actions in place when they are unavailable', () => {
    const markup = renderToStaticMarkup(
      <BranchContextMenuItems
        branchName="feature/menu-order"
        targetSha="abc123"
        isCurrentBranch={false}
        hasUpstream={false}
        canSetBranchUpstream={false}
        isOperationBusy={false}
        onCheckoutBranch={vi.fn()}
        onPushBranch={vi.fn()}
        onMergeBranch={vi.fn()}
        onRebaseOntoBranch={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(menuItemLabels(markup).slice(0, 2)).toEqual(['Checkout feature/menu-order', 'Push branch to remote']);
    expect(menuItemLabels(markup)).toContain('Merge feature/menu-order into current');
  });

  it('places tag clipboard and delete actions in the trailing group', () => {
    const markup = renderToStaticMarkup(
      <TagMenuItems
        tagName="v1.0.0"
        remoteName="origin"
        isOperationBusy={false}
        onPushTag={vi.fn()}
        onDeleteTag={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(menuRows(markup)).toEqual([
      'Push v1.0.0 to origin',
      '---',
      'Copy tag name',
      'Delete v1.0.0 locally',
      'Delete v1.0.0 from origin',
      'Delete v1.0.0 locally and from origin'
    ]);
  });
});
