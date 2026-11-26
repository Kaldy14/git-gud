import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PullRequestTour } from '@shared/pullRequestTour';
import type { GitReviewChunk, GitReviewPlan } from '@shared/types';

import * as claudeHarness from './claudeHarness';
import * as piHarness from './piHarness';
import { buildPullRequestTourPrompt, PullRequestTourManager, runGuidePrompt, type PullRequestTourInput } from './pullRequestTour';

afterEach(() => vi.restoreAllMocks());

describe('pull-request tour engine', () => {
  it('falls back to Claude Code only when Pi is not set up', async () => {
    vi.spyOn(piHarness, 'runPiPrompt').mockRejectedValue(new Error('No API key found for openai.'));
    const claude = vi.spyOn(claudeHarness, 'runClaudePrompt').mockResolvedValue('{"stops":[]}');
    await expect(runGuidePrompt('prompt')).resolves.toBe('{"stops":[]}');
    expect(claude).toHaveBeenCalledOnce();
  });

  it('keeps real Pi failures instead of hiding them behind the fallback', async () => {
    vi.spyOn(piHarness, 'runPiPrompt').mockRejectedValue(new Error('Pull request tour timed out.'));
    const claude = vi.spyOn(claudeHarness, 'runClaudePrompt');
    await expect(runGuidePrompt('prompt')).rejects.toThrow('timed out');
    expect(claude).not.toHaveBeenCalled();
  });

  it('reports both problems when neither harness can run', async () => {
    vi.spyOn(piHarness, 'runPiPrompt').mockRejectedValue(new Error('Pi was not found.'));
    vi.spyOn(claudeHarness, 'runClaudePrompt').mockRejectedValue(new Error('Claude Code was not found.'));
    await expect(runGuidePrompt('prompt')).rejects.toThrow(/Pi is not set up.*Claude Code was not found/u);
  });
});

function input(chunks: Array<Partial<GitReviewChunk> & { path: string; patch: string }>): PullRequestTourInput {
  const plan = {
    title: 'Title', sourceFingerprint: 'f',
    units: [{ id: 'u', title: '', reason: '', explanation: '', confidence: 'exact', chunks }]
  } as unknown as GitReviewPlan;
  return { plan, headSha: 'head', number: 7, context: { body: 'Body', baseRefName: 'main', baseSha: 'base', settledReview: '' } };
}

describe('buildPullRequestTourPrompt', () => {
  it('numbers patch rows and is complete when every file fits', () => {
    const { prompt, partial } = buildPullRequestTourPrompt(input([
      { path: 'a.ts', patch: '@@ -1 +1 @@\n-old\n+new', changeType: 'modified' },
      { path: 'logo.png', patch: '', changeType: 'added', omittedReason: 'binary' }
    ]));
    expect(prompt).toContain('H1 L- R1 |+new');
    expect(partial).toBe(false);
  });

  it('is partial when a file was too large or cut by the prompt budget', () => {
    expect(buildPullRequestTourPrompt(input([
      { path: 'huge.json', patch: '', changeType: 'modified', omittedReason: 'too-large' }
    ])).partial).toBe(true);
    const long = `@@ -1,1 +1,30000 @@\n${Array.from({ length: 30_000 }, (_, index) => `+line ${index}`).join('\n')}`;
    const { prompt, partial } = buildPullRequestTourPrompt(input([{ path: 'long.ts', patch: long, changeType: 'modified' }]));
    expect(partial).toBe(true);
    expect(prompt).toContain('### long.ts [modified] (truncated)');
  });
});

describe('PullRequestTourManager', () => {
  const locator = { profileId: 'p', owner: 'o', repository: 'r', number: 1 };
  const tour: PullRequestTour = {
    version: 2, headSha: 'h', sourceFingerprint: 'f', generatedAt: '2026-01-01T00:00:00.000Z',
    overview: { risk: null, summary: '', highlights: [], partial: false }, stops: []
  };
  const memoryStore = (tours: Record<string, unknown>) => {
    let value = tours;
    return { get: () => value, set: (_key: string, next: Record<string, unknown>) => { value = next; } };
  };
  const key = JSON.stringify(['p', 'o', 'r', 1]);

  it('hides a stored tour in the old format and says so', () => {
    const store = memoryStore({ [key]: { headSha: 'h', stops: [], savedAt: '' } });
    const manager = new PullRequestTourManager(vi.fn(), store as never);
    expect(manager.getState(locator)).toEqual({ tour: null, running: false, outdatedFormat: true });
  });

  it('keeps the last good tour when a rewrite fails', async () => {
    const store = memoryStore({ [key]: { ...tour, savedAt: '' } });
    const engine = vi.fn().mockRejectedValue(new Error('Model unavailable'));
    const manager = new PullRequestTourManager(engine, store as never);
    manager.start(locator, input([]));
    await vi.waitFor(() => expect(manager.getState(locator).running).toBe(false));
    expect(manager.getState(locator)).toMatchObject({ tour: { headSha: 'h' }, errorMessage: 'Model unavailable' });
  });
});
