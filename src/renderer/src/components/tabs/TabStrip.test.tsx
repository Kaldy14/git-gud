import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { RepoTab } from '@shared/types';

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
});
