import { access, chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildPiEnvironment,
  piLaunchCommand,
  piFinalResponse,
  resolvePiExecutable,
  resolvePiEnvironment,
  runPiPrompt
} from './piHarness';

describe('Pi harness', () => {
  beforeEach(() => {
    vi.stubEnv('SHELL', '/nonexistent/git-gud-test-shell');
  });
  it('extracts the final answer after repository tools and rejects provider errors', () => {
    const events = [
      { type: 'message_end', message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'text', text: 'Investigating' }] } },
      { type: 'message_end', message: { role: 'toolResult', content: [{ type: 'text', text: 'test output' }] } },
      { type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'thinking', thinking: 'reasoning' }, { type: 'text', text: '{"findings":[]}' }] } }
    ];
    expect(piFinalResponse(events.map((event) => JSON.stringify(event)).join('\n'))).toBe('{"findings":[]}');
    expect(() => piFinalResponse(JSON.stringify({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'rate limited' } }))).toThrow('rate limited');
    expect(() => piFinalResponse(JSON.stringify(events[0]))).toThrow('no final response');
    const failure = { type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'stream interrupted' } };
    expect(piFinalResponse([failure, ...events].map((event) => JSON.stringify(event)).join('\n'))).toBe('{"findings":[]}');
    expect(() => piFinalResponse([...events, failure].map((event) => JSON.stringify(event)).join('\n'))).toThrow('stream interrupted');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.runIf(process.platform !== 'win32')('uses the terminal Pi and agent directory instead of a stale desktop installation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'git-gud-pi-shell-'));
    const desktopBin = join(directory, 'desktop');
    const terminalBin = join(directory, 'terminal');
    const shell = join(directory, 'shell');
    const config = join(directory, 'shell-config.json');
    await Promise.all([mkdir(desktopBin), mkdir(terminalBin)]);
    await writeFile(join(desktopBin, 'pi'), `#!${process.execPath}\nprocess.stderr.write('wrong Pi installation');process.exit(1);`);
    await writeFile(join(terminalBin, 'pi'), `#!${process.execPath}\nprocess.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({agentDirectory:process.env.PI_CODING_AGENT_DIR,cwd:process.cwd()})));`);
    await writeFile(shell, `#!${process.execPath}
const settings=JSON.parse(require('fs').readFileSync(${JSON.stringify(config)},'utf8'));
process.stdout.write('shell startup noise\\n\\0__GIT_GUD_PI_ENV__\\0'+settings.path+'\\0'+settings.agentDirectory+'\\0\\0__GIT_GUD_PI_ENV_END__\\0');
`);
    await Promise.all([shell, join(desktopBin, 'pi'), join(terminalBin, 'pi')].map(path => chmod(path, 0o755)));
    vi.stubEnv('SHELL', shell);
    vi.stubEnv('PATH', desktopBin);
    vi.stubEnv('PI_EXECUTABLE_PATH', '');
    vi.stubEnv('PI_CODING_AGENT_DIR', '');
    try {
      for (const profile of ['first', 'reconfigured']) {
        const agentDirectory = join(directory, profile);
        await writeFile(config, JSON.stringify({ path: terminalBin, agentDirectory }));
        const output = await runPiPrompt({ cwd: directory, prompt: 'review', timeoutMs: 5000, errorLabel: 'Test' });
        expect(JSON.parse(output)).toEqual({ agentDirectory, cwd: directory });
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves explicit Pi overrides without invoking the login shell', async () => {
    const environment = { SHELL: '/missing/shell', PATH: '/desktop/bin', PI_EXECUTABLE_PATH: '/custom/pi', PI_CODING_AGENT_DIR: '/custom/agent' };
    expect(await resolvePiEnvironment('linux', environment, '/home/test')).toEqual(environment);
    expect(await resolvePiEnvironment('win32', environment, '/home/test')).toEqual(environment);
  });

  it('falls back to the desktop environment when shell startup fails', async () => {
    const environment = { SHELL: '/missing/shell', PATH: '/desktop/bin' };
    expect(await resolvePiEnvironment('linux', environment, '/home/test')).toEqual(environment);
  });

  it.runIf(process.platform !== 'win32')('reads an actual login shell without exposing unrelated environment values', async () => {
    const environment = { SHELL: '/bin/sh', PATH: '/usr/bin:/bin', PI_CODING_AGENT_DIR: '/explicit/agent', PRIVATE_TEST_VALUE: 'not-a-credential' };
    const result = await resolvePiEnvironment('linux', environment, tmpdir());
    expect(result.PI_CODING_AGENT_DIR).toBe('/explicit/agent');
    expect(result.PRIVATE_TEST_VALUE).toBe(environment.PRIVATE_TEST_VALUE);
    expect(result.PATH).toContain('/usr/bin');
    expect(environment.PATH).toBe('/usr/bin:/bin');
  });

  it.runIf(process.platform !== 'win32').each([false, true])(
    'explains rejected OpenAI refresh tokens in JSON mode=%s and succeeds after reauthentication',
    async (finalResponseOnly) => {
      const directory = await mkdtemp(join(tmpdir(), 'git-gud-pi-auth-'));
      const executable = join(directory, 'pi');
      await writeFile(executable, `#!/usr/bin/env node
const fs = require('node:fs');
process.stdin.resume();
process.stdin.on('end', () => {
  const recovered = fs.existsSync('signed-in');
  const errorMessage = 'OAuth refresh failed for openai: OpenAI OAuth token request failed (400): {"error":"invalid_grant"}';
  if (process.argv.includes('json')) {
    console.log(JSON.stringify({ type: 'message_end', message: { role: 'assistant', stopReason: recovered ? 'stop' : 'error', errorMessage, content: [{ type: 'text', text: 'ready' }] } }));
  } else if (recovered) {
    console.log('ready');
  } else {
    console.error(errorMessage);
    process.exitCode = 1;
  }
});
`);
      await chmod(executable, 0o755);
      vi.stubEnv('PI_EXECUTABLE_PATH', executable);
      const options = { cwd: directory, prompt: 'review', timeoutMs: 5000, errorLabel: 'Test', finalResponseOnly };
      try {
        await expect(runPiPrompt(options)).rejects.toThrow(
          `Pi could not refresh its OpenAI sign-in. Pi executable: ${executable}. Agent directory:`
        );
        await writeFile(join(directory, 'signed-in'), '');
        expect((await runPiPrompt(options)).trim()).toBe('ready');
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );

  it.runIf(process.platform !== 'win32').each([
    { name: 'long investigation with fragmented events and an unterminated final line', mode: 'long', expected: '{"findings":[]}' },
    { name: 'oversized final answer', mode: 'answer', error: 'output exceeded the safe size limit' },
    { name: 'oversized event', mode: 'event', error: 'event exceeded the safe size limit' },
    { name: 'plain text output limit', mode: 'text', error: 'output exceeded the safe size limit' },
    { name: 'provider failure after tool output', mode: 'provider', error: 'rate limited' },
    { name: 'successful Pi retry after an interrupted stream', mode: 'retry', expected: '{"findings":[]}' },
    { name: 'malformed event', mode: 'malformed', error: 'JSON' },
    { name: 'missing final answer', mode: 'missing', error: 'no final response' }
  ])('handles $name', async ({ mode, expected, error }) => {
    const directory = await mkdtemp(join(tmpdir(), 'git-gud-pi-stream-'));
    const executable = join(directory, 'pi');
    await writeFile(executable, `#!/usr/bin/env node
const mode = ${JSON.stringify(mode)};
const write = (text) => new Promise(resolve => process.stdout.write(text, resolve));
const event = (message) => JSON.stringify({ type: 'message_end', message });
process.stdin.resume();
process.stdin.on('end', async () => {
  if (mode === 'retry') {
    await write(event({ role: 'assistant', stopReason: 'error', errorMessage: 'OpenAI Responses stream ended before a terminal response event' }) + '\\n');
    await write(JSON.stringify({ type: 'auto_retry_start', attempt: 1 }) + '\\n');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (mode === 'event') { await write('x'.repeat(16_000_001)); return; }
  if (mode === 'text') { await write('x'.repeat(2_000_001)); return; }
  if (mode === 'malformed') { await write('invalid JSON\\n'); return; }
  const tool = event({ role: 'toolResult', content: [{ type: 'text', text: 'x'.repeat(40_000) }] }) + '\\n';
  for (let i = 0; i < 60; i++) {
    await write(tool.slice(0, 17));
    await write(tool.slice(17));
  }
  if (mode === 'missing') return;
  if (mode === 'provider') {
    await write(event({ role: 'assistant', stopReason: 'error', errorMessage: 'rate limited' }) + '\\n');
    return;
  }
  const final = event({ role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: mode === 'answer' ? 'x'.repeat(2_000_001) : '{"findings":[]}' }] });
  await write(final.slice(0, 23));
  await write(final.slice(23));
});
`);
    await chmod(executable, 0o755);
    vi.stubEnv('PI_EXECUTABLE_PATH', executable);
    try {
      const result = runPiPrompt({ cwd: directory, prompt: 'review', timeoutMs: 10_000, errorLabel: 'Test', finalResponseOnly: mode !== 'text' });
      if (error) await expect(result).rejects.toThrow(error);
      else await expect(result).resolves.toBe(expected);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== 'win32')('pins app generation to Astra with medium thinking', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'git-gud-pi-model-'));
    const executable = join(directory, 'pi');
    await writeFile(executable, '#!/usr/bin/env node\nprocess.stdin.resume();process.stdin.on("end", () => process.stdout.write(JSON.stringify(process.argv.slice(2))));');
    await chmod(executable, 0o755);
    vi.stubEnv('PI_EXECUTABLE_PATH', executable);
    try {
      const result = await runPiPrompt({ cwd: directory, prompt: 'hello', timeoutMs: 5000, errorLabel: 'Test' });
      const args: unknown = JSON.parse(result);
      expect(args).toEqual(expect.arrayContaining(['--model', 'openai/gpt-6-astra', '--thinking', 'medium', '--no-tools']));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== 'win32')(
    'adds an installed NVM Node runtime to a restricted app PATH',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'git-gud-pi-harness-'));
      const nvmDirectory = join(directory, 'nvm');
      const nodeDirectory = join(nvmDirectory, 'versions/node/v24.18.0/bin');
      const nodeExecutable = join(nodeDirectory, 'node');
      const piExecutable = join(directory, 'pi');
      await mkdir(nodeDirectory, { recursive: true });
      await writeFile(nodeExecutable, '#!/bin/sh\n/bin/cat\n');
      await writeFile(piExecutable, '#!/bin/sh\nexec node "$@"\n');
      await Promise.all([chmod(nodeExecutable, 0o755), chmod(piExecutable, 0o755)]);
      vi.stubEnv('NVM_DIR', nvmDirectory);
      vi.stubEnv('PATH', '/usr/bin:/bin');
      vi.stubEnv('PI_EXECUTABLE_PATH', piExecutable);

      try {
        await expect(
          runPiPrompt({
            cwd: directory,
            prompt: 'generated summary',
            timeoutMs: 5_000,
            errorLabel: 'Test engine'
          })
        ).resolves.toBe('generated summary');
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );

  it.runIf(process.platform !== 'win32')(
    'finds Pi installed with NVM when the app inherits a restricted PATH',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'git-gud-pi-harness-'));
      const nvmDirectory = join(directory, 'nvm');
      const nodeDirectory = join(nvmDirectory, 'versions/node/v24.18.0/bin');
      const nodeExecutable = join(nodeDirectory, 'node');
      const piExecutable = join(nodeDirectory, 'pi');
      await mkdir(nodeDirectory, { recursive: true });
      await writeFile(nodeExecutable, '#!/bin/sh\n/bin/cat\n');
      await writeFile(piExecutable, '#!/bin/sh\nexec node "$@"\n');
      await Promise.all([chmod(nodeExecutable, 0o755), chmod(piExecutable, 0o755)]);
      vi.stubEnv('NVM_DIR', nvmDirectory);
      vi.stubEnv('PATH', '/usr/bin:/bin');
      vi.stubEnv('PI_EXECUTABLE_PATH', '');

      try {
        await expect(
          runPiPrompt({
            cwd: directory,
            prompt: 'generated summary',
            timeoutMs: 5_000,
            errorLabel: 'Test engine'
          })
        ).resolves.toBe('generated summary');
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );

  it('finds a Windows pnpm command shim with case-insensitive environment keys', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'git-gud-windows-pi-resolution-'));
    const pnpmDirectory = join(directory, 'pnpm');
    const piExecutable = join(pnpmDirectory, 'pi.cmd');
    await mkdir(pnpmDirectory, { recursive: true });
    await writeFile(piExecutable, '@echo off\r\n');
    await chmod(piExecutable, 0o755);

    try {
      await expect(
        resolvePiExecutable('win32', { Path: '', pnpm_home: pnpmDirectory }, directory)
      ).resolves.toBe(piExecutable);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('finds a Windows npm command shim in the roaming app data directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'git-gud-windows-pi-resolution-'));
    const appData = join(directory, 'Roaming');
    const npmDirectory = join(appData, 'npm');
    const piExecutable = join(npmDirectory, 'pi.cmd');
    await mkdir(npmDirectory, { recursive: true });
    await writeFile(piExecutable, '@echo off\r\n');
    await chmod(piExecutable, 0o755);

    try {
      await expect(
        resolvePiExecutable('win32', { path: '', AppData: appData }, directory)
      ).resolves.toBe(piExecutable);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('launches Windows command shims through cmd.exe without enabling a shell', () => {
    expect(
      piLaunchCommand(
        'C:\\Program Files\\pnpm\\pi.cmd',
        ['--print', '--tools', 'read,grep'],
        'win32',
        { COMSPEC: 'C:\\Windows\\System32\\cmd.exe' }
      )
    ).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        '"C:\\Program^ Files\\pnpm\\pi.cmd ^"--print^" ^"--tools^" ^"read^,grep^""'
      ],
      windowsVerbatimArguments: true
    });
  });

  it.runIf(process.platform === 'win32')(
    'executes a command shim installed in a directory containing spaces',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'git gud pi command '));
      const piExecutable = join(directory, 'pi.cmd');
      await writeFile(piExecutable, '@echo off\r\nmore\r\n');
      vi.stubEnv('PI_EXECUTABLE_PATH', piExecutable);

      try {
        await expect(
          runPiPrompt({
            cwd: directory,
            prompt: 'generated summary',
            timeoutMs: 5_000,
            errorLabel: 'Test engine'
          })
        ).resolves.toContain('generated summary');
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );

  it.runIf(process.platform === 'win32')(
    'terminates command-shim descendants when a prompt times out',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'git-gud-pi-process-tree-'));
      const piExecutable = join(directory, 'pi.cmd');
      const orphanMarker = join(directory, 'orphaned.txt');
      await writeFile(
        piExecutable,
        '@echo off\r\ncmd.exe /d /s /c "ping.exe -n 3 127.0.0.1 > nul && echo orphaned>orphaned.txt"\r\n'
      );
      vi.stubEnv('PI_EXECUTABLE_PATH', piExecutable);

      try {
        await expect(
          runPiPrompt({
            cwd: directory,
            prompt: 'ignored',
            timeoutMs: 100,
            errorLabel: 'Test engine'
          })
        ).rejects.toThrow('Test engine timed out.');
        await new Promise((resolve) => setTimeout(resolve, 3_500));
        await expect(access(orphanMarker)).rejects.toThrow();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );

  it('normalizes Windows Path casing while preserving inherited directories', async () => {
    const environment = await buildPiEnvironment(
      'C:\\Users\\dev\\AppData\\Local\\pnpm\\pi.cmd',
      'win32',
      { Path: 'C:\\Windows\\System32;C:\\Program Files\\nodejs' },
      'C:\\Users\\dev'
    );

    expect(environment.Path).toBeUndefined();
    expect(environment.PATH?.split(';')).toEqual(
      expect.arrayContaining(['C:\\Windows\\System32', 'C:\\Program Files\\nodejs'])
    );
  });
});
