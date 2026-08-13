import type {
  GitHubPullRequestLocator,
  GitReviewPlan
} from '@shared/types';

const MAX_CACHED_PULL_REQUEST_PLANS = 8;

export class GitHubPullRequestReviewPlanCache {
  private readonly plans = new Map<string, GitReviewPlan>();

  constructor(
    private readonly maxCachedPlans = MAX_CACHED_PULL_REQUEST_PLANS
  ) {}

  remember(locator: GitHubPullRequestLocator, plan: GitReviewPlan): void {
    const key = pullRequestKey(locator);
    this.plans.delete(key);
    this.plans.set(key, plan);

    while (this.plans.size > this.maxCachedPlans) {
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

  getByReview(repoPath: string, sourceFingerprint: string): GitReviewPlan {
    const plan = [...this.plans.values()].find((candidate) =>
      candidate.repoPath === repoPath && candidate.sourceFingerprint === sourceFingerprint
    );

    if (!plan) {
      throw new Error('Reload the pull request before opening a TypeScript definition.');
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
