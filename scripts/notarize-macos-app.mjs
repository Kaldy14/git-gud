#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { env, stderr, stdout } from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const pollIntervalMs = 30_000;
const processingTimeoutMs = 35 * 60_000;
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const appPath = join(repoRoot, 'dist', 'mac', 'Git Gud.app');
const appleApiKey = requiredEnvironmentVariable('APPLE_API_KEY_PATH');
const appleApiKeyId = requiredEnvironmentVariable('APPLE_API_KEY_ID');
const appleApiIssuer = requiredEnvironmentVariable('APPLE_API_ISSUER');
const authorizationArgs = [
  '--key',
  appleApiKey,
  '--key-id',
  appleApiKeyId,
  '--issuer',
  appleApiIssuer
];

if (!existsSync(appPath)) {
  throw new Error(`Application bundle not found at ${appPath}. Run pnpm dist first.`);
}

if (!existsSync(appleApiKey)) {
  throw new Error(`App Store Connect API key not found at ${appleApiKey}.`);
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'git-gud-notarize-'));
const archivePath = join(temporaryDirectory, 'Git Gud.zip');

try {
  verifySignature();
  createArchive();

  const submission = submitArchive();
  await waitForResult(submission.id);

  await stapleApp();
  stdout.write(`Notarized and stapled ${appPath}\n`);
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true });
}

function verifySignature() {
  stdout.write(`Verifying signature for ${appPath}\n`);
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
}

function createArchive() {
  stdout.write(`Creating notarization archive at ${archivePath}\n`);
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, archivePath]);
}

function submitArchive() {
  stdout.write('Uploading application to Apple Notary Service...\n');
  const response = runNotaryToolJson([
    'submit',
    archivePath,
    ...authorizationArgs,
    '--no-wait'
  ]);

  if (typeof response.id !== 'string' || !response.id) {
    throw new Error(`Notary Service did not return a submission ID: ${JSON.stringify(response)}`);
  }

  stdout.write(`Notarization submission ID: ${response.id}\n`);
  return response;
}

async function waitForResult(submissionId) {
  const deadline = Date.now() + processingTimeoutMs;

  while (true) {
    const response = runNotaryToolJson(['info', submissionId, ...authorizationArgs]);
    const status = typeof response.status === 'string' ? response.status : 'Unknown';
    stdout.write(`[${new Date().toISOString()}] Notarization status: ${status}\n`);

    if (status === 'Accepted') {
      return;
    }

    if (status === 'Invalid' || status === 'Rejected') {
      printSubmissionLog(submissionId);
      throw new Error(`Apple rejected notarization submission ${submissionId}.`);
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `Notarization submission ${submissionId} is still ${status} after 35 minutes. ` +
          'Apple continues processing it; use notarytool info with this submission ID to check it later.'
      );
    }

    await delay(pollIntervalMs);
  }
}

function printSubmissionLog(submissionId) {
  stdout.write(`Apple notarization log for ${submissionId}:\n`);

  try {
    run('xcrun', ['notarytool', 'log', submissionId, ...authorizationArgs]);
  } catch (error) {
    stderr.write(`Unable to retrieve the notarization log: ${error.message}\n`);
  }
}

async function stapleApp() {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      run('xcrun', ['stapler', 'staple', '--verbose', appPath]);
      return;
    } catch (error) {
      if (attempt === 4) {
        throw error;
      }

      stderr.write(`Stapling attempt ${attempt} failed; retrying in 5 seconds.\n`);
      await delay(5_000);
    }
  }
}

function runNotaryToolJson(args) {
  const output = run('xcrun', ['notarytool', ...args, '--output-format', 'json'], true);

  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`notarytool returned invalid JSON:\n${output}`);
  }
}

function run(command, args, captureOutput = false) {
  try {
    return execFileSync(command, args, {
      encoding: captureOutput ? 'utf8' : undefined,
      stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit'
    });
  } catch (error) {
    if (captureOutput) {
      if (error.stdout) {
        stderr.write(error.stdout.toString());
      }
      if (error.stderr) {
        stderr.write(error.stderr.toString());
      }
    }

    throw new Error(`${command} failed with exit code ${error.status ?? 'unknown'}.`, {
      cause: error
    });
  }
}

function requiredEnvironmentVariable(name) {
  const value = env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required for macOS notarization.`);
  }

  return value;
}
