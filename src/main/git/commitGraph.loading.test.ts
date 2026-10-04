import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { loadCommitGraph, loadCommitGraphAvatarUrls } from './commitGraph';
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
