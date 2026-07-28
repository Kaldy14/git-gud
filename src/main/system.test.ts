import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const { openExternal } = vi.hoisted(() => ({
  openExternal: vi.fn<(...args: unknown[]) => Promise<void>>()
}));

vi.mock('electron', () => ({
  shell: {
    openExternal
  }
}));

import {
  addCodexWorktreeContext,
  openCodexTaskForRepository,
  resolveCodexProjectPath
} from './system';

describe('Codex task handoff', () => {
  it('keeps a primary checkout as the Codex project and working directory', () => {
    const repositoryPath = '/Users/example/Data/Vosime/hive';

    expect(
      resolveCodexProjectPath({
        path: repositoryPath,
        gitDir: `${repositoryPath}/.git`,
        commonDir: `${repositoryPath}/.git`
      })
    ).toBe(repositoryPath);
    expect(addCodexWorktreeContext('Fix the review feedback.', repositoryPath, repositoryPath)).toBe(
      'Fix the review feedback.'
    );
  });

  it('groups a linked worktree under its primary checkout and preserves the worktree for execution', () => {
    const projectPath = '/Users/example/Data/Vosime/hive';
    const worktreePath = '/Users/example/.codex/worktrees/3243/hive';

    expect(
      resolveCodexProjectPath({
        path: worktreePath,
        gitDir: `${projectPath}/.git/worktrees/hive`,
        commonDir: `${projectPath}/.git`
      })
    ).toBe(projectPath);
    expect(addCodexWorktreeContext('Fix the review feedback.', worktreePath, projectPath)).toBe(
      [
        'Use the existing Git worktree below as the working directory for this task.',
        `Worktree: ${JSON.stringify(worktreePath)}`,
        'Run all repository reads, edits, Git commands, and validation there. Do not create a new worktree or modify the primary checkout.',
        'Fix the review feedback.'
      ].join('\n\n')
    );
  });

  it('falls back to the opened checkout for nonstandard shared Git directories', () => {
    const worktreePath = '/Users/example/worktrees/hive';

    expect(
      resolveCodexProjectPath({
        path: worktreePath,
        gitDir: '/Users/example/git-data/worktrees/hive',
        commonDir: '/Users/example/git-data'
      })
    ).toBe(worktreePath);
  });

  it('opens the canonical Codex project with the existing worktree in the task prompt', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-codex-handoff-'));
    const projectPath = join(rootPath, 'Data', 'Vosime', 'hive');
    const worktreePath = join(rootPath, '.codex', 'worktrees', '3243', 'hive');
    const commonDir = join(projectPath, '.git');

    try {
      await Promise.all([
        mkdir(commonDir, { recursive: true }),
        mkdir(worktreePath, { recursive: true })
      ]);
      openExternal.mockResolvedValueOnce();

      await openCodexTaskForRepository(
        {
          path: worktreePath,
          gitDir: join(commonDir, 'worktrees', 'hive'),
          commonDir
        },
        'Fix the review feedback.'
      );

      const deepLink = new URL(String(openExternal.mock.calls.at(-1)?.[0]));
      expect(deepLink.searchParams.get('path')).toBe(projectPath);
      expect(deepLink.searchParams.get('prompt')).toBe(
        addCodexWorktreeContext('Fix the review feedback.', worktreePath, projectPath)
      );
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});
