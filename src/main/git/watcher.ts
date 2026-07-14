import { existsSync, watch, type FSWatcher as NativeFsWatcher } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import chokidar, { type FSWatcher as ChokidarWatcher } from 'chokidar';

import type { RepoChangedEvent, RepositorySummary } from '@shared/types';

type WatchReason = RepoChangedEvent['reason'];

type WatchTarget = {
  path: string;
  reason: WatchReason;
  depth?: number;
};

type ActiveRepoWatch = {
  repoPath: string;
  watchers: CloseableWatcher[];
  pendingTimer?: NodeJS.Timeout;
  pendingReasons: Set<WatchReason>;
  pendingPaths: Set<string>;
};

type CloseableWatcher = Pick<ChokidarWatcher, 'close'> | Pick<NativeFsWatcher, 'close'>;

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

    void this.closeActiveWatch(repoPath, activeWatch).catch(() => undefined);
  }

  async closeAll(): Promise<void> {
    const closeOperations = [...this.watches.entries()].map(([repoPath, activeWatch]) =>
      this.closeActiveWatch(repoPath, activeWatch)
    );

    await Promise.allSettled(closeOperations);
  }

  private async closeActiveWatch(repoPath: string, activeWatch: ActiveRepoWatch): Promise<void> {
    this.watches.delete(repoPath);

    if (activeWatch.pendingTimer) {
      clearTimeout(activeWatch.pendingTimer);
      activeWatch.pendingTimer = undefined;
    }

    await Promise.allSettled(activeWatch.watchers.map((watcher) => watcher.close()));
  }

  private open(repository: RepositorySummary): void {
    const targets = dedupeTargets([
      ...gitMetadataTargets(repository.gitDir, 'git-dir'),
      ...gitMetadataTargets(repository.commonDir, 'common-dir'),
      { path: repository.path, reason: 'worktree' }
    ]);
    const activeWatch: ActiveRepoWatch = {
      repoPath: repository.path,
      watchers: [],
      pendingReasons: new Set(),
      pendingPaths: new Set()
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
    activeWatch.pendingReasons.add(reason);

    if (changedPath && activeWatch.pendingPaths.size < maxPendingPaths) {
      activeWatch.pendingPaths.add(changedPath);
    }

    if (activeWatch.pendingTimer) {
      clearTimeout(activeWatch.pendingTimer);
    }

    activeWatch.pendingTimer = setTimeout(() => {
      const reasons = [...activeWatch.pendingReasons];
      const paths = [...activeWatch.pendingPaths];
      activeWatch.pendingReasons.clear();
      activeWatch.pendingPaths.clear();
      activeWatch.pendingTimer = undefined;

      if (reasons.length > 0) {
        this.onChange({
          repoPath: activeWatch.repoPath,
          reason: reasons[0] ?? 'worktree',
          reasons,
          path: paths[0],
          paths,
          happenedAt: new Date().toISOString()
        });
      }
    }, repoChangeDebounceMs);
  }
}

const repoChangeDebounceMs = 350;
const maxPendingPaths = 32;

function createWatcher(
  target: WatchTarget,
  onChange: (changedPath: string | undefined) => void
): CloseableWatcher | undefined {
  if (!existsSync(target.path)) {
    return undefined;
  }

  if (target.reason === 'worktree') {
    return createNativeWorktreeWatcher(target.path, onChange);
  }

  const watcher = chokidar.watch(target.path, {
    ignoreInitial: true,
    ...(typeof target.depth === 'number' ? { depth: target.depth } : {}),
    ignored: (candidatePath) => shouldIgnoreWatchPath(target, candidatePath)
  });

  watcher.on('all', (_eventName, changedPath) => {
    onChange(changedPath);
  });
  watcher.on('error', () => undefined);

  return watcher;
}

function createNativeWorktreeWatcher(
  repoPath: string,
  onChange: (changedPath: string | undefined) => void
): NativeFsWatcher | undefined {
  try {
    const watcher = watch(repoPath, { recursive: true }, (_eventType, filename) => {
      const changedPath = filename
        ? isAbsolute(filename)
          ? filename
          : join(repoPath, filename)
        : undefined;

      if (changedPath && shouldIgnoreWorktreePath(changedPath)) {
        return;
      }

      onChange(changedPath);
    });
    watcher.on('error', () => undefined);
    return watcher;
  } catch {
    return undefined;
  }
}

function gitMetadataTargets(gitRoot: string, reason: WatchReason): WatchTarget[] {
  return [
    { path: gitRoot, reason, depth: 0 },
    { path: join(gitRoot, 'refs'), reason },
    { path: join(gitRoot, 'logs', 'refs'), reason }
  ];
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

function shouldIgnoreWatchPath(target: WatchTarget, candidatePath: string): boolean {
  if (target.reason === 'worktree') {
    return shouldIgnoreWorktreePath(candidatePath);
  }

  return candidatePath
    .split(/[\\/]/)
    .some((part) => part === 'objects' || part === 'hooks' || part === 'modules');
}
