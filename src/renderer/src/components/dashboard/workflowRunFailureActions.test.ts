import { describe, expect, it, vi } from 'vitest';

import type { GitHubWorkflowRun } from '@shared/types';

import {
  buildWorkflowRunCodexPrompt,
  copyWorkflowRunFailure
} from './workflowRunFailureActions';

const run: GitHubWorkflowRun = {
  id: 101,
  name: 'CI',
  displayTitle: 'Fix the dashboard failure',
  runNumber: 33,
  event: 'push',
  branch: 'main',
  sha: 'abcdef1234567890',
  status: 'completed',
  conclusion: 'failure',
  url: 'https://github.com/acme/widgets/actions/runs/101',
  pullRequestNumbers: [],
  createdAt: '2026-07-27T10:00:00Z',
  startedAt: '2026-07-27T10:01:00Z',
  updatedAt: '2026-07-27T10:07:00Z'
};

describe('workflow run failure actions', () => {
  it('copies the exact failed-step log', async () => {
    const clipboard = {
      writeText: vi.fn(async () => undefined)
    };

    await copyWorkflowRunFailure('Build\tCompile\tError: typecheck failed', clipboard);

    expect(clipboard.writeText).toHaveBeenCalledWith(
      'Build\tCompile\tError: typecheck failed'
    );
  });

  it('builds a focused Codex prompt with run metadata and the failed log', () => {
    const prompt = buildWorkflowRunCodexPrompt(
      { owner: 'acme', repository: 'widgets', run },
      'Build\tCompile\tError: typecheck failed'
    );

    expect(prompt).toContain('Investigate and fix this failed GitHub Actions run');
    expect(prompt).toContain('Repository: acme/widgets');
    expect(prompt).toContain('Workflow: CI');
    expect(prompt).toContain('Run: #33 — Fix the dashboard failure');
    expect(prompt).toContain('Branch: main');
    expect(prompt).toContain('Commit: abcdef1234567890');
    expect(prompt).toContain('Build\tCompile\tError: typecheck failed');
  });

  it('keeps the end of oversized logs where failure summaries normally appear', () => {
    const prompt = buildWorkflowRunCodexPrompt(
      { owner: 'acme', repository: 'widgets', run },
      `${'setup output\n'.repeat(2_000)}FINAL FAILURE`
    );

    expect(prompt).toContain('[Earlier failed-step log output omitted.]');
    expect(prompt).toContain('FINAL FAILURE');
    expect(prompt.length).toBeLessThan(20_000);
  });
});
