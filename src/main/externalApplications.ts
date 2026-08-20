import { execFile, spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { promisify } from 'node:util';

import { app, nativeImage } from 'electron';

import type {
  ExternalApplication,
  ExternalApplicationId
} from '@shared/externalApplications';

type ExternalApplicationSpec = {
  id: ExternalApplicationId;
  name: string;
  bundleId: string;
  paths: readonly string[];
  iconFile: string;
  waitCliRelativePath?: string;
  windowsExecutable?: string;
  windowsInstallDirectories?: readonly string[];
};

type InstalledExternalApplication = ExternalApplication & {
  appPath: string;
  waitCliPath?: string;
};

export type ExternalApplicationLaunch = {
  closed: Promise<void>;
  processId?: number;
};

const execFileAsync = promisify(execFile);

const applicationSpecs: readonly ExternalApplicationSpec[] = [
  {
    id: 'vscode',
    name: 'VS Code',
    bundleId: 'com.microsoft.VSCode',
    paths: ['/Applications/Visual Studio Code.app'],
    iconFile: 'Code.icns',
    waitCliRelativePath: 'Contents/Resources/app/bin/code',
    windowsExecutable: 'Code.exe',
    windowsInstallDirectories: ['Programs\\Microsoft VS Code', 'Microsoft VS Code']
  },
  {
    id: 'cursor',
    name: 'Cursor',
    bundleId: 'com.todesktop.230313mzl4w4u92',
    paths: ['/Applications/Cursor.app'],
    iconFile: 'Cursor.icns',
    waitCliRelativePath: 'Contents/Resources/app/bin/cursor',
    windowsExecutable: 'Cursor.exe',
    windowsInstallDirectories: ['Programs\\cursor', 'Cursor']
  },
  {
    id: 'zed',
    name: 'Zed',
    bundleId: 'dev.zed.Zed',
    paths: ['/Applications/Zed.app'],
    iconFile: 'Zed.icns'
  },
  {
    id: 'finder',
    name: 'Finder',
    bundleId: 'com.apple.finder',
    paths: ['/System/Library/CoreServices/Finder.app'],
    iconFile: 'Finder.icns'
  },
  {
    id: 'terminal',
    name: 'Terminal',
    bundleId: 'com.apple.Terminal',
    paths: ['/System/Applications/Utilities/Terminal.app'],
    iconFile: 'Terminal.icns'
  },
  {
    id: 'iterm2',
    name: 'iTerm2',
    bundleId: 'com.googlecode.iterm2',
    paths: ['/Applications/iTerm.app'],
    iconFile: 'AppIcon.icns'
  },
  {
    id: 'ghostty',
    name: 'Ghostty',
    bundleId: 'com.mitchellh.ghostty',
    paths: ['/Applications/Ghostty.app'],
    iconFile: 'Ghostty.icns'
  },
  {
    id: 'warp',
    name: 'Warp',
    bundleId: 'dev.warp.Warp-Stable',
    paths: ['/Applications/Warp.app'],
    iconFile: 'AppIcon.icns'
  },
  {
    id: 'xcode',
    name: 'Xcode',
    bundleId: 'com.apple.dt.Xcode',
    paths: ['/Applications/Xcode.app'],
    iconFile: 'Xcode.icns'
  },
  {
    id: 'webstorm',
    name: 'WebStorm',
    bundleId: 'com.jetbrains.WebStorm',
    paths: ['/Applications/WebStorm.app'],
    iconFile: 'webstorm.icns'
  }
];

let installedApplicationsPromise: Promise<InstalledExternalApplication[]> | undefined;

export async function listExternalApplications(): Promise<ExternalApplication[]> {
  const applications = await loadInstalledExternalApplications();
  return applications.map(({ id, name, iconDataUrl }) => ({ id, name, iconDataUrl }));
}

export async function launchExternalApplication(
  applicationId: ExternalApplicationId,
  worktreePath: string
): Promise<{ application: ExternalApplication; launch: ExternalApplicationLaunch }> {
  const installedApplication = (await loadInstalledExternalApplications())
    .find((candidate) => candidate.id === applicationId);

  if (!installedApplication) {
    throw new Error('That application is no longer installed.');
  }

  const command = externalApplicationLaunchCommand(
    installedApplication,
    worktreePath,
    process.platform
  );
  const launch = await spawnObserved(command.executable, command.args);

  return {
    application: {
      id: installedApplication.id,
      name: installedApplication.name,
      iconDataUrl: installedApplication.iconDataUrl
    },
    launch
  };
}

async function loadInstalledExternalApplications(): Promise<InstalledExternalApplication[]> {
  installedApplicationsPromise ??= Promise.all(
    supportedApplicationSpecs().map(resolveInstalledApplication)
  ).then((applications) =>
    applications.filter(
      (application): application is InstalledExternalApplication => Boolean(application)
    )
  );

  return installedApplicationsPromise;
}

async function resolveInstalledApplication(
  spec: ExternalApplicationSpec
): Promise<InstalledExternalApplication | undefined> {
  const appPath = await resolveApplicationPath(spec);

  if (!appPath) {
    return undefined;
  }

  try {
    const iconDataUrl = process.platform === 'win32'
      ? (await app.getFileIcon(appPath, { size: 'normal' })).toDataURL()
      : await loadApplicationIconDataUrl(appPath, spec.iconFile);
    const waitCliPath = process.platform === 'win32'
      ? appPath
      : spec.waitCliRelativePath
        ? `${appPath}/${spec.waitCliRelativePath}`
        : undefined;

    return {
      id: spec.id,
      name: spec.name,
      appPath,
      iconDataUrl,
      ...(waitCliPath && await pathExists(waitCliPath) ? { waitCliPath } : {})
    };
  } catch {
    return undefined;
  }
}

async function loadApplicationIconDataUrl(
  appPath: string,
  knownIconFile: string
): Promise<string> {
  const knownIconPath = `${appPath}/Contents/Resources/${knownIconFile}`;
  const declaredIconPath = await pathExists(knownIconPath)
    ? knownIconPath
    : await resolveDeclaredIconPath(appPath);

  if (declaredIconPath) {
    if (declaredIconPath.toLowerCase().endsWith('.icns')) {
      try {
        return await convertMacIconToPngDataUrl(declaredIconPath);
      } catch {
        // Fall through to Electron's icon readers for unusual bundles.
      }
    }

    const icon = nativeImage.createFromPath(declaredIconPath);

    if (!icon.isEmpty()) {
      return icon.resize({ width: 32, height: 32, quality: 'best' }).toDataURL();
    }
  }

  return (await app.getFileIcon(appPath, { size: 'normal' })).toDataURL();
}

async function convertMacIconToPngDataUrl(iconPath: string): Promise<string> {
  const conversionDirectory = await mkdtemp(join(tmpdir(), 'git-gud-app-icon-'));
  const outputPath = join(conversionDirectory, 'icon.png');

  try {
    await execFileAsync(
      '/usr/bin/sips',
      ['-s', 'format', 'png', '-Z', '64', iconPath, '--out', outputPath],
      {
        encoding: 'utf8',
        timeout: 5_000,
        maxBuffer: 64 * 1024
      }
    );
    const png = await readFile(outputPath);
    return `data:image/png;base64,${png.toString('base64')}`;
  } finally {
    await rm(conversionDirectory, { recursive: true, force: true });
  }
}

async function resolveDeclaredIconPath(appPath: string): Promise<string | undefined> {
  const infoPlistPath = `${appPath}/Contents/Info.plist`;
  const resourcesPath = `${appPath}/Contents/Resources`;

  for (const property of ['CFBundleIconFile', 'CFBundleIconName']) {
    try {
      const { stdout } = await execFileAsync(
        '/usr/bin/plutil',
        ['-extract', property, 'raw', '-o', '-', infoPlistPath],
        {
          encoding: 'utf8',
          timeout: 2_000,
          maxBuffer: 16 * 1024
        }
      );
      const iconName = stdout.trim();
      const candidates = iconName.toLowerCase().endsWith('.icns')
        ? [iconName]
        : [`${iconName}.icns`, iconName];

      for (const candidate of candidates) {
        const iconPath = `${resourcesPath}/${candidate}`;

        if (await pathExists(iconPath)) {
          return iconPath;
        }
      }
    } catch {
      // Older bundles can omit one of these plist keys.
    }
  }

  return undefined;
}

async function resolveApplicationPath(spec: ExternalApplicationSpec): Promise<string | undefined> {
  if (process.platform === 'win32') {
    return resolveWindowsApplicationPath(spec, process.env, pathExists);
  }

  if (process.platform !== 'darwin') {
    return undefined;
  }

  for (const candidate of spec.paths) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  try {
    const query = [
      'kMDItemContentType == "com.apple.application-bundle"',
      `kMDItemCFBundleIdentifier == "${spec.bundleId}"`
    ].join(' && ');
    const { stdout } = await execFileAsync('/usr/bin/mdfind', [query], {
      encoding: 'utf8',
      timeout: 3_000,
      maxBuffer: 256 * 1024
    });

    for (const candidate of stdout.split('\n').map((line) => line.trim()).filter(Boolean)) {
      if (await pathExists(candidate)) {
        return candidate;
      }
    }
  } catch {
    // Spotlight can be disabled; the known application paths above remain sufficient.
  }

  return undefined;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function spawnObserved(executable: string, args: readonly string[]): Promise<ExternalApplicationLaunch> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      detached: false,
      stdio: 'ignore',
      windowsHide: true
    });
    let started = false;
    let resolveClosed: (() => void) | undefined;
    const closed = new Promise<void>((resolveClose) => {
      resolveClosed = resolveClose;
    });

    child.once('spawn', () => {
      started = true;
      child.unref();
      resolve({ closed, processId: child.pid });
    });
    child.once('error', (error) => {
      resolveClosed?.();

      if (!started) {
        reject(error);
      }
    });
    child.once('close', () => {
      resolveClosed?.();
    });
  });
}

function supportedApplicationSpecs(
  platform: NodeJS.Platform = process.platform
): readonly ExternalApplicationSpec[] {
  if (platform === 'win32') {
    return applicationSpecs.filter((spec) => spec.windowsExecutable);
  }

  return platform === 'darwin' ? applicationSpecs : [];
}

function windowsApplicationPaths(
  spec: ExternalApplicationSpec,
  environment: NodeJS.ProcessEnv
): string[] {
  if (!spec.windowsExecutable || !spec.windowsInstallDirectories) {
    return [];
  }

  const localAppData = getEnvironmentValue(environment, 'LOCALAPPDATA');
  const programFiles = [
    getEnvironmentValue(environment, 'ProgramFiles'),
    getEnvironmentValue(environment, 'ProgramFiles(x86)')
  ];
  const candidates: string[] = [];

  for (const directory of spec.windowsInstallDirectories) {
    const isPerUserDirectory = directory.startsWith('Programs\\');
    const roots = isPerUserDirectory ? [localAppData] : programFiles;

    for (const root of roots) {
      if (root) {
        candidates.push(win32.join(root, directory, spec.windowsExecutable));
      }
    }
  }

  return [...new Set(candidates)];
}

async function resolveWindowsApplicationPath(
  spec: ExternalApplicationSpec,
  environment: NodeJS.ProcessEnv,
  exists: (path: string) => Promise<boolean>
): Promise<string | undefined> {
  for (const candidate of windowsApplicationPaths(spec, environment)) {
    if (await exists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function externalApplicationLaunchCommand(
  application: Pick<InstalledExternalApplication, 'appPath' | 'waitCliPath'>,
  worktreePath: string,
  platform: NodeJS.Platform
): { executable: string; args: string[] } {
  if (platform === 'win32' || application.waitCliPath) {
    return {
      executable: application.waitCliPath ?? application.appPath,
      args: ['--new-window', '--wait', worktreePath]
    };
  }

  return {
    executable: '/usr/bin/open',
    args: ['-W', '-n', '-a', application.appPath, worktreePath]
  };
}

function getEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string
): string | undefined {
  const matchingKey = Object.keys(environment)
    .find((key) => key.toLowerCase() === name.toLowerCase());
  return matchingKey ? environment[matchingKey] : undefined;
}

export const externalApplicationsTestUtils = {
  externalApplicationLaunchCommand,
  resolveWindowsApplicationPath,
  supportedApplicationSpecs,
  windowsApplicationPaths
};
