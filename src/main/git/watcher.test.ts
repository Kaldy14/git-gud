import type { RepoChangedEvent, RepositorySummary } from '@shared/types';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RepoWatcherRegistry } from './watcher';

type NativeWatchCallback = (eventType: string, filename: string | Buffer | null) => void;

const mocks = vi.hoisted(() => ({
  chokidarClose: vi.fn<() => Promise<void>>(),
  chokidarWatch: vi.fn(),
  nativeCallbacks: new Map<string, NativeWatchCallback>(),
  nativePaths: [] as string[],
  nativeErrorCallbacks: new Map<string, () => void>(),
  nativeClose: vi.fn<() => void>()
}));

vi.mock('node:fs', () => ({
  existsSync: () => true,
  watch: (path: string, _options: unknown, listener: NativeWatchCallback) => {
    mocks.nativePaths.push(path);
    mocks.nativeCallbacks.set(path, listener);
    return {
      close: mocks.nativeClose,
      on: (eventName: string, callback: () => void) => {
        if (eventName === 'error') {
          mocks.nativeErrorCallbacks.set(path, callback);
        }
      }
    };
  }
}));

vi.mock('chokidar', () => ({
  default: {
    watch: mocks.chokidarWatch.mockImplementation(() => ({
      close: mocks.chokidarClose,
      on: vi.fn()
    }))
  }
}));

const repository: RepositorySummary = {
  path: '/repo',
  name: 'repo',
  gitDir: '/repo/.git',
  commonDir: '/repo/.git'
};

describe('RepoWatcherRegistry mutation suppression', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.chokidarClose.mockReset();
    mocks.chokidarClose.mockResolvedValue();
    mocks.chokidarWatch.mockClear();
    mocks.nativeCallbacks.clear();
    mocks.nativePaths.length = 0;
    mocks.nativeErrorCallbacks.clear();
    mocks.nativeClose.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('discards nested app-owned mutation events and resumes external notifications afterward', async () => {
    const { emitWorktreeChange, events, registry } = createRegistry();

    await registry.runDuringMutation(repository.path, async () => {
      emitWorktreeChange('src/outer.ts');

      await registry.runDuringMutation(repository.path, async () => {
        emitWorktreeChange('src/inner.ts');
      });

      await vi.advanceTimersByTimeAsync(400);
      expect(events).toEqual([]);
    });

    await vi.advanceTimersByTimeAsync(400);
    expect(events).toEqual([]);

    emitWorktreeChange('src/external.ts');
    await vi.advanceTimersByTimeAsync(350);

    expect(events).toHaveLength(1);
    expect(events[0]?.paths).toEqual(['/repo/src/external.ts']);
    await registry.closeAll();
  });

  it('uses native watches for Git metadata instead of expanding ref trees through Chokidar', async () => {
    const { registry } = createRegistry();

    expect(mocks.nativeCallbacks.size).toBe(4);
    expect(mocks.chokidarWatch).not.toHaveBeenCalled();
    await registry.closeAll();
  });

  it('does not reload repository data for Git lock-file churn', async () => {
    const { events, registry } = createRegistry();

    for (let index = 0; index < 100; index += 1) {
      mocks.nativeCallbacks.get('/repo/.git')?.('rename', 'index.lock');
      mocks.nativeCallbacks.get('/repo/.git/refs')?.('rename', 'remotes/origin/main.lock');
    }
    await vi.advanceTimersByTimeAsync(350);

    expect(events).toEqual([]);
    await registry.closeAll();
  });

  it('ignores fetch bookkeeping while preserving changes to real refs, including refs named FETCH_HEAD', async () => {
    const { events, registry } = createRegistry();

    mocks.nativeCallbacks.get('/repo/.git')?.('change', 'FETCH_HEAD');
    await vi.advanceTimersByTimeAsync(350);
    expect(events).toEqual([]);

    mocks.nativeCallbacks.get('/repo/.git/refs')?.('change', 'heads/FETCH_HEAD');
    mocks.nativeCallbacks.get('/repo/.git/refs')?.('change', 'remotes/origin/main');
    await vi.advanceTimersByTimeAsync(350);
    expect(events).toHaveLength(1);
    expect(events[0]?.paths).toEqual([
      '/repo/.git/refs/heads/FETCH_HEAD',
      '/repo/.git/refs/remotes/origin/main'
    ]);
    await registry.closeAll();
  });

  it('shares physical watches across tabs and linked worktrees', async () => {
    const registry = new RepoWatcherRegistry(() => {});
    const repositories = [repository, ...['second', 'third'].map((name) => ({
      ...repository, path: `/repo-${name}`, gitDir: `/repo/.git/worktrees/${name}`
    }))];
    registry.sync(repositories);
    for (const tab of repositories) {
      registry.syncWorktrees(tab.path, repositories.map((linked) => linked.path));
    }

    expect(mocks.nativePaths.length).toBe(new Set(mocks.nativePaths).size);
    await registry.closeAll();
  });

  it('keeps external changes visible during a continuous stream of filesystem events', async () => {
    const { emitWorktreeChange, events, registry } = createRegistry();

    for (let index = 0; index < 20; index += 1) {
      emitWorktreeChange(`src/file-${index}.ts`);
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(events.length).toBeGreaterThan(0);
    await registry.closeAll();
  });

  it('keeps working-file edits visible during a background ref mutation', async () => {
    const { emitWorktreeChange, events, registry } = createRegistry();
    await registry.runDuringRefMutation(repository.commonDir, async () => {
      mocks.nativeCallbacks.get('/repo/.git/refs')?.('change', 'remotes/origin/main');
      emitWorktreeChange('src/external.ts');
      await vi.advanceTimersByTimeAsync(350);
      expect(events).toHaveLength(1);
      expect(events[0]?.reasons).toEqual(['worktree']);
    });
    await vi.advanceTimersByTimeAsync(350);
    expect(events).toHaveLength(1);
    await registry.closeAll();
  });

  it('keeps a shared watch alive when one subscribing tab closes', async () => {
    const events: RepoChangedEvent[] = [];
    const registry = new RepoWatcherRegistry((event) => events.push(event));
    const linked = { ...repository, path: '/linked', gitDir: '/repo/.git/worktrees/linked' };
    registry.sync([repository, linked]);
    registry.syncWorktrees(linked.path, [repository.path, linked.path]);
    registry.close(repository.path);
    mocks.nativeCallbacks.get(repository.path)?.('change', 'src/after-close.ts');
    await vi.advanceTimersByTimeAsync(350);
    expect(events).toHaveLength(1);
    expect(events[0]?.repoPath).toBe(linked.path);
    await registry.closeAll();
  });

  it('marks overflowing or unnamed event batches as unknown instead of losing a worktree change', async () => {
    const { emitWorktreeChange, events, registry } = createRegistry();
    registry.syncWorktrees(repository.path, ['/linked']);
    for (let index = 0; index < 40; index += 1) {
      mocks.nativeCallbacks.get('/linked')?.('change', `file-${index}.ts`);
    }
    emitWorktreeChange('src/current.ts');
    await vi.advanceTimersByTimeAsync(350);
    expect(events[0]?.paths).toEqual([]);
    mocks.nativeCallbacks.get(repository.path)?.('change', null);
    emitWorktreeChange('src/known.ts');
    await vi.advanceTimersByTimeAsync(350);
    expect(events[1]?.paths).toEqual([]);
    await registry.closeAll();
  });

  it('falls back to Chokidar if a native Git metadata watcher later fails', async () => {
    const { registry } = createRegistry();

    mocks.nativeErrorCallbacks.get('/repo/.git/refs')?.();

    expect(mocks.chokidarWatch).toHaveBeenCalledTimes(1);
    await registry.closeAll();
  });

  it('reports changes from linked worktrees against the open repository', async () => {
    const { events, registry } = createRegistry();
    registry.syncWorktrees(repository.path, [repository.path, '/repo-linked']);
    const linkedListener = mocks.nativeCallbacks.get('/repo-linked');

    expect(linkedListener).toBeDefined();
    linkedListener?.('change', 'src/linked.ts');
    await vi.advanceTimersByTimeAsync(350);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      repoPath: repository.path,
      reasons: ['worktree'],
      paths: ['/repo-linked/src/linked.ts']
    });
    await registry.closeAll();
  });

  it('preserves an external event already pending when a mutation begins', async () => {
    const { emitWorktreeChange, events, registry } = createRegistry();

    emitWorktreeChange('src/before.ts');
    await registry.runDuringMutation(repository.path, async () => {
      emitWorktreeChange('src/owned.ts');
    });
    await vi.advanceTimersByTimeAsync(350);

    expect(events).toHaveLength(1);
    expect(events[0]?.paths).toEqual(['/repo/src/before.ts']);
    await registry.closeAll();
  });

  it('replays one coalesced notification when a mutation fails', async () => {
    const { emitWorktreeChange, events, registry } = createRegistry();

    await expect(
      registry.runDuringMutation(repository.path, async () => {
        emitWorktreeChange('src/first.ts');
        emitWorktreeChange('src/second.ts');
        throw new Error('mutation failed');
      })
    ).rejects.toThrow('mutation failed');
    await vi.advanceTimersByTimeAsync(350);

    expect(events).toHaveLength(1);
    expect(events[0]?.paths).toEqual(['/repo/src/first.ts', '/repo/src/second.ts']);
    await registry.closeAll();
  });
});

function createRegistry(): {
  emitWorktreeChange: (filename: string) => void;
  events: RepoChangedEvent[];
  registry: RepoWatcherRegistry;
} {
  const events: RepoChangedEvent[] = [];
  const registry = new RepoWatcherRegistry((event) => events.push(event));
  registry.sync([repository]);
  const listener = mocks.nativeCallbacks.get(repository.path);

  if (!listener) {
    throw new Error('Expected a native worktree watcher.');
  }

  return {
    emitWorktreeChange(filename) {
      listener('change', filename);
    },
    events,
    registry
  };
}
