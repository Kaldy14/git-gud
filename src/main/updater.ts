export const updateCheckIntervalMs = 6 * 60 * 60 * 1000;

const updateServerBaseUrl = 'https://update.electronjs.org/Kaldy14/git-gud';
const supportedArchitectures = new Set(['arm64', 'x64']);

export interface UpdateDialogOptions {
  type: 'error' | 'info';
  buttons?: string[];
  defaultId?: number;
  cancelId?: number;
  title: string;
  message: string;
  detail?: string;
}

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
  showMessageBox: (options: UpdateDialogOptions) => Promise<{ response: number }>;
  requestInstall: () => void;
  logError?: (message: string, error: unknown) => void;
}

export function buildUpdateFeedUrl(platform: NodeJS.Platform, architecture: string, appVersion: string): string {
  return `${updateServerBaseUrl}/${platform}-${architecture}/${appVersion}`;
}

export class ApplicationUpdater {
  readonly isSupported: boolean;

  private readonly appVersion: string;
  private readonly transport: UpdateTransport;
  private readonly showMessageBox: ApplicationUpdaterOptions['showMessageBox'];
  private readonly requestInstall: () => void;
  private readonly logError: NonNullable<ApplicationUpdaterOptions['logError']>;
  private checkInterval: ReturnType<typeof setInterval> | undefined;
  private isChecking = false;
  private isManualCheck = false;
  private downloadedReleaseName: string | undefined;
  private restartPrompt: Promise<void> | undefined;

  constructor(options: ApplicationUpdaterOptions) {
    this.appVersion = options.appVersion;
    this.transport = options.transport;
    this.showMessageBox = options.showMessageBox;
    this.requestInstall = options.requestInstall;
    this.logError = options.logError ?? (() => undefined);
    this.isSupported =
      options.isPackaged &&
      options.platform === 'darwin' &&
      supportedArchitectures.has(options.architecture);

    if (!this.isSupported) {
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
    if (!this.isSupported || this.checkInterval) {
      return;
    }

    this.checkForUpdates();
    this.checkInterval = setInterval(() => this.checkForUpdates(), updateCheckIntervalMs);
    this.checkInterval.unref();
  }

  stop(): void {
    if (!this.checkInterval) {
      return;
    }

    clearInterval(this.checkInterval);
    this.checkInterval = undefined;
  }

  checkForUpdates(manual = false): void {
    if (!this.isSupported) {
      return;
    }

    if (this.downloadedReleaseName) {
      if (manual) {
        void this.promptToRestart(this.downloadedReleaseName);
      }
      return;
    }

    if (this.isChecking) {
      this.isManualCheck ||= manual;
      return;
    }

    this.isChecking = true;
    this.isManualCheck = manual;

    try {
      const check = this.transport.checkForUpdates();
      void Promise.resolve(check).catch((error: unknown) => this.handleError(asError(error)));
    } catch (error) {
      this.handleError(asError(error));
    }
  }

  private handleUpdateAvailable(): void {
    if (!this.isManualCheck) {
      return;
    }

    void this.showMessageBox({
      type: 'info',
      title: 'Git Gud Update',
      message: 'A new Git Gud version is downloading.',
      detail: 'You can keep working. Git Gud will let you know when the update is ready.'
    });
  }

  private handleUpdateNotAvailable(): void {
    const showResult = this.isManualCheck;
    this.finishCheck();

    if (!showResult) {
      return;
    }

    void this.showMessageBox({
      type: 'info',
      title: 'Git Gud Update',
      message: `Git Gud ${this.appVersion} is up to date.`
    });
  }

  private handleUpdateDownloaded(releaseName: string): void {
    this.downloadedReleaseName = releaseName || 'A new Git Gud version';
    this.finishCheck();
    void this.promptToRestart(this.downloadedReleaseName);
  }

  private handleError(error: Error): void {
    const showResult = this.isManualCheck;
    this.finishCheck();
    this.logError('Git Gud update check failed.', error);

    if (!showResult) {
      return;
    }

    void this.showMessageBox({
      type: 'error',
      title: 'Git Gud Update',
      message: "Git Gud couldn't check for updates.",
      detail: error.message
    });
  }

  private promptToRestart(releaseName: string): Promise<void> {
    if (this.restartPrompt) {
      return this.restartPrompt;
    }

    const prompt = this.showMessageBox({
      type: 'info',
      buttons: ['Restart Git Gud', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Git Gud Update',
      message: `${releaseName} is ready to install.`,
      detail: 'Restart Git Gud now to finish the update, or install it the next time you open the app.'
    }).then(({ response }) => {
      if (response === 0) {
        this.requestInstall();
      }
    });

    this.restartPrompt = prompt.finally(() => {
      this.restartPrompt = undefined;
    });
    return this.restartPrompt;
  }

  private finishCheck(): void {
    this.isChecking = false;
    this.isManualCheck = false;
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
