import type { ReactElement, ReactNode } from 'react';
import { ChevronRight, ExternalLink, Loader2 } from 'lucide-react';

import type { GitHubPullRequestConflictDetails, GitHubPullRequestSummary } from '@shared/types';
import type { MergeBlocker } from './pullRequestMergeBlockers';

export function PullRequestMergeChecklist({
  detail,
  blockers,
  conflicts,
  isMarkingReady,
  onMarkReady
}: {
  detail: GitHubPullRequestSummary;
  blockers: MergeBlocker[];
  conflicts: {
    hasLocalCheckout: boolean;
    details?: GitHubPullRequestConflictDetails;
    isLoading: boolean;
    errorMessage?: string;
    isOpen: boolean;
    onToggle: () => void;
  };
  isMarkingReady: boolean;
  onMarkReady: () => void;
}): ReactElement | null {
  if (blockers.length === 0) return null;
  const link = (path: string, label: string) => (
    <a className="btn-subtle btn-compact" href={`${detail.url}${path}`} target="_blank" rel="noreferrer">
      {label}
      <ExternalLink size={11} aria-hidden="true" />
    </a>
  );

  return (
    <section className="pr-merge-checklist" aria-labelledby="pr-merge-checklist-heading" id="pr-review-conflict-panel">
      <h2 id="pr-merge-checklist-heading">Before this can merge</h2>
      <ul>
        {blockers.map((blocker) => {
          let actions: ReactNode = null;
          let extra: ReactNode = null;
          if (blocker.id === 'conflicts') {
            actions = (
              <>
                <button className="btn-subtle btn-compact" type="button" aria-expanded={conflicts.isOpen} aria-controls="pr-merge-conflict-files" onClick={conflicts.onToggle}>
                  Files
                  <ChevronRight size={11} aria-hidden="true" data-open={conflicts.isOpen} />
                </button>
                {link('/conflicts', 'Resolve on GitHub')}
              </>
            );
            extra = conflicts.isOpen ? <ConflictFiles detail={detail} {...conflicts} /> : null;
          } else if (blocker.id === 'draft') {
            actions = (
              <button className="btn-subtle btn-compact" type="button" aria-disabled={isMarkingReady || undefined} onClick={() => { if (!isMarkingReady) onMarkReady(); }}>
                {isMarkingReady ? <Loader2 size={11} className="animate-spin" aria-hidden="true" /> : null}
                Ready for review
              </button>
            );
          } else if (blocker.id === 'checks-failing' || blocker.id === 'checks-running') {
            actions = link('/checks', 'View checks');
          } else if (blocker.id === 'behind') {
            actions = link('', 'Update on GitHub');
          }
          return (
            <li key={blocker.id} data-tone={blocker.tone}>
              <div className="pr-merge-checklist-row">
                <i aria-hidden="true" />
                <span>
                  <strong>{blocker.label}</strong>
                  <small>{blocker.detail}</small>
                </span>
                <span className="pr-merge-checklist-actions">{actions}</span>
              </div>
              {extra}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ConflictFiles({
  detail,
  hasLocalCheckout,
  details,
  isLoading,
  errorMessage
}: {
  detail: GitHubPullRequestSummary;
  hasLocalCheckout: boolean;
  details?: GitHubPullRequestConflictDetails;
  isLoading: boolean;
  errorMessage?: string;
}): ReactElement {
  const files = details?.files ?? [];
  return (
    <div className="pr-merge-checklist-files" id="pr-merge-conflict-files">
      {!hasLocalCheckout ? (
        <small>Open {detail.owner}/{detail.repository} in Git Gud to list the conflicting files, or resolve them on GitHub.</small>
      ) : isLoading ? (
        <small><Loader2 size={11} className="animate-spin" aria-hidden="true" /> Inspecting the local checkout…</small>
      ) : errorMessage ? (
        <small>Could not inspect the conflicting files: {errorMessage}</small>
      ) : details?.unavailableReason ? (
        <small>{details.unavailableReason} Fetch both branches locally, then reopen this overview.</small>
      ) : files.length > 0 ? (
        <ul aria-label="Conflicting files">{files.map((path) => <li key={path}><code>{path}</code></li>)}</ul>
      ) : (
        <small>These local revisions merge cleanly. Refresh the pull request to update GitHub’s conflict status.</small>
      )}
    </div>
  );
}
