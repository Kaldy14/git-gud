import { stripIpcErrorPrefix } from '@shared/ipcErrors';

/** Returns the main-process error text a person should read, without Electron's IPC wrapper. */
export function ipcErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? stripIpcErrorPrefix(error.message) : fallback;
}

export function describeOperationError(message: string): { summary: string; hint?: string; detail?: string } {
  const lines = message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  if (lines[0]?.startsWith('Cloning into ')) {
    return {
      summary: 'Could not clone repository',
      hint: 'Check the repository URL and your access, then try again.',
      detail: message
    };
  }

  if (lines.length > 1) {
    const failure = lines.find((line) => /^(fatal|error):/i.test(line));
    return { summary: failure?.replace(/^(fatal|error):\s*/i, '') ?? 'Git operation failed', detail: message };
  }

  return { summary: message || 'Git operation failed' };
}
