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

  it('shows an accessible unread failure dot on the dashboards tab', () => {
    const markup = renderToStaticMarkup(
      <TabStrip
        tabs={[repositoryTab]}
        activeTabId={repositoryTab.id}
        isStartTabOpen={false}
        isStartTabActive={false}
        isDashboardsTabActive={false}
        dashboardUnreadCount={2}
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

    expect(markup).toContain(
      'aria-label="Dashboards, 2 unread workflow failures"'
    );
    expect(markup).toContain('class="dashboard-unread-dot"');
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
    expect(markup.match(/data-tab-drag-handle="true"/g)).toHaveLength(2);
    expect(markup).toContain(`data-tab-id="${repositoryTab.id}"`);
    expect(markup).toContain(`data-tab-id="${secondRepositoryTab.id}"`);
  });

  it('reserves space for the repository icon, dirty state, and close control', () => {
    const markup = renderToStaticMarkup(
      <TabStrip
        tabs={[repositoryTab]}
        activeTabId={repositoryTab.id}
        activeRepoDirty
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

    expect(markup).toContain('class="no-drag repo-tab repo-tab--repository group"');
    expect(markup).toContain('class="repo-tab-close"');
    expect(markup).toContain('data-repository-icon-fallback="true"');
    expect(markup).toContain('repo-tab-dirty size-2');
    expect(markup).toContain('size-5 shrink-0');
    expect(markup).not.toContain('lucide-git-branch');
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
