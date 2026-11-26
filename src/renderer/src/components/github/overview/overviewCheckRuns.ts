import type { GitHubPullRequestCheckRuns, GitHubPullRequestChecks } from '@shared/types';

/**
 * Whether the listed runs describe the same moment as the counts on screen. The counts can come from a later
 * inbox poll than the runs (CI finished meanwhile); then the groups would contradict the fact strip, so
 * Overview shows the counts alone. Runs GitHub left out count as pending in `checks`.
 */
export function checkRunsAgreeWithCounts(checks: GitHubPullRequestChecks, checkRuns: GitHubPullRequestCheckRuns): boolean {
  const count = (outcome: string) => checkRuns.runs.filter((run) => run.outcome === outcome).length;
  const running = count('running');
  if (count('failed') !== checks.failed || count('passed') !== checks.passed) return false;
  // Unlisted runs (truncated) are counted as pending, so listed running plus unlisted must be exactly pending.
  const unlisted = checks.total - checkRuns.runs.length;
  if (unlisted < 0 || (unlisted > 0 && !checkRuns.truncated)) return false;
  return running + unlisted === checks.pending;
}
