#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { sign } from '@electron/osx-sign';
import { createRequire } from 'node:module';
import { env, stdout } from 'node:process';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const productName = packageJson.productName ?? 'Git Gud';
const appVersion = env.GIT_GUD_VERSION?.trim().replace(/^v/, '') || '0.0.0';
const bundleId = 'dev.kaldy.git-gud';
const iconFileName = 'icon.icns';
const electronBinary = require('electron');
const electronAppPath = findAncestorAppBundle(electronBinary);
const distDir = join(repoRoot, 'dist', 'mac');
const appPath = join(distDir, `${productName}.app`);
const legacyAppPath = join(distDir, `${packageJson.name}.app`);
const contentsPath = join(appPath, 'Contents');
const resourcesPath = join(contentsPath, 'Resources');
const bundledAppPath = join(resourcesPath, 'app');
const macOsPath = join(contentsPath, 'MacOS');
const infoPlistPath = join(contentsPath, 'Info.plist');
const deployedAppPath = join(distDir, '.deployed-app');

assertExists(join(repoRoot, 'out'), 'Build output is missing. Run pnpm build first.');
assertExists(join(repoRoot, 'node_modules'), 'node_modules is missing. Run pnpm install first.');
assertExists(join(repoRoot, 'build', 'icon.icns'), 'build/icon.icns is missing.');
assertExists(join(repoRoot, 'build', 'icon.png'), 'build/icon.png is missing.');

rmSync(appPath, { force: true, recursive: true });
rmSync(legacyAppPath, { force: true, recursive: true });
mkdirSync(distDir, { recursive: true });
execFileSync('ditto', [electronAppPath, appPath]);

renameExecutable();
installAppPayload();
installIcons();
updateInfoPlist();
await signApp();

stdout.write(`Built ${appPath}\n`);

function renameExecutable() {
  const oldExecutablePath = join(macOsPath, 'Electron');
  const newExecutablePath = join(macOsPath, productName);

  if (existsSync(oldExecutablePath)) {
    renameSync(oldExecutablePath, newExecutablePath);
  }

  chmodSync(newExecutablePath, 0o755);
}

function installAppPayload() {
  rmSync(join(resourcesPath, 'default_app.asar'), { force: true });
  rmSync(join(resourcesPath, 'app'), { force: true, recursive: true });
  rmSync(deployedAppPath, { force: true, recursive: true });
  mkdirSync(bundledAppPath, { recursive: true });

  execFileSync(
    'pnpm',
    ['--filter', packageJson.name, 'deploy', '--prod', deployedAppPath],
    { cwd: repoRoot, stdio: 'inherit' }
  );

  cpSync(join(repoRoot, 'out'), join(bundledAppPath, 'out'), { force: true, recursive: true });
  cpSync(join(deployedAppPath, 'node_modules'), join(bundledAppPath, 'node_modules'), {
    force: true,
    recursive: true,
    verbatimSymlinks: true
  });
  rmSync(deployedAppPath, { force: true, recursive: true });

  writeFileSync(
    join(bundledAppPath, 'package.json'),
    `${JSON.stringify(
      {
        name: packageJson.name,
        productName,
        version: appVersion,
        main: './out/main/index.js'
      },
      null,
      2
    )}\n`
  );
}

function installIcons() {
  copyFileSync(join(repoRoot, 'build', 'icon.icns'), join(resourcesPath, iconFileName));
  copyFileSync(join(repoRoot, 'build', 'icon.png'), join(resourcesPath, 'icon.png'));
}

function updateInfoPlist() {
  setPlistValue('CFBundleExecutable', 'string', productName);
  setPlistValue('CFBundleIdentifier', 'string', bundleId);
  setPlistValue('CFBundleName', 'string', productName);
  setPlistValue('CFBundleDisplayName', 'string', productName);
  setPlistValue('CFBundleIconFile', 'string', iconFileName);
  setPlistValue('CFBundleShortVersionString', 'string', appVersion);
  setPlistValue('CFBundleVersion', 'string', appVersion);
  setPlistValue('LSApplicationCategoryType', 'string', 'public.app-category.developer-tools');
  setPlistValue('NSHighResolutionCapable', 'bool', 'true');
}

function setPlistValue(key, type, value) {
  const plistBuddy = '/usr/libexec/PlistBuddy';

  try {
    execFileSync(plistBuddy, ['-c', `Set :${key} ${value}`, infoPlistPath], { stdio: 'ignore' });
  } catch {
    execFileSync(plistBuddy, ['-c', `Add :${key} ${type} ${value}`, infoPlistPath], { stdio: 'ignore' });
  }
}

async function signApp() {
  const identity = env.MACOS_SIGNING_IDENTITY?.trim();

  if (!identity) {
    adHocSign();
    stdout.write('Applied an ad-hoc signature (MACOS_SIGNING_IDENTITY is not set).\n');
    return;
  }

  await sign({
    app: appPath,
    identity,
    keychain: env.MACOS_SIGNING_KEYCHAIN?.trim() || undefined,
    platform: 'darwin'
  });
  stdout.write(`Signed with Developer ID identity: ${identity}\n`);
}

function adHocSign() {
  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  } catch (error) {
    throw new Error(`codesign failed for ${appPath}`, { cause: error });
  }
}

function findAncestorAppBundle(path) {
  let currentPath = path;

  while (currentPath && currentPath !== dirname(currentPath)) {
    if (basename(currentPath).endsWith('.app')) {
      return currentPath;
    }

    currentPath = dirname(currentPath);
  }

  throw new Error(`Could not locate Electron.app from ${path}.`);
}

function assertExists(path, message) {
  if (!existsSync(path)) {
    throw new Error(message);
  }
}
