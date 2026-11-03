import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { resolvePiEnvironment } from './piHarness';

const MAX_OUTPUT_CHARACTERS = 2_000_000;
const activeProcesses = new Set<ChildProcessWithoutNullStreams>();

// Variables a parent Claude Code session sets for its own children. A guide run is a separate
// one-shot prompt, so it must not attach to (or be refused by) whatever session launched Git Gud.
const SESSION_VARIABLES = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_AGENT_SDK_VERSION|CLAUDE_CODE_(?!USE_|OAUTH|API).*)$/u;

export type ClaudePromptOptions = {
  cwd: string;
  prompt: string;
  timeoutMs: number;
  errorLabel: string;
};

/** Runs one tool-less prompt through the Claude Code CLI (`claude -p`) and returns its text answer. */
export async function runClaudePrompt(options: ClaudePromptOptions): Promise<string> {
  const environment = await resolvePiEnvironment();
  const executable = await resolveClaudeExecutable(environment);
  const env = Object.fromEntries(Object.entries(environment).filter(([key]) => !SESSION_VARIABLES.test(key)));
  const child = spawn(executable, ['-p', '--output-format', 'text', '--tools', ''], {
    cwd: options.cwd,
    env,
    stdio: 'pipe',
    windowsHide: true
  });
  activeProcesses.add(child);

  try {
    return await new Promise<string>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`${options.errorLabel} timed out.`));
      }, options.timeoutMs);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        if (stdout.length > MAX_OUTPUT_CHARACTERS) {
          child.kill('SIGTERM');
          reject(new Error(`${options.errorLabel} output exceeded the safe size limit.`));
        }
      });
      child.stderr.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-4_000); });
      child.on('error', (error) => { clearTimeout(timer); reject(error); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && stdout.trim()) resolve(stdout);
        else reject(new Error(`${options.errorLabel} failed: ${(stderr || stdout).trim() || `Claude Code exited with code ${code}.`}`));
      });
      child.stdin.end(options.prompt);
    });
  } finally {
    activeProcesses.delete(child);
  }
}

export function shutdownClaudeProcesses(): void {
  for (const child of activeProcesses) child.kill('SIGTERM');
  activeProcesses.clear();
}

// Finder-launched apps get a minimal PATH; also check where the installer and Homebrew put `claude`.
async function resolveClaudeExecutable(environment: NodeJS.ProcessEnv): Promise<string> {
  const home = homedir();
  const directories = [
    ...(environment.PATH ?? '').split(delimiter).filter(Boolean),
    join(home, '.local/bin'),
    join(home, '.claude/local'),
    '/opt/homebrew/bin',
    '/usr/local/bin'
  ];
  for (const directory of directories) {
    const candidate = join(directory, process.platform === 'win32' ? 'claude.exe' : 'claude');
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep looking.
    }
  }
  throw new Error('Claude Code was not found. Install the claude CLI or sign in to Pi.');
}
