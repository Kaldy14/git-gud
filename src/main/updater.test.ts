import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ApplicationUpdater,
  buildUpdateFeedUrl,
  type UpdateDialogOptions,
  type UpdateTransport,
  updateCheckIntervalMs
} from './updater';

class FakeUpdateTransport implements UpdateTransport {
  feedUrl: string | undefined;
  checks = 0;
  updateAvailableListener: (() => void) | undefined;
  updateNotAvailableListener: (() => void) | undefined;
  updateDownloadedListener: ((releaseName: string) => void) | undefined;
  errorListener: ((error: Error) => void) | undefined;

  setFeedUrl(url: string): void {
    this.feedUrl = url;
  }

  checkForUpdates(): void {
    this.checks += 1;
  }

  onUpdateAvailable(listener: () => void): void {
    this.updateAvailableListener = listener;
  }

  onUpdateNotAvailable(listener: () => void): void {
    this.updateNotAvailableListener = listener;
  }

  onUpdateDownloaded(listener: (releaseName: string) => void): void {
    this.updateDownloadedListener = listener;
  }

  onError(listener: (error: Error) => void): void {
    this.errorListener = listener;
  }
}

interface UpdaterFixture {
  updater: ApplicationUpdater;
  transport: FakeUpdateTransport;
  dialogs: UpdateDialogOptions[];
  requestInstall: ReturnType<typeof vi.fn>;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ApplicationUpdater', () => {
  it('configures the official GitHub update feed for packaged macOS builds', () => {
    const { updater, transport } = createUpdater();

    expect(updater.isSupported).toBe(true);
    expect(transport.feedUrl).toBe(
      'https://update.electronjs.org/Kaldy14/git-gud/darwin-arm64/0.4.5'
    );
    expect(buildUpdateFeedUrl('darwin', 'x64', '1.2.3')).toBe(
      'https://update.electronjs.org/Kaldy14/git-gud/darwin-x64/1.2.3'
    );
  });

  it('checks on startup and periodically without overlapping checks', () => {
    vi.useFakeTimers();
    const { updater, transport } = createUpdater();

    updater.start();
    expect(transport.checks).toBe(1);

    vi.advanceTimersByTime(updateCheckIntervalMs);
    expect(transport.checks).toBe(1);

    transport.updateNotAvailableListener?.();
    vi.advanceTimersByTime(updateCheckIntervalMs);
    expect(transport.checks).toBe(2);
  });

  it('reports an up-to-date result only for a manual check', async () => {
    const { updater, transport, dialogs } = createUpdater();

    updater.checkForUpdates();
    transport.updateNotAvailableListener?.();
    expect(dialogs).toEqual([]);

    updater.checkForUpdates(true);
    transport.updateNotAvailableListener?.();
    await Promise.resolve();

    expect(dialogs).toEqual([
      expect.objectContaining({ message: 'Git Gud 0.4.5 is up to date.' })
    ]);
  });

  it('downloads automatically and installs only after restart confirmation', async () => {
    const { updater, transport, dialogs, requestInstall } = createUpdater({ dialogResponse: 0 });

    updater.checkForUpdates();
    transport.updateAvailableListener?.();
    expect(dialogs).toEqual([]);

    transport.updateDownloadedListener?.('Git Gud v0.4.6');
    await Promise.resolve();

    expect(dialogs).toEqual([
      expect.objectContaining({
        buttons: ['Restart Git Gud', 'Later'],
        message: 'Git Gud v0.4.6 is ready to install.'
      })
    ]);
    expect(requestInstall).toHaveBeenCalledOnce();
  });

  it('leaves a downloaded update pending when restart is deferred', async () => {
    const { updater, transport, requestInstall } = createUpdater({ dialogResponse: 1 });

    updater.checkForUpdates();
    transport.updateDownloadedListener?.('Git Gud v0.4.6');
    await Promise.resolve();

    expect(requestInstall).not.toHaveBeenCalled();
    updater.checkForUpdates();
    expect(transport.checks).toBe(1);
  });

  it('keeps automatic failures quiet and reports manual failures', async () => {
    const { updater, transport, dialogs } = createUpdater();

    updater.checkForUpdates();
    transport.errorListener?.(new Error('offline'));
    expect(dialogs).toEqual([]);

    updater.checkForUpdates(true);
    transport.errorListener?.(new Error('still offline'));
    await Promise.resolve();

    expect(dialogs).toEqual([
      expect.objectContaining({
        type: 'error',
        message: "Git Gud couldn't check for updates.",
        detail: 'still offline'
      })
    ]);
  });

  it('does not initialize outside supported packaged macOS architectures', () => {
    for (const options of [
      { isPackaged: false, platform: 'darwin' as const, architecture: 'arm64' },
      { isPackaged: true, platform: 'linux' as const, architecture: 'x64' },
      { isPackaged: true, platform: 'darwin' as const, architecture: 'ia32' }
    ]) {
      const transport = new FakeUpdateTransport();
      const updater = createUpdater({ transport, ...options }).updater;

      updater.start();
      updater.checkForUpdates(true);
      expect(updater.isSupported).toBe(false);
      expect(transport.feedUrl).toBeUndefined();
      expect(transport.checks).toBe(0);
    }
  });
});

function createUpdater(
  overrides: Partial<{
    architecture: string;
    dialogResponse: number;
    isPackaged: boolean;
    platform: NodeJS.Platform;
    transport: FakeUpdateTransport;
  }> = {}
): UpdaterFixture {
  const transport = overrides.transport ?? new FakeUpdateTransport();
  const dialogs: UpdateDialogOptions[] = [];
  const requestInstall = vi.fn();
  const updater = new ApplicationUpdater({
    appVersion: '0.4.5',
    architecture: overrides.architecture ?? 'arm64',
    isPackaged: overrides.isPackaged ?? true,
    platform: overrides.platform ?? 'darwin',
    transport,
    showMessageBox: (options) => {
      dialogs.push(options);
      return Promise.resolve({ response: overrides.dialogResponse ?? 1 });
    },
    requestInstall
  });

  return { updater, transport, dialogs, requestInstall };
}
