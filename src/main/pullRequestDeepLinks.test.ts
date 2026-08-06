import { describe, expect, it } from 'vitest';

import { PullRequestDeepLinkQueue } from './pullRequestDeepLinks';

const target = {
  host: 'github.com',
  owner: 'Kaldy14',
  repository: 'git-gud',
  number: 123
};

describe('PullRequestDeepLinkQueue', () => {
  it('holds cold-launch links until the renderer is ready', () => {
    const queue = new PullRequestDeepLinkQueue();

    expect(queue.enqueue(target)).toBeUndefined();
    expect(queue.markRendererReady()).toEqual([target]);
  });

  it('delivers warm links immediately and queues again after a reload', () => {
    const queue = new PullRequestDeepLinkQueue();

    queue.markRendererReady();
    expect(queue.enqueue(target)).toEqual(target);

    queue.markRendererUnavailable();
    expect(queue.enqueue(target)).toBeUndefined();
    expect(queue.markRendererReady()).toEqual([target]);
  });

  it('deduplicates the same pending pull request', () => {
    const queue = new PullRequestDeepLinkQueue();

    queue.enqueue(target);
    queue.enqueue({ ...target, owner: 'kaldy14', repository: 'GIT-GUD' });

    expect(queue.markRendererReady()).toEqual([target]);
  });
});
