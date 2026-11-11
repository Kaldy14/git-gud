import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { GitRepositoryOverview, RepoTab } from '@shared/types';

import { Toolbar } from './Toolbar';

const noop = (): void => undefined;

const activeTab = { id: 'tab-1', path: '/repos/robot', name: 'robot' } as unknown as RepoTab;

function overview(remoteNames: string[] = ['origin']): GitRepositoryOverview {
  return {
    status: {
      branch: { head: 'main', oid: 'abc1234', ahead: 0, behind: 0, isDetached: false },
      dirtyCount: 0,
      conflictedCount: 0
    },
    conflictState: { isActive: false, files: [] },
    remotes: remoteNames.map((name) => ({ name })),
    stashes: []
  } as unknown as GitRepositoryOverview;
}

function renderToolbar(props: Partial<ComponentProps<typeof Toolbar>> = {}): string {
  return renderToStaticMarkup(
    <Toolbar
      activeTab={activeTab}
      repositoryOverview={overview()}
      isBusy={false}
      defaultSyncOperation="fetch-all"
      releaseTagName="v1.4.0"
      onSync={noop}
      onChangeDefaultSyncOperation={noop}
      onPush={noop}
      onCreateBranch={noop}
      onStashPush={noop}
      onStashPop={noop}
      onUndo={noop}
      onOpenQuickJump={noop}
      onMergeSelected={noop}
      onRebaseSelected={noop}
      onInteractiveRebaseSelected={noop}
      onTagSelected={noop}
      onCreateRelease={noop}
      onOpenRepositoryMaintenance={noop}
      hasSelectedCommit={false}
      applications={[]}
      onOpenInApplication={noop}
      {...props}
    />
  );
}

function releaseButton(markup: string): string {
  const button = /<button[^>]*aria-label="Release"[^>]*>/.exec(markup)?.[0];

  if (!button) {
    throw new Error('Release button was not rendered');
  }

  return button;
}

describe('Toolbar Release action', () => {
  it('is a one-click toolbar button after Push that names the automatic tag', () => {
    const markup = renderToolbar();
    const button = releaseButton(markup);

    expect(button).not.toContain('disabled');
    expect(button).toContain('title="Create release v1.4.0 from latest origin/main and push to origin"');
    expect(markup).toContain('lucide-rocket');
    expect(markup.indexOf('aria-label="Push"')).toBeLessThan(markup.indexOf('aria-label="Release"'));
    expect(markup.indexOf('aria-label="Release"')).toBeLessThan(markup.indexOf('aria-label="Branch"'));
  });

  it.each([
    ['the repository is loading', { repositoryOverview: undefined }, 'Loading repository state'],
    ['there is no origin remote', { repositoryOverview: overview(['upstream']) }, 'Add a remote named origin to create a release'],
    [
      'no tag name can be suggested',
      { releaseTagName: undefined },
      'No automatic release tag name can be determined from the existing tags'
    ]
  ] as const)('is disabled and explains why when %s', (_, props, hint) => {
    const button = releaseButton(renderToolbar(props));

    expect(button).toContain('disabled=""');
    expect(button).toContain(`title="${hint}"`);
  });

  it('is disabled while another Git operation runs', () => {
    const button = releaseButton(renderToolbar({ isBusy: true }));

    expect(button).toContain('disabled=""');
    expect(button).toContain('title="Create release v1.4.0 from latest origin/main and push to origin"');
  });

  it('is disabled without an open repository', () => {
    expect(releaseButton(renderToolbar({ activeTab: undefined, repositoryOverview: undefined }))).toContain('disabled=""');
  });
});
