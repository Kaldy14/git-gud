import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { RepoTab } from '@shared/types';

import { resolveTabDropIndex } from './tabReordering';
import { TabStrip } from './TabStrip';

const repositoryTab: RepoTab = {
  id: 'repo:/projects/git-gud',
  path: '/projects/git-gud',
  name: 'git-gud',
  gitDir: '/projects/git-gud/.git',
  commonDir: '/projects/git-gud/.git',
  openedAt: '2026-07-26T00:00:00.000Z',
  lastOpenedAt: '2026-07-26T00:00:00.000Z',
  viewMode: 'graph'
};

const secondRepositoryTab: RepoTab = {
  ...repositoryTab,
  id: 'repo:/projects/second',
  path: '/projects/second',
  name: 'second',
  gitDir: '/projects/second/.git',
  commonDir: '/projects/second/.git'
};

describe('TabStrip', () => {
  it('renders dashboards as an active icon-only workspace tab without a close control', () => {
    const markup = renderToStaticMarkup(
      <TabStrip
        tabs={[repositoryTab]}
        activeTabId={undefined}
        isStartTabOpen={false}
        isStartTabActive={false}
        isDashboardsTabActive
        onActivateTab={vi.fn()}
        onReorderTab={vi.fn()}
        onCloseTab={vi.fn()}
        onOpenStartTab={vi.fn()}
        onActivateStartTab={vi.fn()}
        onCloseStartTab={vi.fn()}
        onActivateDashboardsTab={vi.fn()}
        onOpenSettings={vi.fn()}
        onActivateProfile={vi.fn(async () => {})}
        onSaveAndActivateProfile={vi.fn(async () => {})}
      />
    );

    expect(markup).toContain('aria-label="Workspace views"');
    expect(markup).toContain('aria-label="Dashboards"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).not.toContain('Close Dashboards');
  });

  it('marks repository tabs as reorderable when their order can change', () => {
    const markup = renderToStaticMarkup(
      <TabStrip
        tabs={[repositoryTab, secondRepositoryTab]}
        activeTabId={repositoryTab.id}
        isStartTabOpen={false}
        isStartTabActive={false}
        isDashboardsTabActive={false}
        onActivateTab={vi.fn()}
        onReorderTab={vi.fn()}
        onCloseTab={vi.fn()}
        onOpenStartTab={vi.fn()}
        onActivateStartTab={vi.fn()}
        onCloseStartTab={vi.fn()}
        onActivateDashboardsTab={vi.fn()}
        onOpenSettings={vi.fn()}
        onActivateProfile={vi.fn(async () => {})}
        onSaveAndActivateProfile={vi.fn(async () => {})}
      />
    );

    expect(markup.match(/data-reorderable="true"/g)).toHaveLength(2);
    expect(markup).toContain(`data-tab-id="${repositoryTab.id}"`);
    expect(markup).toContain(`data-tab-id="${secondRepositoryTab.id}"`);
  });

  it('resolves before and after drops to final tab indexes', () => {
    const tabIds = ['alpha', 'beta', 'gamma'];

    expect(resolveTabDropIndex(tabIds, 'alpha', 'gamma', 'before')).toBe(1);
    expect(resolveTabDropIndex(tabIds, 'alpha', 'gamma', 'after')).toBe(2);
    expect(resolveTabDropIndex(tabIds, 'gamma', 'alpha', 'before')).toBe(0);
    expect(resolveTabDropIndex(tabIds, 'beta', 'beta', 'after')).toBe(1);
    expect(resolveTabDropIndex(tabIds, 'missing', 'alpha', 'before')).toBeUndefined();
  });
});
