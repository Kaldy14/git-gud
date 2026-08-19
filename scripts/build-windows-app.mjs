#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { env, execPath } from 'node:process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const appVersion = env.GIT_GUD_VERSION?.trim().replace(/^v/, '') || packageJson.version;
const electronBuilderCli = require.resolve('electron-builder/cli.js');

execFileSync(
  execPath,
  [
    electronBuilderCli,
    '--win',
    'portable',
    '--x64',
    '--config',
    'electron-builder.windows.yml',
    `--config.extraMetadata.version=${appVersion}`,
    '--publish',
    'never'
  ],
  { cwd: repoRoot, env, stdio: 'inherit' }
);
