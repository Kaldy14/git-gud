import type { GitHubPullRequestReviewComment, GitHubPullRequestSummary } from '@shared/types';
import { pullRequestMergeBlockers, type MergeBlocker } from '../pullRequestMergeBlockers';
import { hasPullRequestMergeConflicts, PULL_REQUEST_STATUS_LABELS, pullRequestStatus, type PullRequestInboxStatus } from '../pullRequestInboxStatus';
import { pullRequestReviewThreads } from './pullRequestReviewThreads';

export type MergeVerdictTone = PullRequestInboxStatus['tone'];

export type MergeVerdict = {
  label: string;
  tone: MergeVerdictTone;
  icon: PullRequestInboxStatus['icon'];
  // Plain sentences for the fact strip; `bad` facts carry their own danger icon.
  facts: Array<{ text: string; bad: boolean }>;
  // What the "Before this can merge" checklist lists, so the strip and the checklist share one source.
  blockers: MergeBlocker[];
};

type VerdictInput = GitHubPullRequestSummary & { reviewComments?: readonly GitHubPullRequestReviewComment[] };

/**
 * The one answer to "can this merge?" for the Overview and the header. Wherever the inbox status
 * (`pullRequestStatus`) already names the state (conflicts, draft, changes requested, failing checks,
 * awaiting review) its words, tone and icon are used as they are, so the rail, the header and Overview
 * never call one pull request two things. Beyond that it names the remaining blocker from
 * `pullRequestMergeBlockers`, so a label never contradicts the checklist beneath it.
 */
export function pullRequestMergeVerdict(pullRequest: VerdictInput): MergeVerdict {
  const blockers = pullRequestMergeBlockers(pullRequest);
  const facts = verdictFacts(pullRequest);
  const verdict = (label: string, tone: MergeVerdictTone, icon: MergeVerdict['icon']): MergeVerdict =>
    ({ label, tone, icon, facts, blockers });
  const has = (id: MergeBlocker['id']) => blockers.some((blocker) => blocker.id === id);

  if (pullRequest.state === 'closed') return verdict(PULL_REQUEST_STATUS_LABELS.closed, 'muted', 'closed');
  const status = pullRequestStatus(pullRequest);
  // "Approved" and "Review status unknown" say nothing about merging, and the inbox's "Ready to merge"
  // is re-checked against the blockers below.
  if (!MERGE_SILENT_STATUSES.has(status.label)) return verdict(status.label, status.tone, status.icon);
  if (has('checks-failing')) return verdict(PULL_REQUEST_STATUS_LABELS.checksFailing, 'danger', 'failing');
  if (has('checks-running')) return verdict('Checks running', 'pending', 'running');
  if (has('behind')) return verdict(`Behind ${pullRequest.baseRefName}`, 'warning', 'warning');
  if (blockers.length > 0 || pullRequest.mergeState === 'blocked') {
    return verdict(PULL_REQUEST_STATUS_LABELS.blockedByRules, 'warning', 'blocked');
  }
  if (pullRequest.mergeable === 'mergeable' && (pullRequest.mergeState === 'clean' || pullRequest.mergeState === 'unstable')) {
    return verdict(PULL_REQUEST_STATUS_LABELS.readyToMerge, 'success', 'check');
  }
  // GitHub has not finished computing mergeability.
  return verdict('Unknown', 'muted', 'dot');
}

const MERGE_SILENT_STATUSES = new Set<string>([
  PULL_REQUEST_STATUS_LABELS.approved,
  PULL_REQUEST_STATUS_LABELS.reviewUnknown,
  PULL_REQUEST_STATUS_LABELS.readyToMerge
]);

function verdictFacts(pullRequest: VerdictInput): MergeVerdict['facts'] {
  const facts: MergeVerdict['facts'] = [];
  const isOpen = pullRequest.state !== 'merged' && pullRequest.state !== 'closed';
  if (isOpen && hasPullRequestMergeConflicts(pullRequest)) facts.push({ text: `Conflicts with ${pullRequest.baseRefName}`, bad: true });
  facts.push(checksFact(pullRequest.checks));
  facts.push(reviewFact(pullRequest, isOpen));
  if (pullRequest.reviewComments) {
    const { threads, resolutionKnown } = pullRequestReviewThreads(pullRequest.reviewComments);
    // Without resolution state an "unresolved" count would be a guess, so the fact is left out.
    if (resolutionKnown) {
      const unresolved = threads.filter((thread) => !thread.isResolved).length;
      facts.push({ text: unresolved === 0 ? 'no unresolved threads' : plural(unresolved, 'unresolved thread'), bad: false });
    }
  }
  if (isOpen && pullRequest.mergeState === 'behind') facts.push({ text: `behind ${pullRequest.baseRefName}`, bad: false });
  // Only the first fact starts with a capital: the strip reads as one sentence joined by middots.
  return facts.map((fact, index) => ({ ...fact, text: index === 0 ? capitalize(fact.text) : fact.text }));
}

function checksFact(checks: GitHubPullRequestSummary['checks']): MergeVerdict['facts'][number] {
  if (checks.total === 0) return { text: 'no checks', bad: false };
  // Skipped and neutral runs never finish, so they stay out of the passed/ran ratio (as in the header).
  const ran = checks.passed + checks.failed + checks.pending;
  if (ran === 0) return { text: `${plural(checks.total, 'check')} skipped`, bad: false };
  if (checks.failed > 0) {
    return { text: `${checks.failed} of ${plural(ran, 'check')} failed${checks.pending > 0 ? `, ${checks.pending} running` : ''}`, bad: true };
  }
  if (checks.pending > 0) return { text: `${checks.passed}/${ran} checks passed, ${checks.pending} running`, bad: false };
  return { text: `${checks.passed}/${ran} checks passed`, bad: false };
}

function reviewFact(pullRequest: GitHubPullRequestSummary, isOpen: boolean): MergeVerdict['facts'][number] {
  const byState = (state: 'approved' | 'changes-requested' | 'pending') =>
    pullRequest.reviewers.filter((reviewer) => reviewer.state === state).map((reviewer) => reviewer.author);
  const requested = byState('changes-requested');
  if (requested.length > 0) return { text: `changes requested by ${names(requested)}`, bad: true };
  if (pullRequest.reviewDecision === 'changes-requested') return { text: 'changes requested', bad: true };
  const approvals = byState('approved').length;
  if (approvals > 0) return { text: plural(approvals, 'approval'), bad: false };
  const pending = byState('pending');
  if (isOpen && pending.length > 0) return { text: `awaiting review from ${names(pending)}`, bad: false };
  if (isOpen && pullRequest.reviewDecision === 'review-required') return { text: 'review required', bad: false };
  return { text: 'no reviews', bad: false };
}

function names(logins: string[]): string {
  return logins.length <= 2 ? logins.join(' and ') : `${logins[0]} and ${logins.length - 1} others`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
