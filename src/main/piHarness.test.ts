import { access, chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildPiEnvironment,
  piLaunchCommand,
  piFinalResponse,
  resolvePiExecutable,
  runPiPrompt
} from './piHarness';

describe('Pi harness', () => {
  it('extracts the final answer after repository tools and rejects provider errors', () => {
    const events = [
      { type: 'message_end', message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'text', text: 'Investigating' }] } },
      { type: 'message_end', message: { role: 'toolResult', content: [{ type: 'text', text: 'test output' }] } },
      { type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'thinking', thinking: 'reasoning' }, { type: 'text', text: '{"findings":[]}' }] } }
    ];
    expect(piFinalResponse(events.map((event) => JSON.stringify(event)).join('\n'))).toBe('{"findings":[]}');
    expect(() => piFinalResponse(JSON.stringify({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'rate limited' } }))).toThrow('rate limited');
    expect(() => piFinalResponse(JSON.stringify(events[0]))).toThrow('no final response');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.runIf(process.platform !== 'win32').each([
    { name: 'long investigation with fragmented events and an unterminated final line', mode: 'long', expected: '{"findings":[]}' },
    { name: 'oversized final answer', mode: 'answer', error: 'output exceeded the safe size limit' },
    { name: 'oversized event', mode: 'event', error: 'event exceeded the safe size limit' },
    { name: 'plain text output limit', mode: 'text', error: 'output exceeded the safe size limit' },
    { name: 'provider failure after tool output', mode: 'provider', error: 'rate limited' },
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
      expect(args).toEqual(expect.arrayContaining(['--model', 'openai-codex/gpt-6-astra', '--thinking', 'medium', '--no-tools']));
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
