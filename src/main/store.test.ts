import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  deleteDashboard,
  flushPendingWorkspaceWrites,
  getDashboards,
  openWorkspaceRepository,
  saveDashboard,
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
    const profileId = 'profile:dashboard-store-test';
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

    expect(saved.dashboards).toHaveLength(1);
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

    expect(deleteDashboard(profileId, saved.dashboards[0].id).dashboards).toEqual([]);
  });
});
