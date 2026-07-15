import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  flushPendingWorkspaceWrites,
  openWorkspaceRepository,
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
});
