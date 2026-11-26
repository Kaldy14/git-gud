import type { GitHubPullRequestDetail, GitHubPullRequestSummary } from '@shared/types';

/** The inbox row of the open pull request and when the inbox read GitHub. */
export type LiveInboxRow = { row: GitHubPullRequestSummary | undefined; loadedAt: string | undefined };

/**
 * Lays the inbox row's newer metadata (title, review decision, merge state…) over the loaded detail.
 * Only a row actually found in the inbox counts, only when it is at least as new as the detail, and only
 * when the inbox read GitHub no earlier than the detail did: a row that left the inbox, an older poll, or an
 * older read of the same update (a check re-run does not move `updatedAt`) must not take back what the
 * detail already knows. The head stays the detail's: the diff, the review and the merge are bound to the
 * commit on screen. When the row describes another head (or does not say which), only fields that do not
 * depend on the head are taken, so counts, checks and conflict state keep describing the diff on screen.
 */
export function overlayLivePullRequest(
  detail: GitHubPullRequestDetail,
  { row, loadedAt }: LiveInboxRow
): GitHubPullRequestDetail {
  if (!row || !loadedAt || Date.parse(loadedAt) < Date.parse(detail.loadedAt)) return detail;
  if (Date.parse(row.updatedAt) < Date.parse(detail.updatedAt)) return detail;
  if (row.headSha === detail.headSha) return { ...detail, ...row, headSha: detail.headSha };
  const { title, state, isDraft, reviewDecision, reviewers, comments, updatedAt, category } = row;
  return { ...detail, title, state, isDraft, reviewDecision, reviewers, comments, updatedAt, category };
}

/** The inbox saw a change the loaded detail does not show yet: a later update or a different head. */
export function hasNewPullRequestActivity(
  detail: GitHubPullRequestDetail,
  { row, loadedAt }: LiveInboxRow
): boolean {
  // A row read or updated before the detail describes the past, even when it names another head.
  if (!row || !loadedAt || Date.parse(loadedAt) < Date.parse(detail.loadedAt)) return false;
  if (Date.parse(row.updatedAt) < Date.parse(detail.updatedAt)) return false;
  if (row.headSha !== undefined && row.headSha !== detail.headSha) return true;
  return Date.parse(row.updatedAt) > Date.parse(detail.updatedAt);
}

/** What still ties the reader to the revision on screen; either one holds a new revision back. */
export type ShownRevisionHolds = {
  // Typed text in an editor that a remount would lose.
  hasUnsavedText: boolean;
  // Local review drafts: they are stored per head, so a new head would hide them.
  hasPendingDrafts: boolean;
};

/**
 * Which detail to show after a fetch. A new revision (head or base) remounts every editor and the drafts
 * stored for the shown head, so while anything holds the shown revision the detail on screen stays and the
 * new one waits; it is adopted once nothing holds it. A fetch of the same revision is always taken.
 */
export function pickShownDetail(
  shown: GitHubPullRequestDetail | undefined,
  fetched: GitHubPullRequestDetail | undefined,
  holds: ShownRevisionHolds
): GitHubPullRequestDetail | undefined {
  if (!fetched) return shown;
  if (!shown || isSameRevision(shown, fetched) || !(holds.hasUnsavedText || holds.hasPendingDrafts)) return fetched;
  return shown;
}

export function isSameRevision(a: GitHubPullRequestDetail, b: GitHubPullRequestDetail): boolean {
  return a.headSha === b.headSha && a.baseSha === b.baseSha;
}

/** The notice while a new revision is held: it names what the reader has to finish to load it. */
export function heldRevisionNotice({ hasUnsavedText }: ShownRevisionHolds): string {
  // "Changed" covers both a push and a retarget to another base.
  return hasUnsavedText
    ? 'This pull request changed on GitHub. Add or cancel your comment to load the new version.'
    : 'This pull request changed on GitHub. Submit or discard your pending review to load the new version.';
}
