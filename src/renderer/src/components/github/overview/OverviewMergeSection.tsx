import { useRef, Fragment, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';

import { gitHubPullRequestInboxQueryKey } from '@renderer/queries/github';
import { useAnnounceOnChange } from '@renderer/lib/announce';
import type { GitHubPullRequestConflictDetails, GitHubPullRequestDetail } from '@shared/types';
import { PullRequestMergeChecklist } from '../PullRequestMergeChecklist';
import { hasPullRequestMergeConflicts } from '../pullRequestInboxStatus';
import { PullRequestReviewerPicker } from '../PullRequestReviewerPicker';
import { PullRequestStatusIcon } from '../PullRequestStatusIcon';
import { useDrawOnBecoming } from '@renderer/lib/motion';
import { pullRequestLocator } from '../tour/pullRequestTourQuery';
import { OverviewChecks } from './OverviewChecks';
import { OverviewSection } from './overviewParts';
import { pullRequestMergeVerdict, type MergeVerdict } from './pullRequestMergeVerdict';
import type { PullRequestNotice } from './PullRequestOverviewTab';

export function OverviewMergeSection({ detail, active, codexRepoPath, conflicts, onOpenConversation, onRefresh, onNotice }: {
  detail: GitHubPullRequestDetail;
  active: boolean;
  codexRepoPath?: string;
  conflicts: { isOpen: boolean; onToggle: () => void };
  onOpenConversation: () => void;
  onRefresh: () => void;
  onNotice: (notice: PullRequestNotice) => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const verdict = pullRequestMergeVerdict(detail);
  useAnnounceOnChange(verdict.label, `Merge status: ${verdict.label}`);
  const hasConflicts = hasPullRequestMergeConflicts(detail);
  const conflictDetailsQuery = useQuery({
    queryKey: ['github-pull-request-conflicts', codexRepoPath ?? 'unavailable', detail.baseRefSha, detail.headSha],
    queryFn: async (): Promise<GitHubPullRequestConflictDetails> => {
      if (!codexRepoPath) throw new Error('No matching local checkout is open.');
      return window.api.getGitHubPullRequestConflicts(codexRepoPath, { baseSha: detail.baseRefSha, headSha: detail.headSha });
    },
    enabled: hasConflicts && active && Boolean(codexRepoPath),
    staleTime: 15_000
  });
  const markReadyMutation = useMutation({
    mutationFn: () => window.api.markGitHubPullRequestReady(pullRequestLocator(detail)),
    onSuccess: (result) => {
      onNotice({ tone: 'success', message: result.message });
      onRefresh();
    },
    onError: (error) => {
      onNotice({ tone: 'danger', message: error instanceof Error ? error.message : 'Could not mark the pull request ready for review.' });
    }
  });

  return (
    <OverviewSection id="pr-overview-merge" title="Merge status">
      <div className="pr-overview-card pr-overview-merge">
        {/* The page's one tinted band: the verdict, then the facts behind it. */}
        <div className="pr-overview-facts" data-tone={verdict.tone}>
          <Verdict verdict={verdict} />
          <p>
            {verdict.facts.map((fact, index) => (
              <Fragment key={fact.text}>
                {index > 0 ? <span className="pr-overview-dot" aria-hidden="true"> · </span> : null}
                <span data-bad={fact.bad || undefined}>
                  {fact.bad ? <AlertTriangle size={14} aria-hidden="true" /> : null}
                  {fact.text}
                </span>
              </Fragment>
            ))}
          </p>
        </div>
        <OverviewChecks checks={detail.checks} checkRuns={detail.checkRuns} checksUrl={`${detail.url}/checks`} />
        <PullRequestMergeChecklist
          detail={detail}
          blockers={verdict.blockers}
          conflicts={{
            hasLocalCheckout: Boolean(codexRepoPath),
            details: conflictDetailsQuery.data,
            isLoading: conflictDetailsQuery.isLoading,
            errorMessage: conflictDetailsQuery.error instanceof Error ? conflictDetailsQuery.error.message : undefined,
            isOpen: conflicts.isOpen,
            onToggle: conflicts.onToggle
          }}
          isMarkingReady={markReadyMutation.isPending}
          onMarkReady={() => markReadyMutation.mutate()}
          onOpenConversation={onOpenConversation}
        />
        <div className="pr-overview-reviewers">
          <span className="pr-overview-row-label">Reviewers</span>
          <PullRequestReviewerPicker
            detail={detail}
            onReviewersChanged={() => queryClient.invalidateQueries({ queryKey: gitHubPullRequestInboxQueryKey(detail.profileId) })}
            onNotice={onNotice}
          />
        </div>
      </div>
    </OverviewSection>
  );
}

export function Verdict({ verdict }: { verdict: MergeVerdict }): ReactElement {
  // Turning ready while you watch (checks went green on a refresh) draws the check once.
  const ref = useRef<HTMLSpanElement>(null);
  useDrawOnBecoming(ref, verdict.tone === 'success');
  return (
    <span ref={ref} className="pr-overview-verdict" data-tone={verdict.tone}>
      <PullRequestStatusIcon icon={verdict.icon} size={16} />
      {verdict.label}
    </span>
  );
}
