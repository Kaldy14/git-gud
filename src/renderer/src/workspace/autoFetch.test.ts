import { describe, expect, it, vi } from 'vitest';

import {
  AUTO_FETCH_STALE_AFTER_MS,
  autoFetchRepositoryOnTabActivation,
  createRepositoryAutoFetchCoordinator,
  shouldAutoFetchRepository
} from './autoFetch';

const now = Date.parse('2026-07-26T12:00:00.000Z');
const remote = { name: 'origin', fetchUrl: 'git@example.com:acme/project.git' };

describe('automatic repository fetch on tab activation', () => {
  it('fetches a repository whose last fetch is old', async () => {
    const fetchRepository = vi.fn(async () => true);

    await expect(
      autoFetchRepositoryOnTabActivation({
        loadRepository: async () => ({
          lastFetchedAt: new Date(now - AUTO_FETCH_STALE_AFTER_MS).toISOString(),
          remotes: [remote]
        }),
        fetchRepository,
        now
      })
    ).resolves.toBe('succeeded');
    expect(fetchRepository).toHaveBeenCalledOnce();
  });

  it('does not fetch a repository that was fetched recently', async () => {
    const fetchRepository = vi.fn(async () => true);

    await expect(
      autoFetchRepositoryOnTabActivation({
        loadRepository: async () => ({
          lastFetchedAt: new Date(now - AUTO_FETCH_STALE_AFTER_MS + 1).toISOString(),
          remotes: [remote]
        }),
        fetchRepository,
        now
      })
    ).resolves.toBe('skipped');
    expect(fetchRepository).not.toHaveBeenCalled();
  });

  it('skips repositories without remotes even when they have never been fetched', () => {
    expect(shouldAutoFetchRepository({ remotes: [] }, now)).toBe(false);
  });

  it('fetches repositories with remotes when there is no fetch history', () => {
    expect(shouldAutoFetchRepository({ remotes: [remote] }, now)).toBe(true);
  });

  it('retries the latest linked-worktree activation after an overlapping fetch fails', async () => {
    const coordinator = createRepositoryAutoFetchCoordinator<{ commonDir: string; path: string }>();
    let finishFirstFetch: (result: 'failed') => void = () => {};
    const firstFetch = new Promise<'failed'>((resolve) => {
      finishFirstFetch = resolve;
    });
    const run = vi
      .fn<(repository: { commonDir: string; path: string }) => Promise<'failed' | 'skipped'>>()
      .mockReturnValueOnce(firstFetch)
      .mockResolvedValueOnce('skipped');

    coordinator.schedule({ commonDir: '/repo/.git', path: '/repo/main' }, run);
    coordinator.schedule({ commonDir: '/repo/.git', path: '/repo/linked' }, run);
    expect(run).toHaveBeenCalledTimes(1);

    finishFirstFetch('failed');
    await firstFetch;
    await Promise.resolve();

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0].path).toBe('/repo/linked');
  });

  it('suppresses an overlapping linked-worktree request after a successful fetch', async () => {
    const coordinator = createRepositoryAutoFetchCoordinator<{ commonDir: string; path: string }>();
    let finishFirstFetch: (result: 'succeeded') => void = () => {};
    const firstFetch = new Promise<'succeeded'>((resolve) => {
      finishFirstFetch = resolve;
    });
    const run = vi.fn(() => firstFetch);

    coordinator.schedule({ commonDir: '/repo/.git', path: '/repo/main' }, run);
    coordinator.schedule({ commonDir: '/repo/.git', path: '/repo/linked' }, run);
    finishFirstFetch('succeeded');
    await firstFetch;
    await Promise.resolve();

    expect(run).toHaveBeenCalledOnce();
  });
});
