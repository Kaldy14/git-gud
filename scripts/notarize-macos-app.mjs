#!/usr/bin/env node
import { notarize } from '@electron/notarize';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { env, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const appPath = join(repoRoot, 'dist', 'mac', 'Git Gud.app');
const appleApiKey = requiredEnvironmentVariable('APPLE_API_KEY_PATH');
const appleApiKeyId = requiredEnvironmentVariable('APPLE_API_KEY_ID');
const appleApiIssuer = requiredEnvironmentVariable('APPLE_API_ISSUER');

if (!existsSync(appPath)) {
  throw new Error(`Application bundle not found at ${appPath}. Run pnpm dist first.`);
}

if (!existsSync(appleApiKey)) {
  throw new Error(`App Store Connect API key not found at ${appleApiKey}.`);
}

await notarize({
  appPath,
  appleApiKey,
  appleApiKeyId,
  appleApiIssuer
});

stdout.write(`Notarized and stapled ${appPath}\n`);

function requiredEnvironmentVariable(name) {
  const value = env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required for macOS notarization.`);
  }

  return value;
}
