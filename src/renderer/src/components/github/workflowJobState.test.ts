import { describe, expect, it } from 'vitest';

import type { GitHubWorkflowJob } from '@shared/types';

import { groupWorkflowJobsByState, workflowJobState } from './workflowJobState';

function job(
  id: number,
  status: GitHubWorkflowJob['status'],
  conclusion?: GitHubWorkflowJob['conclusion']
): GitHubWorkflowJob {
  return {
    id,
    name: `job-${id}`,
    dependencyJobIds: [],
    status,
    conclusion,
    url: `https://github.com/acme/widgets/actions/runs/1/job/${id}`,
    labels: [],
    steps: []
  };
}

describe('workflowJobState', () => {
  it('separates waiting from working and failures from everything else', () => {
    expect(workflowJobState(job(1, 'in-progress'))).toBe('running');
    expect(workflowJobState(job(2, 'queued'))).toBe('queued');
    expect(workflowJobState(job(3, 'waiting'))).toBe('queued');
    expect(workflowJobState(job(4, 'completed', 'success'))).toBe('passed');
    expect(workflowJobState(job(5, 'completed', 'failure'))).toBe('failed');
    expect(workflowJobState(job(6, 'completed', 'timed-out'))).toBe('failed');
    expect(workflowJobState(job(7, 'completed', 'skipped'))).toBe('skipped');
    expect(workflowJobState(job(8, 'completed', 'cancelled'))).toBe('inactive');
  });

  it('groups jobs that need attention first and keeps workflow order inside a group', () => {
    const groups = groupWorkflowJobsByState([
      job(1, 'completed', 'success'),
      job(2, 'in-progress'),
      job(3, 'completed', 'failure'),
      job(4, 'completed', 'skipped'),
      job(5, 'queued'),
      job(6, 'completed', 'timed-out'),
      job(7, 'completed', 'cancelled')
    ]);

    expect(groups.map((group) => [group.label, group.jobs.map((member) => member.id)])).toEqual([
      ['Failed', [3, 6]],
      ['Running', [2]],
      ['Queued', [5]],
      ['Cancelled', [7]],
      ['Passed', [1]]
    ]);
  });

  it('does not call neutral jobs cancelled', () => {
    const groups = groupWorkflowJobsByState([
      job(1, 'completed', 'cancelled'),
      job(2, 'completed', 'neutral')
    ]);

    expect(groups.map((group) => group.label)).toEqual(['Other']);
  });
});
