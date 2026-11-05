import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { CommitGraphRow, GraphNodeKind } from '@shared/types';
import { QuickJumpDialog } from './QuickJumpDialog';

function renderPalette(kinds: GraphNodeKind[]): string {
  const rows: CommitGraphRow[] = kinds.map((kind, index) => ({
    sha: `commit-${index}`, parentShas: [], subject: 'Change',
    author: { name: 'Author', initials: 'A', color: '#123456' }, dateLabel: 'Today',
    node: { lane: 0, kind }, rails: [], files: []
  }));
  return renderToStaticMarkup(
    <QuickJumpDialog tabs={[]} graphRows={rows} onClose={vi.fn()} onActivateTab={vi.fn()}
      onCheckoutBranch={vi.fn()} onCheckoutRemoteBranch={vi.fn()} />
  );
}

describe('palette commit scope', () => {
  it('counts merge commits, excluding working copies and stashes', () => {
    expect(renderPalette(['commit', 'merge', 'wip', 'stash'])).toContain('Searched 2 loaded commits');
  });

  it('uses the singular for a single loaded commit', () => {
    expect(renderPalette(['merge'])).toContain('Searched 1 loaded commit');
    expect(renderPalette(['merge'])).not.toContain('loaded commits');
  });

  it('does not claim a commit search scope when only working changes exist', () => {
    expect(renderPalette(['wip', 'stash'])).not.toContain('Searched');
  });
});
