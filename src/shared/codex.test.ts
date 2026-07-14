import { describe, expect, it } from 'vitest';

import { createCodexTaskDeepLink, MAX_CODEX_DEEP_LINK_PROMPT_LENGTH } from './codex';

describe('createCodexTaskDeepLink', () => {
  it('encodes the project path and prompt for a new local Codex task', () => {
    const deepLink = new URL(createCodexTaskDeepLink('/Users/example/My project', 'Explain `src/app.ts` & its trade-offs.'));

    expect(deepLink.protocol).toBe('codex:');
    expect(deepLink.host).toBe('threads');
    expect(deepLink.pathname).toBe('/new');
    expect(deepLink.searchParams.get('path')).toBe('/Users/example/My project');
    expect(deepLink.searchParams.get('prompt')).toBe('Explain `src/app.ts` & its trade-offs.');
  });

  it('rejects empty and oversized prompts', () => {
    expect(() => createCodexTaskDeepLink('/repo', '   ')).toThrow('Codex prompt must not be empty.');
    expect(() => createCodexTaskDeepLink('/repo', 'x'.repeat(MAX_CODEX_DEEP_LINK_PROMPT_LENGTH + 1))).toThrow(
      'Codex prompt must be 20,000 characters or fewer.'
    );
  });
});
