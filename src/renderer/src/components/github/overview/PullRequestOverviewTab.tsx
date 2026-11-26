import type { ReactElement } from 'react';

import { PullRequestMeta } from '../PullRequestDetailTabs';
import { useBugFinder } from '../useBugFinder';
import { pullRequestReviewThreads } from './pullRequestReviewThreads';
import type { GitHubPullRequestDetail } from '@shared/types';
import type { PullRequestCodeLocation } from '../pullRequestNavigation';
import type { PullRequestTourQueryState } from '../tour/pullRequestTourQuery';
import { OverviewBehaviorSection } from './OverviewBehaviorSection';
import { OverviewIssuesSection } from './OverviewIssuesSection';
import { OverviewMergeSection } from './OverviewMergeSection';
import { OverviewRiskSection } from './OverviewRiskSection';

export type PullRequestNotice = { tone: 'success' | 'danger'; message: string };

export type PullRequestOverviewTabProps = {
  detail: GitHubPullRequestDetail;
  // False while another tab is shown; queries that only Overview needs wait meanwhile.
  active: boolean;
  tour: PullRequestTourQueryState;
  codexRepoPath?: string;
  conflicts: { isOpen: boolean; onToggle: () => void };
  onOpenBugScan: () => void;
  onOpenTourStep: (index: number) => void;
  onOpenCode: (location: PullRequestCodeLocation) => void;
  onOpenConversation: (commentId?: number) => void;
  onRefresh: () => void;
  onNotice: (notice: PullRequestNotice) => void;
};

/**
 * Overview: a decision page. Can this merge, what does it change and how risky is it, what is
 * still open, and which behaviour changes. Tour text is labelled as such and never posed as a GitHub fact.
 */
export function PullRequestOverviewTab(props: PullRequestOverviewTabProps): ReactElement {
  const { detail, tour, onOpenConversation, onNotice } = props;
  // Issues lead only while something is open: an unresolved thread, or a local finding not yet dealt with.
  const { threads, resolutionKnown } = pullRequestReviewThreads(detail.reviewComments);
  const { state: bugScan } = useBugFinder(detail);
  const hasOpenFinding = bugScan?.findings.some((finding) => finding.status === 'open' && !finding.publication && finding.headSha === bugScan.headSha) ?? false;
  const issuesAreQuiet = !hasOpenFinding && (resolutionKnown ? threads.every((thread) => thread.isResolved) : threads.length === 0);
  const behavior = tour.tour
    ? <OverviewBehaviorSection tour={tour.tour} isCurrent={tour.isCurrent} onOpenTourStep={props.onOpenTourStep} />
    : null;

  return (
    <div className="pr-summary-column pr-overview">
      <PullRequestMeta pullRequest={detail} commits={detail.commits} />
      <OverviewMergeSection
        detail={detail}
        active={props.active}
        codexRepoPath={props.codexRepoPath}
        conflicts={props.conflicts}
        onOpenConversation={() => onOpenConversation()}
        onRefresh={props.onRefresh}
        onNotice={onNotice}
      />
      <OverviewRiskSection detail={detail} tour={tour} onOpenConversation={() => onOpenConversation()} />
      {/* With nothing unresolved, what the change does comes before the (empty) list of issues. */}
      {issuesAreQuiet ? behavior : null}
      <OverviewIssuesSection
        detail={detail}
        onOpenBugScan={props.onOpenBugScan}
        onOpenCode={props.onOpenCode}
        onOpenConversation={onOpenConversation}
      />
      {issuesAreQuiet ? null : behavior}
    </div>
  );
}
