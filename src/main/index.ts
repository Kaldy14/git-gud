import { join } from 'node:path';
import { existsSync } from 'node:fs';

import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { app, BrowserWindow, shell } from 'electron';

import { RepoWatcherRegistry } from './git/watcher';
import { registerIpcHandlers } from './ipc';
import { getWorkspace } from './store';

const quitCleanupTimeoutMs = 1500;
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

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isSafeExternalUrl(details.url)) {
      void shell.openExternal(details.url);
    }

    return {
      action: 'deny'
    };
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
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', (event) => {
  if (isQuitting) {
    return;
  }

  event.preventDefault();
  isQuitting = true;
  void quitAfterCleanup();
});

async function quitAfterCleanup(): Promise<void> {
  await Promise.race([repoWatchers.closeAll(), wait(quitCleanupTimeoutMs)]);
  app.exit(0);
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
