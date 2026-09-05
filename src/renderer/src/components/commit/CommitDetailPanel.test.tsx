import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { CommitGraphRow, GitFileChangeDetail, GitWipDetail } from '@shared/types';

import { CommitDetailPanel } from './CommitDetailPanel';

const modifiedFile: GitFileChangeDetail = {
  path: 'modified.ts', status: 'modified', staged: false, unstaged: true, conflicted: false
};
const conflictedFile: GitFileChangeDetail = {
  path: 'conflicted.ts', status: 'conflicted', staged: false, unstaged: true, conflicted: true
};

function renderWip(files: GitFileChangeDetail[], isOperationBusy = false): string {
  const queryClient = new QueryClient();
  const row: CommitGraphRow = {
    sha: 'wip', parentShas: [], subject: 'Working changes',
    author: { name: 'Test', initials: 'T', color: '#000000' },
    dateLabel: 'Now', node: { lane: 0, kind: 'wip' }, rails: [], files: []
  };
  const detail: GitWipDetail = {
    kind: 'wip', repoPath: '/repo', branch: { head: 'main', isDetached: false, ahead: 0, behind: 0 },
    files, stagedCount: 0, unstagedCount: files.filter((file) => !file.conflicted).length,
    untrackedCount: 0, conflictedCount: files.filter((file) => file.conflicted).length,
    dirtyCount: files.length, loadedAt: '2026-09-05T00:00:00Z'
  };
  queryClient.setQueryData(['wip-detail', '/repo'], detail);

  try {
    return renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <CommitDetailPanel
          repoPath="/repo" row={row} commitFocusSignal={0} isOperationBusy={isOperationBusy}
          onSelectCommit={vi.fn()} onSelectFile={vi.fn()} onSetReviewOpen={vi.fn()}
          onOpenWipChanges={vi.fn()} onDiscardAllWip={vi.fn()} onDiscardWipFile={vi.fn()}
          onIgnoreWipFile={vi.fn()} onInspectWipFile={vi.fn()} onCopyWipFilePath={vi.fn()}
          onOpenWipFile={vi.fn()} onRevealWipFile={vi.fn()} onStashWipFile={vi.fn()}
        />
      </QueryClientProvider>
    );
  } finally {
    queryClient.clear();
  }
}

describe('WIP empty-state staging', () => {
  it.each([
    { label: 'ordinary changes', files: [modifiedFile], busy: false, disabled: false },
    { label: 'unresolved conflicts', files: [modifiedFile, conflictedFile], busy: false, disabled: true },
    { label: 'an active operation', files: [modifiedFile], busy: true, disabled: true }
  ])('respects the staging guard with $label', ({ files, busy, disabled }) => {
    const markup = renderWip(files, busy);
    const stageButtons = [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
      .filter(([, , contents]) => /Stage all|Stage All Changes/.test(contents));

    expect(stageButtons).toHaveLength(2);
    for (const [, attributes] of stageButtons) {
      expect(attributes.includes('disabled=""')).toBe(disabled);
    }
  });

  it('does not claim the working tree is clean when only conflicts remain', () => {
    const markup = renderWip([conflictedFile]);

    expect(markup).toContain('Conflicts (1)');
    expect(markup).not.toContain('working tree clean');
  });
});
