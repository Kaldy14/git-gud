import type { GitHubWorkflowRun } from '@shared/types';

export type WorkflowRunPresentation = {
  label: string;
  tone: 'running' | 'success' | 'danger' | 'muted';
  icon: 'running' | 'success' | 'failure' | 'cancelled';
};

export function workflowRunPresentation(run: GitHubWorkflowRun): WorkflowRunPresentation {
  if (run.status !== 'completed') {
    if (run.status === 'queued' || run.status === 'requested' || run.status === 'waiting') {
      return {
        label: 'Queued',
        tone: 'running',
        icon: 'running'
      };
    }

    return {
      label: 'Running',
      tone: 'running',
      icon: 'running'
    };
  }

  if (run.conclusion === 'success') {
    return {
      label: 'Passed',
      tone: 'success',
      icon: 'success'
    };
  }

  if (run.conclusion === 'cancelled') {
    return {
      label: 'Cancelled',
      tone: 'muted',
      icon: 'cancelled'
    };
  }

  if (run.conclusion === 'skipped' || run.conclusion === 'neutral') {
    return {
      label: run.conclusion === 'skipped' ? 'Skipped' : 'Neutral',
      tone: 'muted',
      icon: 'cancelled'
    };
  }

  if (!run.conclusion || run.conclusion === 'unknown') {
    return {
      label: 'Unknown',
      tone: 'muted',
      icon: 'cancelled'
    };
  }

  return {
    label: run.conclusion === 'timed-out' ? 'Timed out' : 'Failed',
    tone: 'danger',
    icon: 'failure'
  };
}
