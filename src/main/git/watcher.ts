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
  commonDir: string;
  watchers: CloseableWatcher[];
  worktreeWatchers: Map<string, CloseableWatcher>;
  pendingTimer?: NodeJS.Timeout;
  pendingSince?: number;
  pendingReasons: Set<WatchReason>;
  pendingPaths: Set<string>;
  pendingUnknownPaths: boolean;
  mutationDepth: number;
  refMutationDepth: number;
  mutationFailed: boolean;
  suppressedReasons: Set<WatchReason>;
  suppressedPaths: Set<string>;
  suppressedUnknownPaths: boolean;
};

type CloseableWatcher = {
  close: () => void | Promise<void>;
};

export class RepoWatcherRegistry {
  private readonly watches = new Map<string, ActiveRepoWatch>();
  private readonly sharedWatches = new Map<string, {
    watcher: CloseableWatcher;
    listeners: Set<(changedPath: string | undefined) => void>;
  }>();

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

  syncWorktrees(repoPath: string, worktreePaths: readonly string[]): void {
    const activeWatch = this.watches.get(repoPath);

    if (!activeWatch) {
      return;
    }

    const nextPaths = new Set([repoPath, ...worktreePaths]);

    for (const [worktreePath, watcher] of activeWatch.worktreeWatchers) {
      if (nextPaths.has(worktreePath)) {
        continue;
      }

      activeWatch.worktreeWatchers.delete(worktreePath);
      void watcher.close();
    }

    for (const worktreePath of nextPaths) {
      if (activeWatch.worktreeWatchers.has(worktreePath)) {
        continue;
      }

      const watcher = this.subscribe({ path: worktreePath, reason: 'worktree' }, (changedPath) => {
        this.enqueueChange(activeWatch, 'worktree', changedPath);
      });

      if (watcher) {
        activeWatch.worktreeWatchers.set(worktreePath, watcher);
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

  async runDuringMutation<T>(repoPath: string, operation: () => Promise<T>): Promise<T> {
    const activeWatch = this.watches.get(repoPath);

    if (!activeWatch) {
      return operation();
    }

    activeWatch.mutationDepth += 1;
    let succeeded = false;

    try {
      const result = await operation();
      succeeded = true;
      return result;
    } finally {
      activeWatch.mutationDepth = Math.max(0, activeWatch.mutationDepth - 1);
      activeWatch.mutationFailed ||= !succeeded;

      if (activeWatch.mutationDepth === 0 && activeWatch.refMutationDepth === 0) {
        this.finishMutation(activeWatch);
      }
    }
  }

  async runDuringRefMutation<T>(commonDir: string, operation: () => Promise<T>): Promise<T> {
    const watches = [...this.watches.values()].filter((watch) => watch.commonDir === commonDir);
    for (const watch of watches) watch.refMutationDepth += 1;
    let succeeded = false;
    try {
      const result = await operation();
      succeeded = true;
      return result;
    } finally {
      for (const watch of watches) {
        watch.refMutationDepth = Math.max(0, watch.refMutationDepth - 1);
        watch.mutationFailed ||= !succeeded;
        if (watch.mutationDepth === 0 && watch.refMutationDepth === 0) this.finishMutation(watch);
      }
    }
  }

  private async closeActiveWatch(repoPath: string, activeWatch: ActiveRepoWatch): Promise<void> {
    this.watches.delete(repoPath);

    if (activeWatch.pendingTimer) {
      clearTimeout(activeWatch.pendingTimer);
      activeWatch.pendingTimer = undefined;
    }

    activeWatch.suppressedReasons.clear();
    activeWatch.suppressedPaths.clear();

    await Promise.allSettled(
      [...activeWatch.watchers, ...activeWatch.worktreeWatchers.values()].map((watcher) => watcher.close())
    );
  }

  private open(repository: RepositorySummary): void {
    const targets = dedupeTargets([
      ...gitMetadataTargets(repository.gitDir, 'git-dir'),
      ...gitMetadataTargets(repository.commonDir, 'common-dir')
    ]);
    const activeWatch: ActiveRepoWatch = {
      repoPath: repository.path,
      commonDir: repository.commonDir,
      watchers: [],
      worktreeWatchers: new Map(),
      pendingReasons: new Set(),
      pendingPaths: new Set(),
      pendingUnknownPaths: false,
      mutationDepth: 0,
      refMutationDepth: 0,
      mutationFailed: false,
      suppressedReasons: new Set(),
      suppressedPaths: new Set(),
      suppressedUnknownPaths: false
    };

    for (const target of targets) {
      const watcher = this.subscribe(target, (changedPath) => {
        this.enqueueChange(activeWatch, target.reason, changedPath);
      });

      if (watcher) {
        activeWatch.watchers.push(watcher);
      }
    }

    this.syncInitialWorktree(activeWatch, repository.path);

    if (activeWatch.watchers.length > 0 || activeWatch.worktreeWatchers.size > 0) {
      this.watches.set(repository.path, activeWatch);
    }
  }

  private syncInitialWorktree(activeWatch: ActiveRepoWatch, repoPath: string): void {
    const watcher = this.subscribe({ path: repoPath, reason: 'worktree' }, (changedPath) => {
      this.enqueueChange(activeWatch, 'worktree', changedPath);
    });

    if (watcher) {
      activeWatch.worktreeWatchers.set(repoPath, watcher);
    }
  }

  private enqueueChange(activeWatch: ActiveRepoWatch, reason: WatchReason, changedPath: string | undefined): void {
    if (this.watches.get(activeWatch.repoPath) !== activeWatch) {
      return;
    }
    if (activeWatch.mutationDepth > 0 || (activeWatch.refMutationDepth > 0 && reason !== 'worktree')) {
      activeWatch.suppressedUnknownPaths = recordChange(activeWatch.suppressedReasons, activeWatch.suppressedPaths, reason, changedPath) || activeWatch.suppressedUnknownPaths;
      return;
    }

    activeWatch.pendingUnknownPaths = recordChange(activeWatch.pendingReasons, activeWatch.pendingPaths, reason, changedPath) || activeWatch.pendingUnknownPaths;
    this.schedulePendingChange(activeWatch);
  }

  private finishMutation(activeWatch: ActiveRepoWatch): void {
    if (this.watches.get(activeWatch.repoPath) !== activeWatch) {
      return;
    }

    if (activeWatch.mutationFailed) {
      activeWatch.pendingUnknownPaths ||= activeWatch.suppressedUnknownPaths;
      for (const reason of activeWatch.suppressedReasons) {
        activeWatch.pendingReasons.add(reason);
      }

      for (const path of activeWatch.suppressedPaths) {
        if (activeWatch.pendingPaths.size >= maxPendingPaths && !activeWatch.pendingPaths.has(path)) {
          activeWatch.pendingUnknownPaths = true;
        } else activeWatch.pendingPaths.add(path);
      }

      if (activeWatch.suppressedReasons.size > 0) {
        this.schedulePendingChange(activeWatch);
      }
    }

    activeWatch.mutationFailed = false;
    activeWatch.suppressedReasons.clear();
    activeWatch.suppressedPaths.clear();
    activeWatch.suppressedUnknownPaths = false;
  }

  private schedulePendingChange(activeWatch: ActiveRepoWatch): void {
    if (activeWatch.pendingTimer) {
      clearTimeout(activeWatch.pendingTimer);
    }

    activeWatch.pendingSince ??= Date.now();
    const delay = Math.min(repoChangeDebounceMs, Math.max(0, maxRepoChangeDelayMs - (Date.now() - activeWatch.pendingSince)));
    activeWatch.pendingTimer = setTimeout(() => {
      const reasons = [...activeWatch.pendingReasons];
      const paths = activeWatch.pendingUnknownPaths ? [] : [...activeWatch.pendingPaths];
      activeWatch.pendingReasons.clear();
      activeWatch.pendingPaths.clear();
      activeWatch.pendingUnknownPaths = false;
      activeWatch.pendingTimer = undefined;
      activeWatch.pendingSince = undefined;

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
    }, delay);
  }

  private subscribe(target: WatchTarget, listener: (changedPath: string | undefined) => void): CloseableWatcher | undefined {
    const key = `${target.reason === 'worktree' ? 'worktree' : 'git'}:${target.depth ?? 'recursive'}:${target.path}`;
    let shared = this.sharedWatches.get(key);
    if (!shared) {
      const listeners = new Set<(changedPath: string | undefined) => void>();
      const watcher = createWatcher(target, (changedPath) => {
        for (const callback of listeners) callback(changedPath);
      });
      if (!watcher) return undefined;
      shared = { watcher, listeners };
      this.sharedWatches.set(key, shared);
    }
    shared.listeners.add(listener);
    const subscription = shared;
    return {
      close: () => {
        subscription.listeners.delete(listener);
        if (subscription.listeners.size === 0 && this.sharedWatches.get(key) === subscription) {
          this.sharedWatches.delete(key);
          return subscription.watcher.close();
        }
      }
    };
  }
}

const repoChangeDebounceMs = 350;
const maxRepoChangeDelayMs = 1000;
const maxPendingPaths = 32;

function recordChange(
  reasons: Set<WatchReason>,
  paths: Set<string>,
  reason: WatchReason,
  changedPath: string | undefined
): boolean {
  reasons.add(reason);

  if (!changedPath || (paths.size >= maxPendingPaths && !paths.has(changedPath))) return true;
  if (paths.size < maxPendingPaths) {
    paths.add(changedPath);
  }
  return false;
}

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

  const nativeWatcher = createNativeGitMetadataWatcher(target, onChange);

  if (nativeWatcher) {
    return nativeWatcher;
  }

  return createChokidarWatcher(target, onChange);
}

function createChokidarWatcher(
  target: WatchTarget,
  onChange: (changedPath: string | undefined) => void
): ChokidarWatcher {
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

function createNativeGitMetadataWatcher(
  target: WatchTarget,
  onChange: (changedPath: string | undefined) => void
): CloseableWatcher | undefined {
  try {
    let closed = false;
    let fallbackWatcher: ChokidarWatcher | undefined;
    const nativeWatcher = watch(target.path, { recursive: target.depth !== 0 }, (_eventType, filename) => {
      const changedPath = filename
        ? isAbsolute(filename)
          ? filename
          : join(target.path, filename)
        : undefined;

      if (changedPath && shouldIgnoreWatchPath(target, changedPath)) {
        return;
      }

      onChange(changedPath);
    });
    nativeWatcher.on('error', () => {
      if (closed || fallbackWatcher) {
        return;
      }

      nativeWatcher.close();
      fallbackWatcher = createChokidarWatcher(target, onChange);
    });
    return {
      close() {
        closed = true;
        nativeWatcher.close();
        return fallbackWatcher?.close();
      }
    };
  } catch {
    return undefined;
  }
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

  // Lock files are transient; the final index/ref/config rename supplies the change.
  if (candidatePath.endsWith('.lock')) return true;

  return candidatePath
    .split(/[\\/]/)
    .some((part) => part === 'objects' || part === 'hooks' || part === 'modules');
}
