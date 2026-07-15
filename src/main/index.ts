import { join } from 'node:path';
import { existsSync } from 'node:fs';

import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { app, BrowserWindow, Menu, shell, type MenuItemConstructorOptions } from 'electron';

import { RepoWatcherRegistry } from './git/watcher';
import { gitExecutor } from './git/exec';
import { registerIpcHandlers } from './ipc';
import { isTrustedRendererUrl } from './ipcSecurity';
import { flushPendingWorkspaceWrites, getWorkspace } from './store';

const quitCleanupTimeoutMs = 1500;
const hardQuitTimeoutMs = 3000;
const appDisplayName = 'Git Gud';
let isQuitting = false;

const repoWatchers = new RepoWatcherRegistry((event) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('repo:changed', event);
  }
});

function createWindow(): void {
  const iconPath = resolveAppIconPath();
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    title: appDisplayName,
    backgroundColor: '#0e1218',
    icon: iconPath,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: {
      x: 16,
      y: 12
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    requestQuit();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isSafeExternalUrl(details.url)) {
      void shell.openExternal(details.url);
    }

    return {
      action: 'deny'
    };
  });

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (isTrustedRendererUrl(navigationUrl)) {
      return;
    }

    event.preventDefault();

    if (isSafeExternalUrl(navigationUrl)) {
      void shell.openExternal(navigationUrl);
    }
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function resolveAppIconPath(): string | undefined {
  const candidatePaths = [
    join(process.resourcesPath, 'icon.png'),
    join(app.getAppPath(), 'build/icon.png'),
    join(process.cwd(), 'build/icon.png')
  ];

  return candidatePaths.find((candidatePath) => existsSync(candidatePath));
}

function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

app.whenReady().then(() => {
  app.setName(appDisplayName);
  electronApp.setAppUserModelId('dev.kaldy.git-gud');
  installApplicationMenu();
  const iconPath = resolveAppIconPath();

  if (iconPath && process.platform === 'darwin') {
    app.dock?.setIcon(iconPath);
  }

  registerIpcHandlers(repoWatchers);
  repoWatchers.sync(getWorkspace().tabs);

  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createWindow();

  app.on('activate', () => {
    if (!isQuitting && BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  requestQuit();
});

app.on('before-quit', (event) => {
  if (isQuitting) {
    return;
  }

  event.preventDefault();
  requestQuit();
});

function installApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: appDisplayName,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        {
          label: `Quit ${appDisplayName}`,
          accelerator: 'Command+Q',
          role: 'quit'
        }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function requestQuit(): void {
  if (isQuitting) {
    return;
  }

  isQuitting = true;
  const hardQuitTimer = setTimeout(() => {
    exitWithoutNodeCleanup();
  }, hardQuitTimeoutMs);
  hardQuitTimer.unref();

  void quitAfterCleanup();
}

async function quitAfterCleanup(): Promise<void> {
  try {
    flushPendingWorkspaceWrites();
    await Promise.race([
      gitExecutor.shutdown(quitCleanupTimeoutMs - 250),
      wait(quitCleanupTimeoutMs)
    ]);
  } finally {
    // Closing Chokidar's macOS FSEvents handles can block the main thread.
    // Leave repository watchers for exitWithoutNodeCleanup to discard.
    gitExecutor.terminateActiveProcesses('SIGKILL');

    for (const window of BrowserWindow.getAllWindows()) {
      window.destroy();
    }
  }

  exitWithoutNodeCleanup();
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    timer.unref();
  });
}

function exitWithoutNodeCleanup(): void {
  // Electron's normal exit tears down Node handles and can deadlock on macOS FSEvents.
  try {
    process.execve?.('/usr/bin/true', ['/usr/bin/true']);
  } catch {
    // Fall back to an unconditional exit if execve is unavailable or fails.
  }

  process.kill(process.pid, 'SIGKILL');
}
