import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  execFile: vi.fn(),
  getFileIcon: vi.fn(),
  spawn: vi.fn()
}));

vi.mock('node:child_process', () => ({
  execFile: mocks.execFile,
  spawn: mocks.spawn
}));

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  access: mocks.access
}));

vi.mock('electron', () => ({
  app: {
    getFileIcon: mocks.getFileIcon
  },
  nativeImage: {
    createFromPath: vi.fn()
  }
}));

import {
  externalApplicationsTestUtils,
  launchExternalApplication,
  listExternalApplications
} from './externalApplications';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('Windows external application integration', () => {
  it('offers only editors with a supported Windows integration', () => {
    expect(
      externalApplicationsTestUtils.supportedApplicationSpecs('win32').map(({ id }) => id)
    ).toEqual(['vscode', 'cursor']);
  });

  it('builds common per-user and system paths case-insensitively from the environment', () => {
    const [vscode] = externalApplicationsTestUtils.supportedApplicationSpecs('win32');

    expect(externalApplicationsTestUtils.windowsApplicationPaths(vscode, {
      LocalAppData: 'C:\\Users\\me\\AppData\\Local',
      PROGRAMFILES: 'C:\\Program Files',
      'PROGRAMFILES(X86)': 'C:\\Program Files (x86)'
    })).toEqual([
      'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
      'C:\\Program Files\\Microsoft VS Code\\Code.exe',
      'C:\\Program Files (x86)\\Microsoft VS Code\\Code.exe'
    ]);
  });

  it('uses the first existing candidate through an injectable filesystem seam', async () => {
    const [, cursor] = externalApplicationsTestUtils.supportedApplicationSpecs('win32');
    const exists = vi.fn(async (path: string) => path.startsWith('D:\\Apps'));

    await expect(externalApplicationsTestUtils.resolveWindowsApplicationPath(cursor, {
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
      ProgramFiles: 'D:\\Apps'
    }, exists)).resolves.toBe('D:\\Apps\\Cursor\\Cursor.exe');
    expect(exists).toHaveBeenCalledWith(
      'C:\\Users\\me\\AppData\\Local\\Programs\\cursor\\Cursor.exe'
    );
  });

  it('keeps macOS bundle launching and uses wait-capable editor launching on Windows', () => {
    expect(externalApplicationsTestUtils.externalApplicationLaunchCommand({
      appPath: '/Applications/Zed.app'
    }, '/repo', 'darwin')).toEqual({
      executable: '/usr/bin/open',
      args: ['-W', '-n', '-a', '/Applications/Zed.app', '/repo']
    });

    expect(externalApplicationsTestUtils.externalApplicationLaunchCommand({
      appPath: 'C:\\Program Files\\Cursor\\Cursor.exe',
      waitCliPath: 'C:\\Program Files\\Cursor\\Cursor.exe'
    }, 'C:\\repo', 'win32')).toEqual({
      executable: 'C:\\Program Files\\Cursor\\Cursor.exe',
      args: ['--new-window', '--wait', 'C:\\repo']
    });
  });

  it('discovers, icons, and launches an installed Windows editor without a console window', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.stubEnv('LOCALAPPDATA', 'C:\\Users\\me\\AppData\\Local');
    vi.stubEnv('ProgramFiles', 'C:\\Program Files');
    const vscodePath = 'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe';
    mocks.access.mockImplementation(async (path) => {
      if (path !== vscodePath) {
        throw new Error('missing');
      }
    });
    mocks.getFileIcon.mockResolvedValue({ toDataURL: () => 'data:image/png;base64,vscode' });
    const child = new EventEmitter() as EventEmitter & { pid: number; unref: () => void };
    child.pid = 42;
    child.unref = vi.fn();
    mocks.spawn.mockImplementation(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    });

    await expect(listExternalApplications()).resolves.toEqual([{
      id: 'vscode',
      name: 'VS Code',
      iconDataUrl: 'data:image/png;base64,vscode'
    }]);
    expect(mocks.getFileIcon).toHaveBeenCalledWith(vscodePath, { size: 'normal' });

    const result = await launchExternalApplication('vscode', 'C:\\worktrees\\pr-123');

    expect(result.launch.processId).toBe(42);
    expect(mocks.spawn).toHaveBeenCalledWith(
      vscodePath,
      ['--new-window', '--wait', 'C:\\worktrees\\pr-123'],
      { detached: false, stdio: 'ignore', windowsHide: true }
    );
  });
});
