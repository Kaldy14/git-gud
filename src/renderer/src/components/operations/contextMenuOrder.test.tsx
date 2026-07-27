import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { BranchContextMenuPrimaryActions } from './BranchContextMenuPrimaryActions';
import { TagMenuItems } from './TagMenuItems';

function menuItemLabels(markup: string): string[] {
  return [...markup.matchAll(/<button\b[^>]*role="menuitem"[^>]*>(.*?)<\/button>/g)].map((match) =>
    match[1].replaceAll(/<[^>]+>/g, '')
  );
}

describe('context menu action order', () => {
  it('renders Push second in branch context menus', () => {
    const markup = renderToStaticMarkup(
      <BranchContextMenuPrimaryActions
        branchName="feature/menu-order"
        isCurrentBranch={false}
        isOperationBusy={false}
        onCheckoutBranch={vi.fn()}
        onPushBranch={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(menuItemLabels(markup)).toEqual(['Checkout feature/menu-order', 'Push branch to remote']);
  });

  it('renders Push second in tag context menus', () => {
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

    expect(menuItemLabels(markup).slice(0, 2)).toEqual(['Copy tag name', 'Push v1.0.0 to origin']);
  });
});
