import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

const DEFAULT_MAX_OUTPUT_CHARACTERS = 2_000_000;
const activeProcesses = new Set<ChildProcessWithoutNullStreams>();

export type PiPromptOptions = {
  cwd: string;
  prompt: string;
  timeoutMs: number;
  tools?: string;
  maxOutputCharacters?: number;
  errorLabel: string;
};

export async function runPiPrompt(options: PiPromptOptions): Promise<string> {
  const child = spawn(
    await resolvePiExecutable(),
    [
      '--print',
      '--no-session',
      '--mode',
      'text',
      ...(options.tools ? ['--tools', options.tools] : ['--no-tools']),
      '--no-extensions',
      '--no-skills',
      '--no-prompt-templates',
      '--no-context-files',
      '--no-approve'
    ],
    {
      cwd: options.cwd,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: 'pipe'
    }
  );
  activeProcesses.add(child);

  try {
    return await collectProcessOutput(
      child,
      options.prompt,
      options.timeoutMs,
      options.maxOutputCharacters ?? DEFAULT_MAX_OUTPUT_CHARACTERS,
      options.errorLabel
    );
  } finally {
    activeProcesses.delete(child);
  }
}

export function shutdownPiProcesses(): void {
  for (const child of activeProcesses) {
    child.kill('SIGTERM');
  }
  activeProcesses.clear();
}

async function resolvePiExecutable(): Promise<string> {
  const configuredPath = process.env.PI_EXECUTABLE_PATH?.trim();
  const pathCandidates = (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory, 'pi'));
  const candidates = configuredPath
    ? [configuredPath]
    : [
        ...pathCandidates,
        join(homedir(), 'Library/pnpm/pi'),
        join(homedir(), '.local/bin/pi'),
        '/opt/homebrew/bin/pi',
        '/usr/local/bin/pi'
      ];

  for (const candidate of new Set(candidates)) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through the known installation locations.
    }
  }

  throw new Error('The configured AI engine is unavailable. Install Pi or configure its executable path.');
}

function collectProcessOutput(
  child: ChildProcessWithoutNullStreams,
  prompt: string,
  timeoutMs: number,
  maxOutputCharacters: number,
  errorLabel: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      finish(new Error(`${errorLabel} timed out.`));
    }, timeoutMs);
    timeout.unref();

    function finish(error?: Error, output?: string): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
      } else {
        resolve(output ?? '');
      }
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > maxOutputCharacters) {
        child.kill('SIGTERM');
        finish(new Error(`${errorLabel} output exceeded the safe size limit.`));
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4_000);
    });
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') {
        finish(error);
      }
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (code === 0) {
        finish(undefined, stdout);
        return;
      }

      const detail = stripAnsi(stderr).trim();
      finish(new Error(detail || `${errorLabel} exited with code ${code ?? 'unknown'}.`));
    });
    child.stdin.end(prompt);
  });
}

function stripAnsi(value: string): string {
  const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');
  return value.replace(ansiPattern, '');
}
