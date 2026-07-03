import { existsSync } from 'node:fs';

import chokidar, { type FSWatcher } from 'chokidar';

import type { RepoChangedEvent, RepositorySummary } from '@shared/types';

type WatchReason = RepoChangedEvent['reason'];

type WatchTarget = {
  path: string;
  reason: WatchReason;
};

type ActiveRepoWatch = {
  repoPath: string;
  watchers: FSWatcher[];
  pendingTimer?: NodeJS.Timeout;
  pendingEvent?: RepoChangedEvent;
};

export class RepoWatcherRegistry {
  private readonly watches = new Map<string, ActiveRepoWatch>();

  constructor(private readonly onChange: (event: RepoChangedEvent) => void) {}

  sync(repositories: RepositorySummary[]): void {
    const nextPaths = new Set(repositories.map((repository) => repository.path));

    for (const repoPath of this.watches.keys()) {
      if (!nextPaths.has(repoPath)) {
        this.close(repoPath);
      }
    }

    for (const repository of repositories) {
      if (!this.watches.has(repository.path)) {
        this.open(repository);
      }
    }
  }

  close(repoPath: string): void {
    const activeWatch = this.watches.get(repoPath);

    if (!activeWatch) {
      return;
    }

    for (const watcher of activeWatch.watchers) {
      void watcher.close();
    }

    if (activeWatch.pendingTimer) {
      clearTimeout(activeWatch.pendingTimer);
    }

    this.watches.delete(repoPath);
  }

  closeAll(): void {
    for (const repoPath of this.watches.keys()) {
      this.close(repoPath);
    }
  }

  private open(repository: RepositorySummary): void {
    const targets = dedupeTargets([
      { path: repository.gitDir, reason: 'git-dir' },
      { path: repository.commonDir, reason: 'common-dir' },
      { path: repository.path, reason: 'worktree' }
    ]);
    const activeWatch: ActiveRepoWatch = {
      repoPath: repository.path,
      watchers: []
    };

    for (const target of targets) {
      const watcher = createWatcher(target, (changedPath) => {
        this.enqueueChange(activeWatch, target.reason, changedPath);
      });

      if (watcher) {
        activeWatch.watchers.push(watcher);
      }
    }

    if (activeWatch.watchers.length > 0) {
      this.watches.set(repository.path, activeWatch);
    }
  }

  private enqueueChange(activeWatch: ActiveRepoWatch, reason: WatchReason, changedPath: string | undefined): void {
    activeWatch.pendingEvent = {
      repoPath: activeWatch.repoPath,
      reason,
      path: changedPath,
      happenedAt: new Date().toISOString()
    };

    if (activeWatch.pendingTimer) {
      clearTimeout(activeWatch.pendingTimer);
    }

    activeWatch.pendingTimer = setTimeout(() => {
      const event = activeWatch.pendingEvent;
      activeWatch.pendingEvent = undefined;
      activeWatch.pendingTimer = undefined;

      if (event) {
        this.onChange(event);
      }
    }, 180);
  }
}

function createWatcher(target: WatchTarget, onChange: (changedPath: string | undefined) => void): FSWatcher | undefined {
  if (!existsSync(target.path)) {
    return undefined;
  }

  const watcher = chokidar.watch(target.path, {
    ignoreInitial: true,
    ignored: (candidatePath) => target.reason === 'worktree' && shouldIgnoreWorktreePath(candidatePath)
  });

  watcher.on('all', (_eventName, changedPath) => {
    onChange(changedPath);
  });
  watcher.on('error', () => undefined);

  return watcher;
}

function dedupeTargets(targets: WatchTarget[]): WatchTarget[] {
  const seen = new Set<string>();
  const deduped: WatchTarget[] = [];

  for (const target of targets) {
    if (seen.has(target.path)) {
      continue;
    }

    seen.add(target.path);
    deduped.push(target);
  }

  return deduped;
}

function shouldIgnoreWorktreePath(candidatePath: string): boolean {
  return candidatePath
    .split(/[\\/]/)
    .some((part) => part === '.git' || part === 'node_modules' || part === 'dist' || part === 'out' || part === 'coverage');
}
