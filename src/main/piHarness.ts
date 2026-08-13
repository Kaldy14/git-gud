import { constants } from 'node:fs';
import { access, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
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
  const executable = await resolvePiExecutable();
  const child = spawn(
    executable,
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
      env: await buildPiEnvironment(executable),
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

async function buildPiEnvironment(executable: string): Promise<NodeJS.ProcessEnv> {
  const home = homedir();
  const existingPath = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  const nvmDirectory = process.env.NVM_DIR?.trim() || join(home, '.nvm');
  const nvmNodeDirectories = await listNvmNodeDirectories(nvmDirectory);
  const path = [
    dirname(executable),
    ...nvmNodeDirectories,
    join(home, '.volta/bin'),
    join(home, '.local/share/mise/shims'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    ...existingPath
  ];

  return {
    ...process.env,
    PATH: [...new Set(path)].join(delimiter),
    NO_COLOR: '1'
  };
}

async function listNvmNodeDirectories(nvmDirectory: string): Promise<string[]> {
  const versionsDirectory = join(nvmDirectory, 'versions/node');

  try {
    const entries = await readdir(versionsDirectory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
      .map((version) => join(versionsDirectory, version, 'bin'));
  } catch {
    return [];
  }
}

export function shutdownPiProcesses(): void {
  for (const child of activeProcesses) {
    child.kill('SIGTERM');
  }
  activeProcesses.clear();
}

async function resolvePiExecutable(): Promise<string> {
  const home = homedir();
  const configuredPath = process.env.PI_EXECUTABLE_PATH?.trim();
  const inheritedDirectories = (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean);
  const nvmDirectory = process.env.NVM_DIR?.trim() || join(home, '.nvm');
  const nvmNodeDirectories = await listNvmNodeDirectories(nvmDirectory);
  const searchDirectories = [
    ...inheritedDirectories,
    process.env.NVM_BIN?.trim(),
    process.env.PNPM_HOME?.trim(),
    ...nvmNodeDirectories,
    join(home, 'Library/pnpm'),
    join(home, '.local/bin'),
    join(home, '.volta/bin'),
    join(home, '.local/share/mise/shims'),
    join(home, '.asdf/shims'),
    join(home, '.bun/bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin'
  ].filter((directory): directory is string => Boolean(directory));
  const candidates = configuredPath
    ? [configuredPath]
    : searchDirectories.map((directory) => join(directory, 'pi'));

  for (const candidate of new Set(candidates)) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through the known installation locations.
    }
  }

  throw new Error(
    'Pi was not found. Install Pi or set PI_EXECUTABLE_PATH to the executable installed on this Mac.'
  );
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
