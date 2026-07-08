#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { stdout } from 'node:process';
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
adHocSign();

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
  mkdirSync(bundledAppPath, { recursive: true });

  cpSync(join(repoRoot, 'out'), join(bundledAppPath, 'out'), { force: true, recursive: true });
  cpSync(join(repoRoot, 'node_modules'), join(bundledAppPath, 'node_modules'), {
    force: true,
    recursive: true,
    verbatimSymlinks: true
  });

  writeFileSync(
    join(bundledAppPath, 'package.json'),
    `${JSON.stringify(
      {
        name: packageJson.name,
        productName,
        version: packageJson.version,
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
  setPlistValue('CFBundleShortVersionString', 'string', packageJson.version);
  setPlistValue('CFBundleVersion', 'string', packageJson.version);
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
