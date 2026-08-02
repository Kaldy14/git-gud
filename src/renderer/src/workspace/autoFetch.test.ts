import { describe, expect, it, vi } from 'vitest';

import {
  autoFetchIntervalMilliseconds,
  autoFetchRepository,
  createRepositoryAutoFetchCoordinator,
  shouldAutoFetchRepository
} from './autoFetch';

const now = Date.parse('2026-07-26T12:00:00.000Z');
const remote = { name: 'origin', fetchUrl: 'git@example.com:acme/project.git' };

describe('automatic repository fetch', () => {
  it('fetches a repository whose last fetch is old', async () => {
    const fetchRepository = vi.fn(async () => true);

    await expect(
      autoFetchRepository({
        intervalMinutes: 1,
        loadRepository: async () => ({
          lastFetchedAt: new Date(now - autoFetchIntervalMilliseconds(1)).toISOString(),
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
      autoFetchRepository({
        intervalMinutes: 1,
        loadRepository: async () => ({
          lastFetchedAt: new Date(now - autoFetchIntervalMilliseconds(1) + 1).toISOString(),
          remotes: [remote]
        }),
        fetchRepository,
        now
      })
    ).resolves.toBe('skipped');
    expect(fetchRepository).not.toHaveBeenCalled();
  });

  it('skips repositories without remotes even when they have never been fetched', () => {
    expect(shouldAutoFetchRepository({ remotes: [] }, 1, now)).toBe(false);
  });

  it('fetches repositories with remotes when there is no fetch history', () => {
    expect(shouldAutoFetchRepository({ remotes: [remote] }, 1, now)).toBe(true);
  });

  it('does not fetch when automatic fetching is disabled', () => {
    expect(shouldAutoFetchRepository({ remotes: [remote] }, 0, now)).toBe(false);
  });

  it('uses the configured interval to decide when a repository is stale', () => {
    const repository = {
      lastFetchedAt: new Date(now - autoFetchIntervalMilliseconds(5)).toISOString(),
      remotes: [remote]
    };

    expect(shouldAutoFetchRepository(repository, 5, now)).toBe(true);
    expect(shouldAutoFetchRepository(repository, 6, now)).toBe(false);
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

  it('cancels a queued retry when its repository is no longer active', async () => {
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
    const cancelQueued = coordinator.schedule(
      { commonDir: '/repo/.git', path: '/repo/linked' },
      run
    );
    cancelQueued();
    finishFirstFetch('failed');
    await firstFetch;
    await Promise.resolve();

    expect(run).toHaveBeenCalledOnce();
  });
});
