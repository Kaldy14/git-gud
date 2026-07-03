import { join } from 'node:path';

import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { app, BrowserWindow, shell } from 'electron';

import { RepoWatcherRegistry } from './git/watcher';
import { registerIpcHandlers } from './ipc';
import { getWorkspace } from './store';

const repoWatchers = new RepoWatcherRegistry((event) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('repo:changed', event);
  }
});

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    title: 'git-gud',
    backgroundColor: '#0e1218',
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
    void shell.openExternal(details.url);
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

app.whenReady().then(() => {
  electronApp.setAppUserModelId('dev.kaldy.git-gud');
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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  repoWatchers.closeAll();
});
