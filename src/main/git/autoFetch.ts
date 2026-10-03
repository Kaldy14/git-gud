import { randomUUID } from 'node:crypto';

import type { RepoTab } from '@shared/types';

type FetchRepository = Pick<RepoTab, 'path' | 'commonDir' | 'assignedProfileId'>;
type FetchResult = 'succeeded' | 'skipped';

type AutoFetchDependencies = {
  lastFetchedAt: (commonDir: string) => string | undefined;
  fetch: (repository: FetchRepository, operationId: string) => Promise<FetchResult>;
  cancel: (operationId: string) => void;
};

type FetchAttempt = { completedAt: number; failures: number };
type ActiveFetch = {
  commonDir: string;
  repoPath: string;
  assignedProfileId?: string;
  operationId: string;
  cancelled: boolean;
  done: Promise<void>;
};

// Main-process timers keep running when the renderer is hidden or on a dashboard.
// One fetch at a time bounds background work across repositories and worktrees.
export class RepositoryAutoFetch {
  private repositories = new Map<string, FetchRepository>();
  private readonly attempts = new Map<string, FetchAttempt>();
  private readonly foreground = new Map<string, number>();
  private intervalMs = 0;
  private timer?: NodeJS.Timeout;
  private current?: ActiveFetch;
  private stopped = false;

  constructor(private readonly dependencies: AutoFetchDependencies) {}

  sync(repositories: readonly FetchRepository[], intervalMinutes: number): void {
    this.repositories = new Map();
    for (const repository of repositories) {
      if (!this.repositories.has(repository.commonDir)) {
        this.repositories.set(repository.commonDir, repository);
      }
    }
    this.intervalMs = Math.max(0, intervalMinutes) * 60_000;
    for (const commonDir of this.attempts.keys()) {
      if (!this.repositories.has(commonDir)) this.attempts.delete(commonDir);
    }
    const current = this.current;
    if (current && (this.intervalMs === 0 || !repositories.some(
      (repository) => repository.path === current.repoPath && repository.assignedProfileId === current.assignedProfileId
    ))) {
      this.cancelCurrent();
    }
    this.arm();
  }

  async runForeground<T>(commonDir: string, task: () => Promise<T>): Promise<T> {
    this.foreground.set(commonDir, (this.foreground.get(commonDir) ?? 0) + 1);
    try {
      const fetch = this.current;
      if (fetch?.commonDir === commonDir) {
        this.cancelCurrent();
        // Wait for Git to exit and release its locks before changing the repository.
        await fetch.done;
      }
      return await task();
    } finally {
      const remaining = (this.foreground.get(commonDir) ?? 1) - 1;
      if (remaining > 0) this.foreground.set(commonDir, remaining);
      else this.foreground.delete(commonDir);
      this.arm();
    }
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer();
    this.cancelCurrent();
  }

  private cancelCurrent(): void {
    if (this.current && !this.current.cancelled) {
      this.current.cancelled = true;
      this.dependencies.cancel(this.current.operationId);
    }
  }

  private dueAt(commonDir: string): number {
    const attempt = this.attempts.get(commonDir);
    const lastFetchedAt = Date.parse(this.dependencies.lastFetchedAt(commonDir) ?? '');
    const retryDelay = attempt?.failures
      ? Math.max(this.intervalMs, Math.min(15 * 60_000, this.intervalMs * 2 ** Math.min(attempt.failures - 1, 10)))
      : this.intervalMs;
    return Math.max(
      Number.isNaN(lastFetchedAt) ? 0 : lastFetchedAt + this.intervalMs,
      attempt ? attempt.completedAt + retryDelay : 0
    );
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private arm(): void {
    this.clearTimer();
    if (this.stopped || this.intervalMs === 0 || this.current) return;
    let nextDueAt = Number.POSITIVE_INFINITY;
    for (const commonDir of this.repositories.keys()) {
      if (!this.foreground.has(commonDir)) {
        nextDueAt = Math.min(nextDueAt, this.dueAt(commonDir));
      }
    }
    if (!Number.isFinite(nextDueAt)) return;
    // Recheck distant timestamps without overflowing Node's timer range.
    const delay = Math.min(60 * 60_000, Math.max(1000, nextDueAt - Date.now()));
    this.timer = setTimeout(() => this.tick(), delay);
    this.timer.unref();
  }

  private tick(): void {
    this.timer = undefined;
    if (this.stopped || this.intervalMs === 0 || this.current) return;
    const repository = [...this.repositories.values()].find(
      (candidate) => !this.foreground.has(candidate.commonDir) && this.dueAt(candidate.commonDir) <= Date.now()
    );
    if (!repository) {
      this.arm();
      return;
    }
    const fetch: ActiveFetch = {
      commonDir: repository.commonDir,
      repoPath: repository.path,
      assignedProfileId: repository.assignedProfileId,
      operationId: randomUUID(),
      cancelled: false,
      done: Promise.resolve()
    };
    this.current = fetch;
    // Install the active fetch before invoking dependencies, so an arriving user
    // action can cancel even a fetch still waiting for a Git transaction.
    fetch.done = Promise.resolve().then(async () => {
      let failed = false;
      try {
        if (!fetch.cancelled) await this.dependencies.fetch(repository, fetch.operationId);
      } catch {
        failed = !fetch.cancelled;
      } finally {
        if (this.repositories.has(repository.commonDir)) {
          this.attempts.set(repository.commonDir, {
            completedAt: Date.now(),
            failures: failed ? (this.attempts.get(repository.commonDir)?.failures ?? 0) + 1 : 0
          });
        }
        this.current = undefined;
        this.arm();
      }
    });
  }
}
