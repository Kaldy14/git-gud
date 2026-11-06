import type { ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CircleDotDashed, Loader2, Sparkles } from 'lucide-react';

import type { PullRequestTourState } from '@shared/pullRequestTour';
import type { DiffSyntaxTheme, GitHubPullRequestDetail } from '@shared/types';
import type { DiffStyle } from '../../commit/fileDetailUtils';
import type { GuideCodeLocation } from './GuideExcerpt';
import { GuideTour } from './GuideTour';
import { pullRequestTourQueryKey, startPullRequestTour } from './pullRequestTourQuery';
import { useAnnounceOnChange } from '../../../lib/announce';


export function PullRequestGuideTab({ detail, active, diffStyle, diffSyntaxTheme, onOpenFile, onFinishReview, stopRequest }: {
  detail: GitHubPullRequestDetail;
  active: boolean;
  diffStyle: DiffStyle;
  diffSyntaxTheme: DiffSyntaxTheme;
  onOpenFile: (location: GuideCodeLocation) => void;
  onFinishReview: () => void;
  // Opens a stop from outside the Guide (an inline note in Code); bump signal to repeat.
  stopRequest?: { index: number; signal: number };
}): ReactElement {
  const locator = { profileId: detail.profileId, owner: detail.owner, repository: detail.repository, number: detail.number };
  const queryClient = useQueryClient();
  const queryKey = pullRequestTourQueryKey(detail);
  const query = useQuery({
    queryKey,
    queryFn: () => window.api.getGitHubPullRequestTourState(locator),
    // Writing takes minutes; poll only while a run is in progress.
    refetchInterval: (current) => (current.state.data?.running ? 3_000 : false)
  });
  const write = useMutation({
    mutationFn: () => startPullRequestTour(detail),
    onSuccess: (state: PullRequestTourState) => queryClient.setQueryData(queryKey, state)
  });

  const state = query.data;
  const tour = state?.tour ?? null;
  const running = Boolean(state?.running) || write.isPending;
  const failure = state?.errorMessage ?? (write.error instanceof Error ? write.error.message : undefined);
  const stale = tour !== null && tour.headSha !== detail.headSha;
  const guidePhase = running ? 'running' : failure ? 'failed' : tour ? `ready:${tour.headSha}` : 'empty';
  useAnnounceOnChange(guidePhase, running ? 'Writing the review guide' : failure ? `Review guide failed. ${failure}` : tour ? 'Review guide ready' : undefined);
  const writeButton = (label: string) => (
    <button type="button" className="btn-subtle btn-regular" aria-disabled={running || undefined} onClick={() => { if (!running) write.mutate(); }}>
      {running ? <CircleDotDashed size={13} /> : <Sparkles size={13} />}
      {running ? 'Reading the change…' : label}
    </button>
  );

  if (!tour) {
    if (query.isPending) {
      return <div className="pr-guide-empty"><Loader2 size={16} className="animate-spin" aria-label="Loading guide" /></div>;
    }
    return (
      <div className="pr-guide-empty">
        <Sparkles size={20} className="pr-guide-empty-icon" aria-hidden="true" />
        <p className="pr-guide-empty-title">
          {running ? 'Writing a review guide' : failure ? 'Could not write a review guide' : 'No review guide yet'}
        </p>
        <p className="pr-guide-empty-body">
          {running
            ? 'An agent is reading the change. A large one takes a few minutes; you can keep reviewing in the other tabs.'
            : 'A guide is a tour of the change: stops through the code in reading order, with the calls only a maintainer can make.'}
        </p>
        {writeButton(failure ? 'Try again' : 'Write guide')}
        {failure && !running ? <FailureDetails detail={failure} /> : null}
      </div>
    );
  }

  const banner = running || stale || failure ? (
    <div className="pr-guide-banner" data-tone={running ? 'info' : 'warning'} role="status">
      {running ? <CircleDotDashed size={13} /> : <AlertTriangle size={13} />}
      <span>
        {running
          ? 'Rewriting this guide. It updates here when the new one is ready.'
          : failure
            ? 'Could not rewrite this guide.'
            : 'Written before the latest push. Some excerpts may be missing.'}
        {failure && !running ? <FailureDetails detail={failure} /> : null}
      </span>
      {running ? null : writeButton('Rewrite')}
    </div>
  ) : null;

  return (
    <GuideTour
      key={`${tour.headSha}:${tour.generatedAt}`}
      tour={tour}
      plan={detail.reviewPlan}
      progressKey={`git-gud:pr-guide-progress:v1:${JSON.stringify(queryKey)}:${tour.headSha}:${tour.generatedAt}`}
      banner={banner}
      active={active}
      diffStyle={diffStyle}
      diffSyntaxTheme={diffSyntaxTheme}
      onOpenFile={onOpenFile}
      onFinish={onFinishReview}
      stopRequest={stopRequest}
      stale={stale}
    />
  );
}

function FailureDetails({ detail }: { detail: string }): ReactElement {
  return (
    <details className="pr-guide-failure">
      <summary>Technical details</summary>
      <pre>{detail}</pre>
    </details>
  );
}
