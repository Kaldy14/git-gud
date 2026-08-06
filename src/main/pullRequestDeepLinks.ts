import type { PullRequestDeepLinkTarget } from '@shared/pullRequestDeepLink';

export class PullRequestDeepLinkQueue {
  private readonly pending: PullRequestDeepLinkTarget[] = [];
  private rendererReady = false;

  enqueue(
    target: PullRequestDeepLinkTarget
  ): PullRequestDeepLinkTarget | undefined {
    if (this.rendererReady) {
      return target;
    }

    const key = pullRequestDeepLinkTargetKey(target);

    if (!this.pending.some((candidate) => pullRequestDeepLinkTargetKey(candidate) === key)) {
      this.pending.push(target);
    }

    return undefined;
  }

  markRendererReady(): PullRequestDeepLinkTarget[] {
    this.rendererReady = true;
    return this.pending.splice(0);
  }

  markRendererUnavailable(): void {
    this.rendererReady = false;
  }
}

export const pullRequestDeepLinkQueue = new PullRequestDeepLinkQueue();

function pullRequestDeepLinkTargetKey(
  target: PullRequestDeepLinkTarget
): string {
  return [
    target.host.toLowerCase(),
    target.owner.toLowerCase(),
    target.repository.toLowerCase(),
    target.number
  ].join('/');
}
