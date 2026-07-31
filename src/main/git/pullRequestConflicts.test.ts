import { afterEach, describe, expect, it, vi } from 'vitest';

import { gitExecutor, type GitCommandResult } from './exec';
import {
  loadPullRequestConflictDetails,
  parseMergeTreeConflictPaths
} from './pullRequestConflicts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadPullRequestConflictDetails', () => {
  it('uses a non-checkout merge preview and returns its conflict paths', async () => {
    const run = vi.spyOn(gitExecutor, 'run')
      .mockResolvedValueOnce(gitResult(0))
      .mockResolvedValueOnce(gitResult(0))
      .mockResolvedValueOnce(
        gitResult(
          1,
          'bbf2b97e9c2dd726d03fee5ec774811faed897b1\0src/app.ts\0README.md\0'
        )
      );

    await expect(
      loadPullRequestConflictDetails(
        { path: '/repo', assignedProfileId: undefined },
        { baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40) }
      )
    ).resolves.toEqual({
      files: ['src/app.ts', 'README.md']
    });
    expect(run).toHaveBeenLastCalledWith(
      [
        'merge-tree',
        '--write-tree',
        '--name-only',
        '--no-messages',
        '-z',
        'a'.repeat(40),
        'b'.repeat(40)
      ],
      expect.objectContaining({
        cwd: '/repo',
        allowedExitCodes: [0, 1]
      })
    );
  });

  it('explains when the checkout does not contain both revisions', async () => {
    vi.spyOn(gitExecutor, 'run')
      .mockResolvedValueOnce(gitResult(128))
      .mockResolvedValueOnce(gitResult(0));

    await expect(
      loadPullRequestConflictDetails(
        { path: '/repo', assignedProfileId: undefined },
        { baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40) }
      )
    ).resolves.toEqual({
      files: [],
      unavailableReason: 'The base or head revision is not available in this local checkout.'
    });
  });
});

describe('parseMergeTreeConflictPaths', () => {
  it('removes the result tree and returns unique conflict paths', () => {
    expect(
      parseMergeTreeConflictPaths(
        'bbf2b97e9c2dd726d03fee5ec774811faed897b1\0src/app.ts\0README.md\0src/app.ts\0'
      )
    ).toEqual(['src/app.ts', 'README.md']);
  });

  it('returns no paths for a clean merge result', () => {
    expect(
      parseMergeTreeConflictPaths('bbf2b97e9c2dd726d03fee5ec774811faed897b1\0')
    ).toEqual([]);
  });
});

function gitResult(exitCode: number, stdout = ''): GitCommandResult {
  return {
    args: [],
    cwd: '/repo',
    stdout,
    stderr: '',
    exitCode
  };
}
