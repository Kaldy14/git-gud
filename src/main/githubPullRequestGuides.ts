import type { GitHubPullRequestGuideStatus, GitHubPullRequestLocator, GitReviewPlan } from '@shared/types';
import type { ReviewGuideManager } from './reviewGuide';

// Keep small revision references independently of the eight-entry full-plan cache.
export class GitHubPullRequestGuides {
  private readonly revisions = new Map<string, Pick<GitReviewPlan, 'repoPath' | 'sourceFingerprint' | 'target'>>();

  constructor(private readonly manager: Pick<ReviewGuideManager, 'getState' | 'start'>) {}

  start(locator: GitHubPullRequestLocator, plan: GitReviewPlan) {
    const key = this.key(locator);
    this.revisions.delete(key);
    this.revisions.set(key, { repoPath: plan.repoPath, sourceFingerprint: plan.sourceFingerprint, target: plan.target });
    const state = this.manager.start(plan);
    // Evict completed entries first so long-running jobs remain discoverable.
    for (const [candidate, revision] of this.revisions) {
      if (this.revisions.size <= 30) break;
      if (this.manager.getState(revision.repoPath, revision.sourceFingerprint).status !== 'running') {
        this.revisions.delete(candidate);
      }
    }
    return state;
  }

  getStatus(locator: GitHubPullRequestLocator): GitHubPullRequestGuideStatus {
    const revision = this.revisions.get(this.key(locator));
    if (!revision) return { status: 'idle' };
    const state = this.manager.getState(revision.repoPath, revision.sourceFingerprint);
    return {
      status: state.status,
      headSha: revision.target.kind === 'branch' ? revision.target.sha : undefined,
      errorMessage: state.status === 'failed' ? state.errorMessage : undefined
    };
  }

  private key(locator: GitHubPullRequestLocator): string {
    return JSON.stringify([locator.profileId, locator.owner.toLowerCase(), locator.repository.toLowerCase(), locator.number]);
  }
}
