import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { CommitGraphRow, GitCommitDetail, GitFileChangeDetail, GitWipDetail } from '@shared/types';

import { ChangedFilesTree, CommitDetailPanel } from './CommitDetailPanel';

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

function renderCommit(detail: GitCommitDetail): string {
  const queryClient = new QueryClient();
  const row: CommitGraphRow = {
    sha: detail.sha, parentShas: detail.parentShas, subject: detail.subject,
    author: { name: detail.author.name, initials: 'DT', color: '#000000' },
    dateLabel: 'Now', node: { lane: 0, kind: 'commit' }, rails: [], files: []
  };
  queryClient.setQueryData(['commit-detail', detail.repoPath, detail.sha], detail);

  try {
    return renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <CommitDetailPanel
          repoPath={detail.repoPath} row={row} commitFocusSignal={0} isOperationBusy={false}
          remoteAvatars onSelectCommit={vi.fn()} onSelectFile={vi.fn()} onSetReviewOpen={vi.fn()}
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

describe('commit co-author attribution', () => {
  it('renders co-author avatars and names instead of raw trailers', () => {
    const markup = renderCommit({
      kind: 'commit', repoPath: '/repo', sha: 'abc123', shortSha: 'abc123', parentShas: ['parent'],
      subject: 'Shared change',
      body: 'Useful context.\n\nCo-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>',
      bodyWithoutCoAuthors: 'Useful context.',
      message: 'Shared change\n\nUseful context.\n\nCo-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>',
      author: { name: 'Details Test', email: 'details@example.test', date: '2026-09-21T10:00:00Z' },
      coAuthors: [{
        name: 'Claude Opus 4.6', email: 'noreply@anthropic.com',
        avatarUrl: 'https://www.gravatar.com/avatar/claude?s=96'
      }],
      committer: { name: 'Details Test', email: 'details@example.test', date: '2026-09-21T10:00:00Z' },
      stats: { filesChanged: 0, additions: 0, deletions: 0 }, files: [], loadedAt: '2026-09-21T10:00:00Z'
    });

    expect(markup).toContain('data-testid="commit-attribution"');
    expect(markup).toContain('Details Test and Claude Opus 4.6');
    expect(markup).toContain('https://www.gravatar.com/avatar/claude?s=96');
    expect(markup).not.toContain('Co-Authored-By:');
  });
});

describe('changed files tree folder staging', () => {
  function renderTree(
    files: GitFileChangeDetail[],
    { isWip = true, isMutating = false, selectedPath }: { isWip?: boolean; isMutating?: boolean; selectedPath?: string } = {}
  ): string {
    return renderToStaticMarkup(
      <ChangedFilesTree
        files={files} isWip={isWip} isMutating={isMutating} selectedPath={selectedPath} onSelectPath={vi.fn()}
        onStageFile={vi.fn()} onUnstageFile={vi.fn()} onStageAll={vi.fn()} onUnstageAll={vi.fn()}
        onDiscardWipFile={vi.fn()} onIgnoreWipFile={vi.fn()} onInspectWipFile={vi.fn()}
        onCopyWipFilePath={vi.fn()} onOpenWipFile={vi.fn()} onRevealWipFile={vi.fn()} onStashWipFile={vi.fn()}
      />
    );
  }

  function buttons(markup: string): { attributes: string; text: string }[] {
    return [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
      .map(([, attributes = '', inner = '']) => ({ attributes, text: inner.replace(/<[^>]+>/g, '') }));
  }

  function labelledButton(markup: string, label: string): string | undefined {
    return buttons(markup).find(({ attributes }) => attributes.includes(`aria-label="${label}"`))?.attributes;
  }

  function textButton(markup: string, text: string): string | undefined {
    return buttons(markup).find((button) => button.text.trim() === text)?.attributes;
  }

  function section(markup: string, label: string): string {
    const start = markup.indexOf(`aria-label="${label}"`);
    expect(start).toBeGreaterThan(-1);
    const end = markup.indexOf('</ul>', start);
    return markup.slice(start, end);
  }

  const nestedUnstaged: GitFileChangeDetail = {
    path: 'grafana/alerts/rds.md', status: 'untracked', staged: false, unstaged: true, conflicted: false
  };
  const nestedStaged: GitFileChangeDetail = {
    path: 'grafana/README.md', status: 'modified', staged: true, unstaged: false, conflicted: false
  };
  const partiallyStaged: GitFileChangeDetail = {
    path: 'src/both.ts', status: 'modified', staged: true, unstaged: true, conflicted: false
  };
  const nestedConflict: GitFileChangeDetail = {
    path: 'grafana/merge.md', status: 'conflicted', staged: false, unstaged: true, conflicted: true
  };

  it('renders WIP trees in the Path view group order with counts and bulk actions', () => {
    const markup = renderTree([nestedUnstaged, nestedStaged, partiallyStaged, nestedConflict]);
    const order = ['Conflicts (1)', 'Unstaged Files (2)', 'Staged Files (2)'].map((label) => markup.indexOf(label));

    expect(order.every((index) => index > -1)).toBe(true);
    expect(order).toEqual([...order].sort((left, right) => left - right));
    expect(textButton(markup, 'Stage All Changes')).toBeDefined();
    expect(textButton(markup, 'Unstage All')).toBeDefined();
    expect(markup).toContain('aria-label="Conflicted files"');
  });

  it('lists partially staged files in both groups with placement-specific actions', () => {
    const markup = renderTree([partiallyStaged], { selectedPath: partiallyStaged.path });
    const unstaged = section(markup, 'Unstaged files');
    const staged = section(markup, 'Staged files');

    expect(labelledButton(unstaged, 'Stage Folder src')).toContain('data-tone="stage"');
    expect(labelledButton(unstaged, 'Stage File src/both.ts')).toBeDefined();
    expect(labelledButton(unstaged, 'Unstage File src/both.ts')).toBeUndefined();
    expect(labelledButton(staged, 'Unstage Folder src')).toContain('data-tone="unstage"');
    expect(labelledButton(staged, 'Unstage File src/both.ts')).toBeDefined();
    expect(labelledButton(staged, 'Stage Folder src')).toBeUndefined();
  });

  it('reveals a selected file only in the groups that contain it', () => {
    const markup = renderTree([nestedUnstaged, nestedStaged], { selectedPath: nestedUnstaged.path });

    expect(section(markup, 'Unstaged files')).toContain('aria-label="Stage File grafana/alerts/rds.md"');
    expect(section(markup, 'Staged files')).toContain('aria-expanded="false"');
  });

  it('blocks folder staging when a conflict in another group shares the real folder', () => {
    const markup = renderTree([nestedUnstaged, nestedStaged, nestedConflict]);

    expect(labelledButton(section(markup, 'Unstaged files'), 'Stage Folder grafana')).toContain('disabled=""');
    expect(labelledButton(section(markup, 'Staged files'), 'Unstage Folder grafana')).toContain('disabled=""');
    expect(section(markup, 'Conflicted files')).not.toContain('Folder grafana');
  });

  it('keeps unrelated folders actionable beside conflicts elsewhere', () => {
    const markup = renderTree([partiallyStaged, nestedConflict]);

    expect(labelledButton(markup, 'Stage Folder src')).not.toContain('disabled=""');
  });

  it.each([
    { label: 'unresolved conflicts', files: [nestedUnstaged, nestedStaged, nestedConflict], busy: false, unstageDisabled: false },
    { label: 'an active operation', files: [nestedUnstaged, nestedStaged], busy: true, unstageDisabled: true }
  ])('guards bulk and folder staging with $label', ({ files, busy, unstageDisabled }) => {
    const markup = renderTree(files, { isMutating: busy });

    expect(textButton(markup, 'Stage All Changes')).toContain('disabled=""');
    expect(labelledButton(markup, 'Stage Folder grafana')).toContain('disabled=""');
    expect(textButton(markup, 'Unstage All')?.includes('disabled=""')).toBe(unstageDisabled);
  });

  it.each([
    { label: 'unstaged', files: [nestedStaged], empty: 'No unstaged changes.', missing: 'Stage All Changes' },
    { label: 'staged', files: [nestedUnstaged], empty: 'No staged files.', missing: 'Unstage All' }
  ])('shows the $label empty state without its bulk action', ({ files, empty, missing }) => {
    const markup = renderTree(files);

    expect(markup).toContain(empty);
    expect(textButton(markup, missing)).toBeUndefined();
  });

  it('keeps commit trees as one read-only hierarchy', () => {
    const markup = renderTree([nestedUnstaged, partiallyStaged], { isWip: false });

    expect(markup).toContain('aria-label="Changed files"');
    expect(markup).not.toContain('Unstaged Files');
    expect(markup).not.toContain('Stage Folder');
    expect(markup).not.toContain('wip-file-primary-action');
  });

  it('omits folders whose descendants have no WIP changes', () => {
    const markup = renderTree([{ ...nestedStaged, status: 'unmodified', staged: false }]);

    expect(labelledButton(markup, 'Stage Folder grafana')).toBeUndefined();
    expect(labelledButton(markup, 'Unstage Folder grafana')).toBeUndefined();
  });
});
