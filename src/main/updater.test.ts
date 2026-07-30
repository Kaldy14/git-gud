import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApplicationUpdateState } from '@shared/types';

import {
  ApplicationUpdater,
  buildUpdateFeedUrl,
  isCompatibleMacOsCodeSignature,
  type UpdateTransport,
  updateCheckIntervalMs,
  updateFeedbackDurationMs
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
  requestInstall: ReturnType<typeof vi.fn>;
  openManualDownload: ReturnType<typeof vi.fn>;
  states: ApplicationUpdateState[];
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ApplicationUpdater', () => {
  it('configures the official GitHub update feed for compatible packaged macOS builds', () => {
    const { updater, transport } = createUpdater();

    expect(updater.isSupported).toBe(true);
    expect(updater.supportsAutomaticUpdates).toBe(true);
    expect(transport.feedUrl).toBe(
      'https://update.electronjs.org/Kaldy14/git-gud/darwin-arm64/0.4.5'
    );
    expect(buildUpdateFeedUrl('darwin', 'x64', '1.2.3')).toBe(
      'https://update.electronjs.org/Kaldy14/git-gud/darwin-x64/1.2.3'
    );
  });

  it('only accepts Developer ID signatures from the release signing team', () => {
    expect(
      isCompatibleMacOsCodeSignature(
        [
          'Identifier=dev.kaldy.git-gud',
          'Authority=Developer ID Application: 3D Stisk s.r.o. (G6L7T68JBX)',
          'TeamIdentifier=G6L7T68JBX'
        ].join('\n')
      )
    ).toBe(true);
    expect(
      isCompatibleMacOsCodeSignature(
        ['Identifier=dev.kaldy.git-gud', 'Signature=adhoc', 'TeamIdentifier=not set'].join('\n')
      )
    ).toBe(false);
    expect(
      isCompatibleMacOsCodeSignature(
        [
          'Identifier=dev.kaldy.git-gud',
          'Authority=Developer ID Application: Somebody Else (ABCDEFGHIJ)',
          'TeamIdentifier=ABCDEFGHIJ'
        ].join('\n')
      )
    ).toBe(false);
    expect(
      isCompatibleMacOsCodeSignature(
        [
          'Identifier=dev.kaldy.another-app',
          'Authority=Developer ID Application: 3D Stisk s.r.o. (G6L7T68JBX)',
          'TeamIdentifier=G6L7T68JBX'
        ].join('\n')
      )
    ).toBe(false);
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

  it('shows brief inline up-to-date feedback only for a manual check', () => {
    vi.useFakeTimers();
    const { updater, transport } = createUpdater();

    updater.checkForUpdates();
    transport.updateNotAvailableListener?.();
    expect(updater.getState()).toEqual({ status: 'idle' });

    updater.checkForUpdates(true);
    transport.updateNotAvailableListener?.();
    expect(updater.getState()).toEqual({
      status: 'up-to-date',
      message: 'Git Gud 0.4.5 is up to date.'
    });

    vi.advanceTimersByTime(updateFeedbackDurationMs);
    expect(updater.getState()).toEqual({ status: 'idle' });
  });

  it('ignores a contradictory not-available event after finding an update', () => {
    const { updater, transport } = createUpdater();

    updater.checkForUpdates(true);
    transport.updateAvailableListener?.();
    transport.updateNotAvailableListener?.();

    expect(updater.getState()).toEqual({
      status: 'downloading',
      releaseName: 'A new Git Gud version'
    });
  });

  it('downloads quietly and waits for an explicit restart', () => {
    const { updater, transport, requestInstall, states } = createUpdater();

    updater.checkForUpdates();
    transport.updateAvailableListener?.();
    expect(updater.getState()).toEqual({
      status: 'downloading',
      releaseName: 'A new Git Gud version'
    });

    expect(updater.applyUpdate()).toEqual({
      status: 'downloading',
      releaseName: 'A new Git Gud version'
    });
    expect(requestInstall).not.toHaveBeenCalled();

    transport.updateDownloadedListener?.('Git Gud v0.4.6');
    expect(requestInstall).not.toHaveBeenCalled();
    expect(updater.getState()).toEqual({
      status: 'downloaded',
      releaseName: 'Git Gud v0.4.6'
    });
    expect(states).toContainEqual({
      status: 'downloaded',
      releaseName: 'Git Gud v0.4.6'
    });

    updater.applyUpdate();
    expect(requestInstall).toHaveBeenCalledOnce();
  });

  it('keeps background check failures quiet and surfaces actionable manual failures', () => {
    const { updater, transport } = createUpdater();

    updater.checkForUpdates();
    transport.errorListener?.(new Error('offline'));
    expect(updater.getState()).toEqual({ status: 'idle' });

    updater.checkForUpdates(true);
    transport.errorListener?.(new Error('still offline'));
    expect(updater.getState()).toEqual({
      status: 'error',
      message: "Couldn't check for updates. Check your connection, then retry."
    });

    updater.applyUpdate();
    expect(updater.getState()).toEqual({ status: 'checking' });
    expect(transport.checks).toBe(3);
  });

  it('keeps a failed automatic download visible for retry', () => {
    const { updater, transport } = createUpdater();

    updater.checkForUpdates();
    transport.updateAvailableListener?.();
    transport.errorListener?.(new Error('offline'));

    expect(updater.getState()).toEqual({
      status: 'error',
      message: "Couldn't download the update. Check your connection, then retry."
    });
  });

  it('falls back to the signed release page after a signature validation failure', () => {
    const { updater, transport, openManualDownload } = createUpdater();

    updater.checkForUpdates(true);
    transport.updateAvailableListener?.();
    transport.errorListener?.(
      new Error('Code signature did not pass validation: code failed to satisfy specified code requirement(s)')
    );

    expect(updater.getState()).toEqual({
      status: 'manual-update-required',
      message:
        'This copy was built locally and cannot replace itself safely. Download the signed release once; automatic updates will work after that.'
    });

    updater.applyUpdate();
    expect(openManualDownload).toHaveBeenCalledOnce();
  });

  it('does not start Squirrel for a locally signed packaged build', () => {
    const { updater, transport, openManualDownload } = createUpdater({
      automaticUpdatesEnabled: false
    });

    updater.start();
    updater.checkForUpdates(true);

    expect(updater.isSupported).toBe(true);
    expect(updater.supportsAutomaticUpdates).toBe(false);
    expect(transport.feedUrl).toBeUndefined();
    expect(transport.checks).toBe(0);
    expect(updater.getState()).toEqual({
      status: 'manual-update-required',
      message:
        'This copy was built locally and cannot replace itself safely. Download the signed release once; automatic updates will work after that.'
    });
    expect(openManualDownload).toHaveBeenCalledOnce();
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
      expect(updater.supportsAutomaticUpdates).toBe(false);
      expect(transport.feedUrl).toBeUndefined();
      expect(transport.checks).toBe(0);
    }
  });
});

function createUpdater(
  overrides: Partial<{
    architecture: string;
    automaticUpdatesEnabled: boolean;
    isPackaged: boolean;
    platform: NodeJS.Platform;
    transport: FakeUpdateTransport;
  }> = {}
): UpdaterFixture {
  const transport = overrides.transport ?? new FakeUpdateTransport();
  const requestInstall = vi.fn();
  const openManualDownload = vi.fn();
  const states: ApplicationUpdateState[] = [];
  const updater = new ApplicationUpdater({
    appVersion: '0.4.5',
    architecture: overrides.architecture ?? 'arm64',
    isPackaged: overrides.isPackaged ?? true,
    platform: overrides.platform ?? 'darwin',
    transport,
    requestInstall,
    automaticUpdatesEnabled: overrides.automaticUpdatesEnabled,
    openManualDownload,
    onStateChange: (state) => states.push(state)
  });

  return { updater, transport, requestInstall, openManualDownload, states };
}
