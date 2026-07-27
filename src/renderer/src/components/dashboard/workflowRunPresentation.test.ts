import { describe, expect, it } from 'vitest';

import type { GitHubWorkflowRun } from '@shared/types';

import { workflowRunPresentation } from './workflowRunPresentation';

describe('workflow run presentation', () => {
  it('keeps in-progress workflows visibly live', () => {
    expect(workflowRunPresentation(workflowRun({ status: 'in-progress' }))).toEqual({
      label: 'Running',
      tone: 'running',
      icon: 'running'
    });
  });

  it('distinguishes successful, failed, and cancelled conclusions', () => {
    expect(workflowRunPresentation(workflowRun({ conclusion: 'success' })).tone).toBe('success');
    expect(workflowRunPresentation(workflowRun({ conclusion: 'failure' })).tone).toBe('danger');
    expect(workflowRunPresentation(workflowRun({ conclusion: 'cancelled' }))).toMatchObject({
      label: 'Cancelled',
      tone: 'muted'
    });
  });

  it('does not present pending or unknown workflow states as running', () => {
    expect(workflowRunPresentation(workflowRun({ status: 'pending' }))).toMatchObject({
      label: 'Queued',
      tone: 'running'
    });
    expect(workflowRunPresentation(workflowRun({ status: 'unknown' }))).toMatchObject({
      label: 'Unknown',
      tone: 'muted'
    });
  });
});

function workflowRun(overrides: Partial<GitHubWorkflowRun>): GitHubWorkflowRun {
  return {
    id: 42,
    name: 'CI',
    displayTitle: 'Verify dashboard support',
    runNumber: 42,
    event: 'push',
    branch: 'feature/dashboards',
    sha: 'abcdef1234567890',
    status: 'completed',
    conclusion: 'success',
    url: 'https://github.com/acme/widgets/actions/runs/42',
    actor: 'developer',
    pullRequestNumbers: [],
    createdAt: '2026-07-25T10:00:00Z',
    startedAt: '2026-07-25T10:01:00Z',
    updatedAt: '2026-07-25T10:02:00Z',
    ...overrides
  };
}
