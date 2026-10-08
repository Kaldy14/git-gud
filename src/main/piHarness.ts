import { constants } from 'node:fs';
import { access, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, join, posix, win32 } from 'node:path';
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';

const DEFAULT_MAX_OUTPUT_CHARACTERS = 2_000_000;
const MAX_EVENT_CHARACTERS = 16_000_000;
const activeProcesses = new Set<ChildProcessWithoutNullStreams>();
const execFileAsync = promisify(execFile);

export type PiPromptOptions = {
  cwd: string;
  prompt: string;
  timeoutMs: number;
  tools?: string;
  finalResponseOnly?: boolean;
  maxOutputCharacters?: number;
  errorLabel: string;
};

export async function runPiPrompt(options: PiPromptOptions): Promise<string> {
  const environment = await resolvePiEnvironment();
  const executable = await resolvePiExecutable(process.platform, environment);
  const args = [
    '--model',
    'openai/gpt-6-astra',
    '--thinking',
    'medium',
    '--print',
    '--no-session',
    '--mode',
    options.finalResponseOnly ? 'json' : 'text',
    ...(options.tools ? ['--tools', options.tools] : ['--no-tools']),
    '--no-extensions',
    '--no-skills',
    '--no-prompt-templates',
    '--no-context-files',
    '--no-approve'
  ];
  const launch = piLaunchCommand(executable, args, process.platform, environment);
  const child = spawn(
    launch.command,
    launch.args,
    {
      cwd: options.cwd,
      env: await buildPiEnvironment(executable, process.platform, environment),
      stdio: 'pipe',
      windowsHide: true,
      windowsVerbatimArguments: launch.windowsVerbatimArguments
    }
  );
  activeProcesses.add(child);

  try {
    return await collectProcessOutput(
      child,
      options.prompt,
      options.timeoutMs,
      options.maxOutputCharacters ?? DEFAULT_MAX_OUTPUT_CHARACTERS,
      options.errorLabel,
      options.finalResponseOnly ?? false
    );
  } catch (error) {
    // A rejected refresh token needs a new login; retrying the prompt cannot repair it.
    if (error instanceof Error && /OAuth refresh failed for openai\b/i.test(error.message) &&
      /invalid_grant|invalid_state|refresh_token_reused|refresh_token_expired|refresh_token_invalid/i.test(error.message)) {
      const agentDirectory = environment.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent');
      throw new Error(
        `Pi could not refresh its OpenAI sign-in. Pi executable: ${executable}. Agent directory: ${agentDirectory}. ` +
        'If Pi works in your terminal, check that it uses this same installation and directory, then retry. ' +
        'Otherwise run /login in that Pi installation and choose OpenAI.',
        { cause: error }
      );
    }
    throw error;
  } finally {
    activeProcesses.delete(child);
  }
}

// Desktop launches do not inherit interactive shell configuration. Read only the
// Pi-related settings, never credentials, and resolve afresh on each retry.
export async function resolvePiEnvironment(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): Promise<NodeJS.ProcessEnv> {
  const result = { ...environment };
  if (platform !== 'win32' && !environment.PI_EXECUTABLE_PATH?.trim()) {
    const shell = environment.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
    try {
      const { stdout } = await execFileAsync(shell, ['-ilc',
        `printf '\\0__GIT_GUD_PI_ENV__\\0%s\\0%s\\0%s\\0__GIT_GUD_PI_ENV_END__\\0' "$PATH" "$PI_CODING_AGENT_DIR" "$PI_EXECUTABLE_PATH"`
      ], { cwd: home, env: environment, timeout: 5000, maxBuffer: 64 * 1024, encoding: 'utf8' });
      const fields = stdout.split('\0');
      const start = fields.indexOf('__GIT_GUD_PI_ENV__');
      if (start >= 0 && fields[start + 4] === '__GIT_GUD_PI_ENV_END__') {
        const [path, agentDirectory, executable] = fields.slice(start + 1, start + 4);
        if (path) result.PATH = [path, environment.PATH].filter(Boolean).join(delimiter);
        if (agentDirectory && !environment.PI_CODING_AGENT_DIR?.trim()) result.PI_CODING_AGENT_DIR = agentDirectory;
        if (executable) result.PI_EXECUTABLE_PATH = executable;
      }
    } catch {
      // Broken or non-interactive-only shell startup must not prevent fallback discovery.
    }
  }
  // Pi jobs run in different repositories (and temporary bug-finder checkouts).
  // A relative configured agent directory must not change with the job's cwd.
  const agentDirectory = result.PI_CODING_AGENT_DIR?.trim();
  if (agentDirectory && platform !== 'win32') {
    result.PI_CODING_AGENT_DIR = agentDirectory === '~' ? home
      : agentDirectory.startsWith('~/') ? posix.join(home, agentDirectory.slice(2))
        : posix.resolve(home, agentDirectory);
  }
  return result;
}

export function piFinalResponse(output: string): string {
  let final: string | Error = '';
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    final = piEventResponse(line) ?? final;
  }
  if (final instanceof Error) throw final;
  if (!final.trim()) throw new Error('Pi investigation returned no final response.');
  return final;
}

function piEventResponse(line: string): string | Error | undefined {
  const event: unknown = JSON.parse(line);
  if (!event || typeof event !== 'object' || !('type' in event) || event.type !== 'message_end' || !('message' in event)) return undefined;
  const message = event.message;
  if (!message || typeof message !== 'object' || !('role' in message) || message.role !== 'assistant' || !('stopReason' in message)) return undefined;
  if (message.stopReason === 'error' || message.stopReason === 'aborted') {
    return new Error('errorMessage' in message && typeof message.errorMessage === 'string' ? message.errorMessage : 'Pi investigation failed.');
  }
  if (message.stopReason === 'toolUse') return undefined;
  if (!('content' in message) || !Array.isArray(message.content)) return undefined;
  return message.content.flatMap((part: unknown) => part && typeof part === 'object' && 'type' in part && part.type === 'text' && 'text' in part && typeof part.text === 'string' ? [part.text] : []).join('\n');
}

export async function buildPiEnvironment(
  executable: string,
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): Promise<NodeJS.ProcessEnv> {
  const pathDelimiter = platform === 'win32' ? win32.delimiter : delimiter;
  const existingPath = (environmentValue(environment, 'PATH', platform) ?? '')
    .split(pathDelimiter)
    .filter(Boolean);
  const nvmDirectory =
    environmentValue(environment, 'NVM_DIR', platform)?.trim() || join(home, '.nvm');
  const nvmNodeDirectories = await listNvmNodeDirectories(nvmDirectory);
  const knownDirectories =
    platform === 'win32'
      ? windowsPiDirectories(environment, home)
      : [
          ...nvmNodeDirectories,
          join(home, '.volta/bin'),
          join(home, '.local/share/mise/shims'),
          '/opt/homebrew/bin',
          '/usr/local/bin'
        ];
  const path = [dirname(executable), ...knownDirectories, ...existingPath];
  const result = { ...environment };
  for (const key of Object.keys(result)) {
    if (platform === 'win32' && key.toLowerCase() === 'path') {
      delete result[key];
    }
  }

  return {
    ...result,
    PATH: [...new Set(path)].join(pathDelimiter),
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
    terminatePiProcess(child);
  }
  activeProcesses.clear();
}

export async function resolvePiExecutable(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): Promise<string> {
  const pathDelimiter = platform === 'win32' ? win32.delimiter : delimiter;
  const configuredPath = environmentValue(environment, 'PI_EXECUTABLE_PATH', platform)?.trim();
  const inheritedDirectories = (environmentValue(environment, 'PATH', platform) ?? '')
    .split(pathDelimiter)
    .filter(Boolean);
  const nvmDirectory =
    environmentValue(environment, 'NVM_DIR', platform)?.trim() || join(home, '.nvm');
  const nvmNodeDirectories = await listNvmNodeDirectories(nvmDirectory);
  const searchDirectories = [
    ...inheritedDirectories,
    environmentValue(environment, 'NVM_BIN', platform)?.trim(),
    environmentValue(environment, 'PNPM_HOME', platform)?.trim(),
    ...nvmNodeDirectories,
    ...(platform === 'win32'
      ? windowsPiDirectories(environment, home)
      : [
          join(home, 'Library/pnpm'),
          join(home, '.local/bin'),
          join(home, '.volta/bin'),
          join(home, '.local/share/mise/shims'),
          join(home, '.asdf/shims'),
          join(home, '.bun/bin'),
          '/opt/homebrew/bin',
          '/usr/local/bin'
        ])
  ].filter((directory): directory is string => Boolean(directory));
  const executableNames = platform === 'win32' ? ['pi.cmd', 'pi.exe', 'pi'] : ['pi'];
  const candidates = configuredPath
    ? [configuredPath]
    : searchDirectories.flatMap((directory) =>
        executableNames.map((executableName) => join(directory, executableName))
      );

  for (const candidate of new Set(candidates)) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue through the known installation locations.
    }
  }

  throw new Error(
    'Pi was not found. Install Pi or set PI_EXECUTABLE_PATH to the installed executable.'
  );
}

function windowsPiDirectories(environment: NodeJS.ProcessEnv, home: string): string[] {
  const appData = environmentValue(environment, 'APPDATA', 'win32');
  const localAppData = environmentValue(environment, 'LOCALAPPDATA', 'win32');
  const chocolateyInstall = environmentValue(environment, 'ChocolateyInstall', 'win32');
  const npmPrefix = environmentValue(environment, 'npm_config_prefix', 'win32');

  return [
    environmentValue(environment, 'PNPM_HOME', 'win32'),
    appData && join(appData, 'npm'),
    localAppData && join(localAppData, 'pnpm'),
    npmPrefix,
    join(home, 'AppData', 'Roaming', 'npm'),
    join(home, 'AppData', 'Local', 'pnpm'),
    join(home, 'scoop', 'shims'),
    chocolateyInstall && join(chocolateyInstall, 'bin')
  ].filter((directory): directory is string => Boolean(directory));
}

function environmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
  platform: NodeJS.Platform
): string | undefined {
  if (platform !== 'win32') {
    return environment[name];
  }

  const matchingKey = Object.keys(environment).find((key) => key.toLowerCase() === name.toLowerCase());
  return matchingKey ? environment[matchingKey] : undefined;
}

export type PiLaunchCommand = {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
};

export function piLaunchCommand(
  executable: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env
): PiLaunchCommand {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/iu.test(executable)) {
    return { command: executable, args };
  }

  const command = [
    escapeWindowsCommand(executable),
    ...args.map(escapeWindowsCommandArgument)
  ].join(' ');
  return {
    command: environmentValue(environment, 'ComSpec', 'win32')?.trim() || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${command}"`],
    windowsVerbatimArguments: true
  };
}

const windowsCommandMetaCharacters = /([()\][%!^"`<>&|;, *?])/gu;

function escapeWindowsCommand(command: string): string {
  return command.replace(windowsCommandMetaCharacters, '^$1');
}

function escapeWindowsCommandArgument(argument: string): string {
  const quoted = `"${argument
    .replace(/(?=(\\+?)?)\1"/gu, '$1$1\\"')
    .replace(/(?=(\\+?)?)\1$/gu, '$1$1')}"`;
  return quoted.replace(windowsCommandMetaCharacters, '^$1');
}

function terminatePiProcess(child: ChildProcessWithoutNullStreams): void {
  if (process.platform === 'win32' && child.pid !== undefined) {
    try {
      const terminator = spawn(
        'taskkill.exe',
        ['/PID', String(child.pid), '/T', '/F'],
        { stdio: 'ignore', windowsHide: true }
      );
      terminator.once('error', () => child.kill('SIGTERM'));
      return;
    } catch {
      // Fall back to terminating the wrapper process below.
    }
  }

  child.kill('SIGTERM');
}

function collectProcessOutput(
  child: ChildProcessWithoutNullStreams,
  prompt: string,
  timeoutMs: number,
  maxOutputCharacters: number,
  errorLabel: string,
  finalResponseOnly: boolean
): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let pendingEvent = '';
    let responseError: Error | undefined;

    function consumeEvent(line: string): void {
      if (!line.trim()) return;
      const response = piEventResponse(line);
      if (response instanceof Error) {
        // Pi may retry a failed assistant turn. Wait for process completion so
        // a recovered answer can replace this error without restarting tools.
        responseError = response;
        stdout = '';
        return;
      }
      if (response !== undefined) {
        if (response.length > maxOutputCharacters) {
          throw new Error(`${errorLabel} output exceeded the safe size limit.`);
        }
        stdout = response;
        responseError = undefined;
      }
    }
    let settled = false;
    const timeout = setTimeout(() => {
      terminatePiProcess(child);
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
      if (settled) return;
      try {
        if (finalResponseOnly) {
          // Pi emits NDJSON, including repeated snapshots and tool output. Retain
          // only the final answer instead of accumulating the whole investigation.
          let start = 0;
          while (start < chunk.length) {
            const newline = chunk.indexOf('\n', start);
            const end = newline < 0 ? chunk.length : newline;
            if (pendingEvent.length + end - start > MAX_EVENT_CHARACTERS) {
              throw new Error(`${errorLabel} event exceeded the safe size limit.`);
            }
            pendingEvent += chunk.slice(start, end);
            if (newline < 0) break;
            consumeEvent(pendingEvent);
            pendingEvent = '';
            start = newline + 1;
          }
        } else {
          if (stdout.length + chunk.length > maxOutputCharacters) {
            throw new Error(`${errorLabel} output exceeded the safe size limit.`);
          }
          stdout += chunk;
        }
      } catch (error) {
        terminatePiProcess(child);
        finish(error instanceof Error ? error : new Error(String(error)));
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
      if (settled) return;
      try {
        if (finalResponseOnly) {
          consumeEvent(pendingEvent);
          if (responseError) throw responseError;
          if (code === 0 && !stdout.trim()) throw new Error('Pi investigation returned no final response.');
        }
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
        return;
      }
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
