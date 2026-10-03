import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoTab } from '@shared/types';

import { RepositoryAutoFetch } from './autoFetch';

const repository: Pick<RepoTab, 'path' | 'commonDir' | 'assignedProfileId'> = { path: '/repo', commonDir: '/repo/.git', assignedProfileId: undefined };

describe('main-process automatic fetching', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function create(implementation: (tab: typeof repository, operationId: string) => Promise<'succeeded' | 'skipped'> = async () => 'succeeded') {
    const fetch = vi.fn(implementation);
    const cancel = vi.fn();
    const lastFetchedAt = vi.fn<() => string | undefined>(() => undefined);
    const scheduler = new RepositoryAutoFetch({ fetch, cancel, lastFetchedAt });
    return { scheduler, fetch, cancel, lastFetchedAt };
  }

  it('fetches inactive open repositories once per common directory without a renderer', async () => {
    const { scheduler, fetch } = create();
    scheduler.sync([repository, { ...repository, path: '/linked' }, { ...repository, path: '/other', commonDir: '/other/.git' }], 1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetch.mock.calls.map(([tab]) => tab.path)).toEqual(['/repo', '/other']);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(fetch).toHaveBeenCalledTimes(3);
    scheduler.stop();
  });

  it('interrupts a slow fetch for a user action, waits for cleanup, and does not immediately restart it', async () => {
    const events: string[] = [];
    let finishFetch: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { finishFetch = resolve; });
    const { scheduler, fetch, cancel } = create(vi.fn(async () => {
      events.push('fetch started');
      await gate;
      events.push('fetch cleaned up');
      return 'succeeded' as const;
    }));
    cancel.mockImplementation(() => { events.push('cancel requested'); finishFetch?.(); });
    scheduler.sync([repository], 1);
    await vi.advanceTimersByTimeAsync(1000);
    await scheduler.runForeground(repository.commonDir, async () => { events.push('user action'); });
    expect(cancel).toHaveBeenCalledOnce();
    expect(events).toEqual(['fetch started', 'cancel requested', 'fetch cleaned up', 'user action']);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(fetch).toHaveBeenCalledOnce();
    scheduler.stop();
  });

  it('never overlaps background fetches or starts one while a foreground mutation is reserved', async () => {
    let finish: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const { scheduler, fetch } = create();
    scheduler.sync([repository], 1);
    const foreground = scheduler.runForeground(repository.commonDir, () => gate);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetch).not.toHaveBeenCalled();
    finish?.();
    await foreground;
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledOnce();
    scheduler.stop();
  });

  it('backs off repeated failures and respects manual fetch timestamps', async () => {
    const { scheduler, fetch, lastFetchedAt } = create(vi.fn(async () => { throw new Error('offline'); }));
    scheduler.sync([repository], 1);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(3);
    lastFetchedAt.mockReturnValue(new Date(Date.now() + 300_000).toISOString());
    await vi.advanceTimersByTimeAsync(300_000);
    expect(fetch).toHaveBeenCalledTimes(3);
    scheduler.stop();
  });

  it('cancels on disable or close and shuts down without leaving a timer', async () => {
    let finish: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const { scheduler, cancel, fetch } = create(vi.fn(async () => { await gate; return 'succeeded' as const; }));
    scheduler.sync([repository], 1);
    await vi.advanceTimersByTimeAsync(1000);
    scheduler.sync([], 1);
    expect(cancel).toHaveBeenCalledOnce();
    finish?.();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetch).toHaveBeenCalledOnce();
    scheduler.sync([repository], 0);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetch).toHaveBeenCalledOnce();
    scheduler.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a fetch using an identity that was replaced by a profile switch', async () => {
    let finish: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const { scheduler, cancel } = create(async () => { await gate; return 'succeeded'; });
    scheduler.sync([{ ...repository, assignedProfileId: 'old-profile' }], 1);
    await vi.advanceTimersByTimeAsync(1000);
    scheduler.sync([{ ...repository, assignedProfileId: 'new-profile' }], 1);
    expect(cancel).toHaveBeenCalledOnce();
    finish?.();
    await vi.advanceTimersByTimeAsync(0);
    scheduler.stop();
  });

  it('keeps only one network fetch active across multiple repositories', async () => {
    let finish: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const { scheduler, fetch } = create(async () => { await gate; return 'succeeded'; });
    scheduler.sync([repository, { ...repository, path: '/other', commonDir: '/other/.git' }], 1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetch).toHaveBeenCalledOnce();
    finish?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('handles a far-future stored timestamp without overflowing or spinning its timer', async () => {
    const { scheduler, fetch, lastFetchedAt } = create();
    lastFetchedAt.mockReturnValue(new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString());
    scheduler.sync([repository], 1);
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    scheduler.stop();
  });
});
