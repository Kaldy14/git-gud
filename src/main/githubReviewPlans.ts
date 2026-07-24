import type {
  GitHubPullRequestLocator,
  GitReviewPlan
} from '@shared/types';

const MAX_CACHED_PULL_REQUEST_PLANS = 100;

export class GitHubPullRequestReviewPlanCache {
  private readonly plans = new Map<string, GitReviewPlan>();

  remember(locator: GitHubPullRequestLocator, plan: GitReviewPlan): void {
    const key = pullRequestKey(locator);
    this.plans.delete(key);
    this.plans.set(key, plan);

    while (this.plans.size > MAX_CACHED_PULL_REQUEST_PLANS) {
      const oldestKey = this.plans.keys().next().value;

      if (typeof oldestKey !== 'string') {
        return;
      }
      this.plans.delete(oldestKey);
    }
  }

  get(locator: GitHubPullRequestLocator, sourceFingerprint: string): GitReviewPlan {
    const plan = this.plans.get(pullRequestKey(locator));

    if (!plan) {
      throw new Error('Reload the pull request before starting its AI guide.');
    }

    if (plan.sourceFingerprint !== sourceFingerprint) {
      throw new Error('The pull request changed while the AI guide was starting. Reload it and try again.');
    }

    return plan;
  }

  has(plan: GitReviewPlan): boolean {
    return [...this.plans.values()].some((candidate) =>
      candidate.repoPath === plan.repoPath &&
      candidate.targetKey === plan.targetKey &&
      candidate.sourceFingerprint === plan.sourceFingerprint
    );
  }
}

export const githubPullRequestReviewPlans = new GitHubPullRequestReviewPlanCache();

function pullRequestKey(locator: GitHubPullRequestLocator): string {
  return [
    locator.profileId,
    locator.owner.toLowerCase(),
    locator.repository.toLowerCase(),
    locator.number
  ].join(':');
}
