import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runPiPrompt } from './piHarness';

describe('Pi harness', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('adds an installed NVM Node runtime to a restricted app PATH', async () => {
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
  });

  it('finds Pi installed with NVM when the app inherits a restricted PATH', async () => {
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
  });
});
