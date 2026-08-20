import { constants } from 'node:fs';
import { access, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, join, win32 } from 'node:path';
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
  const args = [
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
  ];
  const launch = piLaunchCommand(executable, args);
  const child = spawn(
    launch.command,
    launch.args,
    {
      cwd: options.cwd,
      env: await buildPiEnvironment(executable),
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
      options.errorLabel
    );
  } finally {
    activeProcesses.delete(child);
  }
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
  errorLabel: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
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
      stdout += chunk;
      if (stdout.length > maxOutputCharacters) {
        terminatePiProcess(child);
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
