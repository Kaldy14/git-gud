import { describe, expect, it, vi } from 'vitest';

import { createRepositoryOperationQueue } from './repositoryOperationQueue';

describe('repository operation queue', () => {
  it('queues a tag action behind a slow automatic fetch instead of dropping it', async () => {
    const queue = createRepositoryOperationQueue();
    let finishFetch: (() => void) | undefined;
    const fetchGate = new Promise<void>((resolve) => {
      finishFetch = resolve;
    });
    const events: string[] = [];
    const createAndPushTag = vi.fn(async () => {
      events.push('tag started');
      return true;
    });

    const fetch = queue.schedule('/repo', async () => {
      events.push('fetch started');
      await fetchGate;
      events.push('fetch finished');
      return true;
    });
    const tag = queue.schedule('/repo', createAndPushTag);

    await Promise.resolve();
    expect(events).toEqual(['fetch started']);
    expect(createAndPushTag).not.toHaveBeenCalled();

    finishFetch?.();
    await expect(Promise.all([fetch, tag])).resolves.toEqual([true, true]);
    expect(events).toEqual(['fetch started', 'fetch finished', 'tag started']);
  });

  it('does not let a failed fetch discard the queued user action', async () => {
    const queue = createRepositoryOperationQueue();
    const tag = vi.fn(async () => 'tagged');

    const fetch = queue.schedule('/repo', async () => {
      throw new Error('offline');
    });
    const queuedTag = queue.schedule('/repo', tag);

    await expect(fetch).rejects.toThrow('offline');
    await expect(queuedTag).resolves.toBe('tagged');
    expect(tag).toHaveBeenCalledOnce();
  });
});
