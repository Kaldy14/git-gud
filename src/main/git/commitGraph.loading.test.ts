import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { loadCommitGraph, loadCommitGraphAvatarUrls, loadCommitGraphWorktrees } from './commitGraph';
import { gitExecutor } from './exec';
import { loadGitHubCommitAuthorAvatars } from './githubAvatars';

vi.mock('./githubAvatars', async (importOriginal) => ({
  ...await importOriginal<typeof import('./githubAvatars')>(),
  loadGitHubCommitAuthorAvatars: vi.fn()
}));

it('returns local commit history while GitHub avatar lookup is pending', async () => {
  const repoPath = await mkdtemp(join(tmpdir(), 'git-gud-history-loading-'));
  let finishAvatars: (value: Map<string, string>) => void = () => {};
  const avatars = new Promise<Map<string, string>>((resolve) => { finishAvatars = resolve; });
  vi.mocked(loadGitHubCommitAuthorAvatars).mockReturnValue(avatars);
  let graph: Awaited<ReturnType<typeof loadCommitGraph>> | undefined;
  let loading: Promise<unknown> | undefined;

  try {
    await gitExecutor.run(['init', '-b', 'main'], { cwd: repoPath });
    await gitExecutor.run([
      '-c', 'user.name=History Test', '-c', 'user.email=history@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Local history is ready'
    ], { cwd: repoPath });
    await gitExecutor.run(['remote', 'add', 'origin', 'https://github.com/history-test/local.git'], { cwd: repoPath });

    loading = loadCommitGraph({ path: repoPath }, 50).then((page) => { graph = page; });
    await vi.waitFor(() => expect(graph?.rows[0]?.subject).toBe('Local history is ready'), { timeout: 1000 });
    expect(graph?.rows[0]?.author.avatarUrl).toContain('gravatar.com');
    expect(loadGitHubCommitAuthorAvatars).not.toHaveBeenCalled();
    const candidates = [{ sha: graph!.rows[0]!.sha, email: 'history@example.invalid', hasRemoteRef: false }];
    const enriching = loadCommitGraphAvatarUrls({ path: repoPath }, candidates);
    await vi.waitFor(() => expect(loadGitHubCommitAuthorAvatars).toHaveBeenCalledOnce());
    const url = 'https://avatars.githubusercontent.com/u/42';
    finishAvatars(new Map([['history@example.invalid', url]]));
    expect(await enriching).toEqual({ 'history@example.invalid': url });
  } finally {
    finishAvatars(new Map());
    await loading;
    await rm(repoPath, { recursive: true, force: true });
  }
});

it.each(['dirty', 'unavailable'] as const)('does not block history or pagination on a delayed %s linked worktree', async (outcome) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'git-gud-history-worktree-')));
  const repoPath = join(root, 'repo');
  const linkedPath = join(root, 'linked');
  let releaseStatus = () => {};
  const pendingStatus = new Promise<void>((resolve) => { releaseStatus = resolve; });
  let loadingWorktrees: ReturnType<typeof loadCommitGraphWorktrees> | undefined;
  const run = gitExecutor.run.bind(gitExecutor);
  try {
    await run(['init', '-b', 'main', repoPath], { cwd: root });
    for (const subject of ['first', 'second']) {
      await run(['-c', 'user.name=History Test', '-c', 'user.email=history@example.invalid',
        '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', subject], { cwd: repoPath });
    }
    await run(['worktree', 'add', '-b', 'linked', linkedPath], { cwd: repoPath });
    await writeFile(join(repoPath, 'local.txt'), 'local change');
    await writeFile(join(linkedPath, 'linked.txt'), 'linked change');
    let statusStarted = false;
    vi.spyOn(gitExecutor, 'run').mockImplementation(async (args, options) => {
      if (options.cwd === linkedPath && args[0] === 'status') {
        statusStarted = true;
        await pendingStatus;
        if (outcome === 'unavailable') throw new Error('Worktree unavailable');
      }
      return run(args, options);
    });
    loadingWorktrees = loadCommitGraphWorktrees({ path: repoPath });
    await vi.waitFor(() => expect(statusStarted).toBe(true));
    const firstPage = await loadCommitGraph({ path: repoPath }, 1, false);
    expect(firstPage.loadedCommitCount).toBe(1);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.rows.find((row) => row.sha === 'wip')?.files).toEqual([{ path: 'local.txt', status: 'added' }]);
    const nextPage = await loadCommitGraph({ path: repoPath }, 2, false);
    expect(nextPage.loadedCommitCount).toBe(2);
    expect(nextPage.hasMore).toBe(false);
    releaseStatus();
    const worktrees = await loadingWorktrees;
    expect(worktrees.inputs).toHaveLength(outcome === 'dirty' ? 1 : 0);
    if (outcome === 'dirty') expect(worktrees.inputs[0]?.files).toEqual([{ path: 'linked.txt', status: 'added' }]);
  } finally {
    releaseStatus();
    await loadingWorktrees;
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  }
});
