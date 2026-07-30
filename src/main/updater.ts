import { spawnSync } from 'node:child_process';
import { basename, dirname } from 'node:path';

import type { ApplicationUpdateState } from '@shared/types';

export const updateCheckIntervalMs = 6 * 60 * 60 * 1000;
export const updateFeedbackDurationMs = 5_000;
export const updateReleasePageUrl = 'https://github.com/Kaldy14/git-gud/releases/latest';

const updateServerBaseUrl = 'https://update.electronjs.org/Kaldy14/git-gud';
const updaterBundleIdentifier = 'dev.kaldy.git-gud';
const updaterDeveloperTeamId = 'G6L7T68JBX';
const supportedArchitectures = new Set(['arm64', 'x64']);
const manualUpdateMessage =
  'This copy was built locally and cannot replace itself safely. Download the signed release once; automatic updates will work after that.';

export interface UpdateTransport {
  setFeedUrl: (url: string) => void;
  checkForUpdates: () => void | Promise<unknown>;
  onUpdateAvailable: (listener: () => void) => void;
  onUpdateNotAvailable: (listener: () => void) => void;
  onUpdateDownloaded: (listener: (releaseName: string) => void) => void;
  onError: (listener: (error: Error) => void) => void;
}

interface ApplicationUpdaterOptions {
  appVersion: string;
  architecture: string;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  transport: UpdateTransport;
  requestInstall: () => void;
  automaticUpdatesEnabled?: boolean;
  openManualDownload?: () => void;
  onStateChange?: (state: ApplicationUpdateState) => void;
  logError?: (message: string, error: unknown) => void;
}

export function buildUpdateFeedUrl(platform: NodeJS.Platform, architecture: string, appVersion: string): string {
  return `${updateServerBaseUrl}/${platform}-${architecture}/${appVersion}`;
}

export class ApplicationUpdater {
  readonly isSupported: boolean;
  readonly supportsAutomaticUpdates: boolean;

  private readonly appVersion: string;
  private readonly transport: UpdateTransport;
  private readonly requestInstall: () => void;
  private readonly openManualDownload: NonNullable<ApplicationUpdaterOptions['openManualDownload']>;
  private readonly onStateChange: NonNullable<ApplicationUpdaterOptions['onStateChange']>;
  private readonly logError: NonNullable<ApplicationUpdaterOptions['logError']>;
  private checkInterval: ReturnType<typeof setInterval> | undefined;
  private feedbackResetTimer: ReturnType<typeof setTimeout> | undefined;
  private isChecking = false;
  private isManualCheck = false;
  private downloadedReleaseName: string | undefined;
  private state: ApplicationUpdateState = { status: 'idle' };

  constructor(options: ApplicationUpdaterOptions) {
    this.appVersion = options.appVersion;
    this.transport = options.transport;
    this.requestInstall = options.requestInstall;
    this.openManualDownload = options.openManualDownload ?? (() => undefined);
    this.onStateChange = options.onStateChange ?? (() => undefined);
    this.logError = options.logError ?? (() => undefined);
    this.isSupported =
      options.isPackaged &&
      options.platform === 'darwin' &&
      supportedArchitectures.has(options.architecture);
    this.supportsAutomaticUpdates =
      this.isSupported && (options.automaticUpdatesEnabled ?? true);

    if (!this.isSupported) {
      return;
    }

    if (!this.supportsAutomaticUpdates) {
      this.state = {
        status: 'manual-update-required',
        message: manualUpdateMessage
      };
      return;
    }

    this.transport.setFeedUrl(
      buildUpdateFeedUrl(options.platform, options.architecture, options.appVersion)
    );
    this.transport.onUpdateAvailable(() => this.handleUpdateAvailable());
    this.transport.onUpdateNotAvailable(() => this.handleUpdateNotAvailable());
    this.transport.onUpdateDownloaded((releaseName) => this.handleUpdateDownloaded(releaseName));
    this.transport.onError((error) => this.handleError(error));
  }

  start(): void {
    if (!this.supportsAutomaticUpdates || this.checkInterval) {
      return;
    }

    this.checkForUpdates();
    this.checkInterval = setInterval(() => this.checkForUpdates(), updateCheckIntervalMs);
    this.checkInterval.unref();
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }

    this.clearFeedbackReset();
  }

  getState(): ApplicationUpdateState {
    return this.state;
  }

  applyUpdate(): ApplicationUpdateState {
    if (!this.isSupported) {
      return this.state;
    }

    if (this.state.status === 'manual-update-required') {
      this.openManualDownload();
      return this.state;
    }

    if (this.downloadedReleaseName) {
      this.requestInstall();
      return this.state;
    }

    if (this.state.status === 'error') {
      this.checkForUpdates(true);
    }

    return this.state;
  }

  checkForUpdates(manual = false): void {
    if (!this.isSupported) {
      return;
    }

    if (!this.supportsAutomaticUpdates) {
      this.openManualDownload();
      return;
    }

    if (this.downloadedReleaseName) {
      return;
    }

    if (this.isChecking) {
      this.isManualCheck ||= manual;
      return;
    }

    this.isChecking = true;
    this.isManualCheck = manual;
    this.clearFeedbackReset();
    this.setState({ status: 'checking' });

    try {
      const check = this.transport.checkForUpdates();
      void Promise.resolve(check).catch((error: unknown) => this.handleError(asError(error)));
    } catch (error) {
      this.handleError(asError(error));
    }
  }

  private handleUpdateAvailable(): void {
    this.setState({
      status: 'downloading',
      releaseName: 'A new Git Gud version'
    });
  }

  private handleUpdateNotAvailable(): void {
    if (this.state.status !== 'checking') {
      return;
    }

    const showResult = this.isManualCheck;
    this.finishCheck();

    if (!showResult) {
      this.setState({ status: 'idle' });
      return;
    }

    this.setState({
      status: 'up-to-date',
      message: `Git Gud ${this.appVersion} is up to date.`
    });
    this.scheduleFeedbackReset();
  }

  private handleUpdateDownloaded(releaseName: string): void {
    this.downloadedReleaseName = releaseName || 'A new Git Gud version';
    this.finishCheck();
    this.setState({
      status: 'downloaded',
      releaseName: this.downloadedReleaseName
    });
  }

  private handleError(error: Error): void {
    const wasDownloading = this.state.status === 'downloading';
    const showResult = this.isManualCheck || wasDownloading;
    this.finishCheck();
    this.logError('Git Gud update check failed.', error);

    if (isCodeSignatureError(error)) {
      this.setState({
        status: 'manual-update-required',
        message: manualUpdateMessage
      });
      return;
    }

    if (!showResult) {
      this.setState({ status: 'idle' });
      return;
    }

    this.setState({
      status: 'error',
      message: wasDownloading
        ? "Couldn't download the update. Check your connection, then retry."
        : "Couldn't check for updates. Check your connection, then retry."
    });
  }

  private scheduleFeedbackReset(): void {
    this.clearFeedbackReset();
    this.feedbackResetTimer = setTimeout(() => {
      this.feedbackResetTimer = undefined;
      this.setState({ status: 'idle' });
    }, updateFeedbackDurationMs);
    this.feedbackResetTimer.unref();
  }

  private clearFeedbackReset(): void {
    if (!this.feedbackResetTimer) {
      return;
    }

    clearTimeout(this.feedbackResetTimer);
    this.feedbackResetTimer = undefined;
  }

  private finishCheck(): void {
    this.isChecking = false;
    this.isManualCheck = false;
  }

  private setState(state: ApplicationUpdateState): void {
    if (
      this.state.status === state.status &&
      ('releaseName' in this.state ? this.state.releaseName : undefined) ===
        ('releaseName' in state ? state.releaseName : undefined)
    ) {
      return;
    }

    this.state = state;
    this.onStateChange(state);
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function hasCompatibleMacOsUpdateSignature(executablePath: string): boolean {
  const appBundlePath = findAncestorAppBundle(executablePath);

  if (!appBundlePath) {
    return false;
  }

  const result = spawnSync('/usr/bin/codesign', ['-d', '--verbose=4', appBundlePath], {
    encoding: 'utf8'
  });

  if (result.error || result.status !== 0) {
    return false;
  }

  return isCompatibleMacOsCodeSignature(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
}

export function isCompatibleMacOsCodeSignature(signatureDetails: string): boolean {
  return (
    signatureDetails.includes(`Identifier=${updaterBundleIdentifier}`) &&
    signatureDetails.includes(`TeamIdentifier=${updaterDeveloperTeamId}`) &&
    signatureDetails.includes('Authority=Developer ID Application:')
  );
}

function findAncestorAppBundle(path: string): string | undefined {
  let currentPath = path;

  while (currentPath && currentPath !== dirname(currentPath)) {
    if (basename(currentPath).endsWith('.app')) {
      return currentPath;
    }

    currentPath = dirname(currentPath);
  }

  return undefined;
}

function isCodeSignatureError(error: Error): boolean {
  return /code signature|code failed to satisfy specified code requirement/i.test(error.message);
}
