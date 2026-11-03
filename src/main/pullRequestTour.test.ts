import { afterEach, describe, expect, it, vi } from 'vitest';

import * as claudeHarness from './claudeHarness';
import * as piHarness from './piHarness';
import { runGuidePrompt } from './pullRequestTour';

afterEach(() => vi.restoreAllMocks());

describe('pull-request guide engine', () => {
  it('falls back to Claude Code only when Pi is not set up', async () => {
    vi.spyOn(piHarness, 'runPiPrompt').mockRejectedValue(new Error('No API key found for openai.'));
    const claude = vi.spyOn(claudeHarness, 'runClaudePrompt').mockResolvedValue('{"stops":[]}');
    await expect(runGuidePrompt('prompt')).resolves.toBe('{"stops":[]}');
    expect(claude).toHaveBeenCalledOnce();
  });

  it('keeps real Pi failures instead of hiding them behind the fallback', async () => {
    vi.spyOn(piHarness, 'runPiPrompt').mockRejectedValue(new Error('Pull request guide timed out.'));
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
