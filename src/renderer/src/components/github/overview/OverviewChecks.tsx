import { useId, useState, type ReactElement } from 'react';
import { Check, ChevronRight, CircleDashed, CircleDotDashed, ExternalLink, X } from 'lucide-react';

import type { GitHubPullRequestCheckOutcome, GitHubPullRequestCheckRuns, GitHubPullRequestSummary } from '@shared/types';

import { checkRunsAgreeWithCounts } from './overviewCheckRuns';

const GROUPS: Array<{ outcome: GitHubPullRequestCheckOutcome; label: string }> = [
  { outcome: 'failed', label: 'Failed' },
  { outcome: 'running', label: 'Running' },
  { outcome: 'passed', label: 'Passed' },
  { outcome: 'skipped', label: 'Skipped' }
];

/** One disclosure row per check outcome that has runs; Failed starts open. */
export function OverviewChecks({ checks, checkRuns, checksUrl }: {
  checks: GitHubPullRequestSummary['checks'];
  checkRuns?: GitHubPullRequestCheckRuns;
  checksUrl: string;
}): ReactElement | null {
  if (!checkRuns || !checkRunsAgreeWithCounts(checks, checkRuns)) {
    // An older cache or a failed fetch has only the counts; runs from before a later poll would contradict them.
    if (checks.total === 0) return null;
    const skipped = Math.max(0, checks.total - checks.passed - checks.failed - checks.pending);
    const parts = [[checks.failed, 'failed'], [checks.pending, 'running'], [checks.passed, 'passed'], [skipped, 'skipped']] as const;
    return (
      <p className="pr-overview-checks-counts">
        {parts.filter(([count]) => count > 0).map(([count, label]) => `${count} ${label}`).join(' · ')}
        <a href={checksUrl} target="_blank" rel="noreferrer">Checks on GitHub<ExternalLink size={12} aria-hidden="true" /></a>
      </p>
    );
  }
  const groups = GROUPS
    .map((group) => ({ ...group, runs: checkRuns.runs.filter((run) => run.outcome === group.outcome) }))
    .filter((group) => group.runs.length > 0);
  if (groups.length === 0 && !checkRuns.truncated) return null;
  return (
    <div className="pr-overview-checks">
      {groups.map((group) => <CheckGroup key={group.outcome} {...group} />)}
      {checkRuns.truncated ? (
        <p className="pr-overview-checks-note">
          GitHub listed only some of the runs.
          <a href={checksUrl} target="_blank" rel="noreferrer">See all on GitHub<ExternalLink size={12} aria-hidden="true" /></a>
        </p>
      ) : null}
    </div>
  );
}

function CheckGroup({ outcome, label, runs }: {
  outcome: GitHubPullRequestCheckOutcome;
  label: string;
  runs: GitHubPullRequestCheckRuns['runs'];
}): ReactElement {
  const [open, setOpen] = useState(outcome === 'failed');
  const listId = useId();
  return (
    <div className="pr-overview-check-group" data-outcome={outcome}>
      <button type="button" className="pr-overview-disclosure" aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)}>
        <ChevronRight size={14} aria-hidden="true" data-open={open || undefined} />
        <span>{label}</span>
        <span className="pr-overview-count">{runs.length}</span>
      </button>
      {open ? (
        <ul id={listId} className="pr-overview-check-runs" aria-label={`${label} checks`}>
          {runs.map((run, index) => (
            <li key={`${run.name}:${index}`}>
              <OutcomeIcon outcome={outcome} />
              {run.url ? (
                <a href={run.url} target="_blank" rel="noreferrer" title="Open on GitHub">
                  <span className="pr-overview-check-name">{run.name}</span>
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              ) : <span className="pr-overview-check-name">{run.name}</span>}
              {run.durationSeconds !== undefined ? <span className="pr-overview-check-duration">{formatDuration(run.durationSeconds)}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function OutcomeIcon({ outcome }: { outcome: GitHubPullRequestCheckOutcome }): ReactElement {
  // Running checks can last minutes: a static dashed icon, never a spinner.
  if (outcome === 'failed') return <X size={14} aria-hidden="true" />;
  if (outcome === 'running') return <CircleDotDashed size={14} aria-hidden="true" />;
  if (outcome === 'passed') return <Check size={14} aria-hidden="true" />;
  return <CircleDashed size={14} aria-hidden="true" />;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
