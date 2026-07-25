import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  deleteDashboard,
  flushPendingWorkspaceWrites,
  getDashboards,
  openWorkspaceRepository,
  saveDashboard,
  selectDashboard,
  selectWorkspaceCommit,
  selectWorkspaceFile
} from './store';

describe('workspace persistence', () => {
  it('flushes deferred commit and file selections before shutdown', async () => {
    const repoPath = '/tmp/git-gud-store-test-repo';
    const workspace = openWorkspaceRepository({
      path: repoPath,
      name: 'store-test-repo',
      gitDir: `${repoPath}/.git`,
      commonDir: `${repoPath}/.git`
    });
    const tabId = workspace.activeTabId;

    if (!tabId) {
      throw new Error('Expected the test repository to open a tab.');
    }

    selectWorkspaceCommit(tabId, 'abc123');
    selectWorkspaceFile(tabId, 'src/index.ts');
    flushPendingWorkspaceWrites();

    const stored = await readFile(
      join(tmpdir(), 'git-gud-vitest-store', 'workspace', 'git-gud-workspace.json'),
      'utf8'
    );
    expect(stored).toContain('abc123');
    expect(stored).toContain('src/index.ts');
  });

  it('persists profile-scoped dashboards and their GitHub Actions tiles', () => {
    const profileId = `profile:dashboard-store-test:${randomUUID()}`;
    const saved = saveDashboard({
      profileId,
      name: 'Release health',
      tiles: [
        {
          kind: 'github-actions',
          owner: 'acme',
          repository: 'widgets',
          limit: 10
        }
      ]
    });
    const firstDashboardId = saved.dashboards[0]?.id;

    expect(saved.dashboards).toHaveLength(1);
    expect(saved.selectedDashboardId).toBe(firstDashboardId);
    expect(saved.dashboards[0]).toMatchObject({
      profileId,
      name: 'Release health',
      tiles: [
        {
          kind: 'github-actions',
          owner: 'acme',
          repository: 'widgets',
          limit: 10
        }
      ]
    });
    expect(getDashboards(profileId)).toEqual(saved);

    const withSecondDashboard = saveDashboard({
      profileId,
      name: 'Main branch',
      tiles: []
    });
    const secondDashboardId = withSecondDashboard.dashboards[1]?.id;

    if (!firstDashboardId || !secondDashboardId) {
      throw new Error('Expected both dashboards to be saved.');
    }

    expect(selectDashboard(profileId, secondDashboardId).selectedDashboardId).toBe(
      secondDashboardId
    );
    expect(getDashboards(profileId).selectedDashboardId).toBe(secondDashboardId);
    expect(deleteDashboard(profileId, secondDashboardId).selectedDashboardId).toBe(
      firstDashboardId
    );
    expect(deleteDashboard(profileId, firstDashboardId).dashboards).toEqual([]);
  });
});
