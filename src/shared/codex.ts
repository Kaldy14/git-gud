export const MAX_CODEX_DEEP_LINK_PROMPT_LENGTH = 20_000;

export function createCodexTaskDeepLink(repoPath: string, prompt: string): string {
  const normalizedPrompt = prompt.trim();

  if (!repoPath.trim()) {
    throw new Error('Codex workspace path must not be empty.');
  }

  if (!normalizedPrompt) {
    throw new Error('Codex prompt must not be empty.');
  }

  if (normalizedPrompt.length > MAX_CODEX_DEEP_LINK_PROMPT_LENGTH) {
    throw new Error(`Codex prompt must be ${MAX_CODEX_DEEP_LINK_PROMPT_LENGTH.toLocaleString()} characters or fewer.`);
  }

  const deepLink = new URL('codex://threads/new');
  deepLink.searchParams.set('path', repoPath);
  deepLink.searchParams.set('prompt', normalizedPrompt);
  return deepLink.toString();
}
