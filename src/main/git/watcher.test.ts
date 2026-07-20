import type { RepoChangedEvent, RepositorySummary } from '@shared/types';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RepoWatcherRegistry } from './watcher';

type NativeWatchCallback = (eventType: string, filename: string | Buffer | null) => void;

const mocks = vi.hoisted(() => ({
  chokidarClose: vi.fn<() => Promise<void>>(),
  chokidarWatch: vi.fn(),
  nativeCallbacks: new Map<string, NativeWatchCallback>(),
  nativeErrorCallbacks: new Map<string, () => void>(),
  nativeClose: vi.fn<() => void>()
}));

vi.mock('node:fs', () => ({
  existsSync: () => true,
  watch: (path: string, _options: unknown, listener: NativeWatchCallback) => {
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
