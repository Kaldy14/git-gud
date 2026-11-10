import {
  isQueuedWorkflowRun,
  workflowRunPresentation
} from '@renderer/components/dashboard/workflowRunPresentation';
import type { GitHubWorkflowJob } from '@shared/types';

import { isSkippedWorkflowJob } from './workflowRunGraph';

/**
 * What a job looks like at a glance. `failed` and `running` are the two states a run
 * view exists to surface, so everything else is drawn to recede behind them.
 */
export type WorkflowJobState = 'failed' | 'running' | 'queued' | 'passed' | 'skipped' | 'inactive';

export function workflowJobState(
  job: Pick<GitHubWorkflowJob, 'status' | 'conclusion'>
): WorkflowJobState {
  if (job.status === 'completed' && job.conclusion === 'skipped') {
    return 'skipped';
  }
  const { tone } = workflowRunPresentation(job);
  if (tone === 'danger') {
    return 'failed';
  }
  if (tone === 'success') {
    return 'passed';
  }
  if (tone === 'running') {
    return isQueuedWorkflowRun(job) ? 'queued' : 'running';
  }
  return 'inactive';
}

export type WorkflowJobGroup = {
  state: Exclude<WorkflowJobState, 'skipped'>;
  label: string;
  jobs: GitHubWorkflowJob[];
};

const GROUP_ORDER: { state: WorkflowJobGroup['state']; label: string }[] = [
  { state: 'failed', label: 'Failed' },
  { state: 'running', label: 'Running' },
  { state: 'queued', label: 'Queued' },
  { state: 'inactive', label: 'Cancelled' },
  { state: 'passed', label: 'Passed' }
];

/**
 * Jobs that need attention first, each group in workflow order. Skipped jobs are left
 * out; the run view folds them behind their own toggle.
 */
export function groupWorkflowJobsByState(jobs: GitHubWorkflowJob[]): WorkflowJobGroup[] {
  return GROUP_ORDER.flatMap(({ state, label }) => {
    const members = jobs.filter(
      (job) => !isSkippedWorkflowJob(job) && workflowJobState(job) === state
    );
    if (members.length === 0) {
      return [];
    }
    // Neutral and unknown conclusions share the group; only name it Cancelled when true.
    const cancelledOnly = members.every((job) => job.conclusion === 'cancelled');
    return [{ state, label: state === 'inactive' && !cancelledOnly ? 'Other' : label, jobs: members }];
  });
}
