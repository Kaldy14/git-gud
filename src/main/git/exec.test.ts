import { describe, expect, it } from 'vitest';

import {
  GitCommandTimeoutError,
  GitExecutor,
  GitOperationCancelledError,
  GitOutputLimitError,
  type GitProgressEvent
} from './exec';

describe('GitExecutor coordination', () => {
  it.runIf(process.platform !== 'win32')('caps concurrent reads per repository at six', async () => {
    const executor = new GitExecutor();
    const cwd = process.cwd();
    let activeReads = 0;
    let maxActiveReads = 0;
    const unsubscribe = executor.onProgress((event) => {
      if (event.type === 'start') {
        activeReads += 1;
        maxActiveReads = Math.max(maxActiveReads, activeReads);
      } else if (event.type === 'close') {
        activeReads -= 1;
      }
    });

    const reads = Array.from({ length: 12 }, () =>
      executor.run(['-c', 'alias.pause=!sleep 0.1', 'pause'], { cwd })
    );

    await Promise.all(reads);
    unsubscribe();

    expect(maxActiveReads).toBe(6);
    expect(activeReads).toBe(0);
    await executor.waitForIdle();
  });

  it.runIf(process.platform !== 'win32')('keeps writer preference while the read pool is saturated', async () => {
    const executor = new GitExecutor();
    const cwd = process.cwd();
    const events: string[] = [];
    let startedReads = 0;
    const unsubscribe = executor.onProgress((event) => {
      if (event.type === 'start') {
        startedReads += 1;
      }
    });
    const initialReads = Array.from({ length: 6 }, () =>
      executor.run(['-c', 'alias.pause=!sleep 0.1', 'pause'], { cwd })
    );

    await until(() => startedReads === 6);
    const writer = executor.transaction(cwd, async () => {
      events.push('writer');
    });
    const lateRead = executor.run(['--version'], { cwd }).then(() => {
      events.push('late-read');
    });

    await Promise.all([...initialReads, writer, lateRead]);
    unsubscribe();

    expect(events).toEqual(['writer', 'late-read']);
    await executor.waitForIdle();
  });

  it('keeps a multi-command transaction exclusive from reads and writes', async () => {
    const executor = new GitExecutor();
    const cwd = process.cwd();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = executor.transaction(cwd, async () => {
      events.push('first:start');
      await executor.run(['--version'], { cwd });
      await firstGate;
      events.push('first:end');
    });

    await until(() => events.includes('first:start'));

    const read = executor.run(['--version'], { cwd }).then(() => {
      events.push('read');
    });
    const second = executor.transaction(cwd, async () => {
      events.push('second');
    });

    await nextTask();
    expect(events).toEqual(['first:start']);

    releaseFirst?.();
    await Promise.all([first, read, second]);

    expect(events.slice(0, 2)).toEqual(['first:start', 'first:end']);
    expect(events.slice(2).sort()).toEqual(['read', 'second']);
    await executor.waitForIdle();
  });

  it('rejects and terminates commands that exceed the stdout limit', async () => {
    const executor = new GitExecutor();

    await expect(
      executor.run(['hash-object', '--stdin'], {
        cwd: process.cwd(),
        input: 'bounded output\n',
        maxStdoutBytes: 8
      })
    ).rejects.toBeInstanceOf(GitOutputLimitError);

    await executor.waitForIdle();
  });

  it('publishes bounded progress without command arguments or environment data', async () => {
    const executor = new GitExecutor();
    const events: GitProgressEvent[] = [];
    const unsubscribe = executor.onProgress((event) => events.push(event));

    await executor.run(['--version'], {
      cwd: process.cwd(),
      kind: 'mutation',
      env: { GIT_GUD_SECRET_TEST: 'must-not-leak' }
    });
    unsubscribe();

    expect(events.some((event) => event.type === 'start')).toBe(true);
    expect(events.some((event) => event.type === 'output' && event.stream === 'stdout')).toBe(true);
    expect(events.some((event) => event.type === 'close' && event.exitCode === 0)).toBe(true);
    expect(JSON.stringify(events)).not.toContain('must-not-leak');
    expect(JSON.stringify(events)).not.toContain('--version');
  });

  it('does not publish machine-readable stdout from read commands', async () => {
    const executor = new GitExecutor();
    const events: GitProgressEvent[] = [];
    const unsubscribe = executor.onProgress((event) => events.push(event));

    const result = await executor.run(['--version'], { cwd: process.cwd() });
    unsubscribe();

    expect(result.stdout).toContain('git version');
    expect(events.some((event) => event.type === 'start')).toBe(true);
    expect(events.some((event) => event.type === 'output' && event.stream === 'stdout')).toBe(false);
    expect(events.some((event) => event.type === 'close' && event.exitCode === 0)).toBe(true);
  });

  it('correlates progress only with the operation async context that owns the command', async () => {
    const executor = new GitExecutor();
    const events: GitProgressEvent[] = [];
    const unsubscribe = executor.onProgress((event) => events.push(event));

    await executor.run(['--version'], { cwd: process.cwd() });
    await executor.withProgressContext('operation-1', () =>
      executor.run(['--version'], { cwd: process.cwd() })
    );
    unsubscribe();

    const uncorrelated = events.filter((event) => event.operationId === undefined);
    const correlated = events.filter((event) => event.operationId === 'operation-1');
    expect(uncorrelated.length).toBeGreaterThan(0);
    expect(correlated.length).toBeGreaterThan(0);
    expect(events.every((event) => event.operationId === undefined || event.operationId === 'operation-1')).toBe(true);
  });

  it('only cancels commands explicitly marked cancellable', async () => {
    const executor = new GitExecutor();
    const cwd = process.cwd();
    let started = false;
    const unsubscribe = executor.onProgress((event) => {
      if (event.type === 'start' && event.operationId === 'operation-1') {
        started = true;
      }
    });
    const command = executor.withProgressContext('operation-1', () =>
      executor.run(['-c', 'alias.pause=!sleep 5', 'pause'], {
        cwd,
        cancellable: true
      })
    );

    await until(() => started);
    expect(executor.cancelOperation('operation-1')).toBe(true);
    await expect(command).rejects.toThrow();
    expect(executor.cancelOperation('operation-1')).toBe(false);
    unsubscribe();
  });

  it('cancels a queued operation by id without terminating an uncorrelated read', async () => {
    const executor = new GitExecutor();
    const cwd = process.cwd();
    const events: GitProgressEvent[] = [];
    const unsubscribe = executor.onProgress((event) => events.push(event));
    const uncorrelatedRead = executor.run(['-c', 'alias.pause=!sleep 0.2', 'pause'], { cwd });

    await until(() => events.some((event) => event.type === 'start' && event.operationId === undefined));

    let queuedBodyStarted = false;
    const queuedOperation = executor.withProgressContext('queued-fetch', () =>
      executor.transaction(cwd, async () => {
        queuedBodyStarted = true;
        await executor.run(['--version'], { cwd, kind: 'mutation', cancellable: true });
      })
    );
    const queuedError = queuedOperation.catch((error: unknown) => error);

    await nextTask();
    expect(executor.cancelOperation('other-operation')).toBe(false);
    expect(executor.cancelOperation('queued-fetch')).toBe(true);

    await expect(uncorrelatedRead).resolves.toMatchObject({ exitCode: 0 });
    await expect(queuedError).resolves.toBeInstanceOf(GitOperationCancelledError);
    expect(queuedBodyStarted).toBe(false);
    expect(events.some((event) => event.type === 'start' && event.operationId === 'queued-fetch')).toBe(false);
    unsubscribe();
  });

  it.runIf(process.platform !== 'win32')('cancels a queued read without waiting for a pool slot', async () => {
    const executor = new GitExecutor();
    const cwd = process.cwd();
    let startedReads = 0;
    const operationStarts: string[] = [];
    const unsubscribe = executor.onProgress((event) => {
      if (event.type === 'start') {
        startedReads += 1;
        if (event.operationId) {
          operationStarts.push(event.operationId);
        }
      }
    });
    const activeReads = Array.from({ length: 6 }, () =>
      executor.run(['-c', 'alias.pause=!sleep 0.2', 'pause'], { cwd })
    );

    await until(() => startedReads === 6);
    const queuedRead = executor.withProgressContext('queued-read', () =>
      executor.run(['--version'], { cwd, cancellable: true })
    );
    await nextTask();

    expect(executor.cancelOperation('queued-read')).toBe(true);
    await expect(queuedRead).rejects.toBeInstanceOf(GitOperationCancelledError);
    expect(operationStarts).not.toContain('queued-read');
    await Promise.all(activeReads);
    await executor.waitForIdle();
    unsubscribe();
  });

  it.runIf(process.platform !== 'win32')('times out a command and terminates its process group', async () => {
    const executor = new GitExecutor();
    const startedAt = Date.now();

    await expect(
      executor.run(['-c', 'alias.pause=!sleep 5', 'pause'], {
        cwd: process.cwd(),
        timeoutMs: 25
      })
    ).rejects.toBeInstanceOf(GitCommandTimeoutError);

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    await executor.waitForIdle();
  });

  it('enforces an absolute deadline while a read waits for the repository lock', async () => {
    const executor = new GitExecutor();
    const cwd = process.cwd();
    let releaseWriter: () => void = () => {};
    let markWriterStarted: () => void = () => {};
    const writerGate = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    const writerStarted = new Promise<void>((resolve) => {
      markWriterStarted = resolve;
    });
    const writer = executor.transaction(cwd, async () => {
      markWriterStarted();
      await writerGate;
    });
    await writerStarted;

    await expect(
      executor.run(['--version'], { cwd, deadlineAt: Date.now() + 25 })
    ).rejects.toBeInstanceOf(GitCommandTimeoutError);
    releaseWriter();
    await writer;
    await executor.waitForIdle();
  });

  it('does not cancel a queued read marked non-cancellable', async () => {
    const executor = new GitExecutor();
    const cwd = process.cwd();
    let releaseWriter: () => void = () => {};
    let markWriterStarted: () => void = () => {};
    const writerGate = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    const writerStarted = new Promise<void>((resolve) => {
      markWriterStarted = resolve;
    });
    const writer = executor.transaction(cwd, async () => {
      markWriterStarted();
      await writerGate;
    });
    await writerStarted;
    const queuedRead = executor.withProgressContext('non-cancellable-read', () =>
      executor.run(['--version'], { cwd, cancellable: false })
    );
    await nextTask();

    expect(executor.cancelOperation('non-cancellable-read')).toBe(false);
    releaseWriter();
    await writer;
    await expect(queuedRead).resolves.toMatchObject({ exitCode: 0 });
    await executor.waitForIdle();
  });

  it.runIf(process.platform !== 'win32')('releases mutation transactions after a timeout', async () => {
    const executor = new GitExecutor();
    const cwd = process.cwd();

    await expect(
      executor.run(['-c', 'alias.pause=!sleep 5', 'pause'], {
        cwd,
        kind: 'mutation',
        timeoutMs: 25
      })
    ).rejects.toBeInstanceOf(GitCommandTimeoutError);

    expect(executor.getMutationGeneration(cwd)).toBe(2);
    await expect(executor.run(['--version'], { cwd })).resolves.toMatchObject({ exitCode: 0 });
    await executor.waitForIdle();
  });

  it('rejects an expired deadline before spawning Git', async () => {
    const executor = new GitExecutor();
    const events: GitProgressEvent[] = [];
    const unsubscribe = executor.onProgress((event) => events.push(event));

    await expect(
      executor.run(['--version'], {
        cwd: process.cwd(),
        deadlineAt: Date.now() - 1
      })
    ).rejects.toBeInstanceOf(GitCommandTimeoutError);
    unsubscribe();

    expect(events).toEqual([]);
    await executor.waitForIdle();
  });

  it.runIf(process.platform !== 'win32')('retains only the configured stderr tail', async () => {
    const executor = new GitExecutor();
    const result = await executor.run(
      [
        '-c',
        "alias.fail=!sh -c 'printf \"discard-this-prefix-0123456789012345678901234567890123456789\" >&2; printf \"final-marker\" >&2; exit 7' -",
        'fail'
      ],
      {
        cwd: process.cwd(),
        allowedExitCodes: [7],
        maxStderrBytes: 32
      }
    );

    expect(Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(32);
    expect(result.stderr).toContain('final-marker');
    expect(result.stderr).not.toContain('discard-this-prefix');
  });

  it.runIf(process.platform !== 'win32')('coalesces progress output and preserves its final text', async () => {
    const executor = new GitExecutor();
    const outputs: string[] = [];
    let rawChunks = 0;
    const unsubscribe = executor.onProgress((event) => {
      if (event.type === 'output' && event.stream === 'stdout') {
        outputs.push(event.chunk);
      }
    });

    await executor.run(
      [
        '-c',
        "alias.progress=!sh -c 'for step in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do printf \"step-$step\\n\"; sleep 0.005; done' -",
        'progress'
      ],
      {
        cwd: process.cwd(),
        kind: 'mutation',
        onStdout: () => {
          rawChunks += 1;
        }
      }
    );
    unsubscribe();

    expect(rawChunks).toBeGreaterThan(outputs.length);
    expect(outputs.join('')).toContain('step-20');
  });

  it.runIf(process.platform !== 'win32')('escalates cancellation for a process group that ignores TERM', async () => {
    const executor = new GitExecutor();
    const cwd = process.cwd();
    let started = false;
    const unsubscribe = executor.onProgress((event) => {
      if (event.type === 'start' && event.operationId === 'stubborn-operation') {
        started = true;
      }
    });
    const command = executor.withProgressContext('stubborn-operation', () =>
      executor.run(
        ['-c', "alias.stubborn=!sh -c 'trap \"\" TERM; while :; do sleep 1; done' -", 'stubborn'],
        { cwd, cancellable: true }
      )
    );

    await until(() => started);
    expect(executor.cancelOperation('stubborn-operation')).toBe(true);
    await expect(command).rejects.toThrow();
    await executor.waitForIdle();
    unsubscribe();
  });

  it('does not crash when Git exits before consuming a large stdin payload', async () => {
    const executor = new GitExecutor();

    await expect(
      executor.run(['--version'], {
        cwd: process.cwd(),
        input: 'x'.repeat(16 * 1024 * 1024)
      })
    ).resolves.toMatchObject({ exitCode: 0 });
  });

  it.runIf(process.platform !== 'win32')('force-kills a stubborn Git process group during shutdown', async () => {
    const executor = new GitExecutor();
    let started = false;
    const unsubscribe = executor.onProgress((event) => {
      if (event.type === 'start') {
        started = true;
      }
    });
    const command = executor.run(
      ['-c', "alias.stubborn=!sh -c 'trap \"\" TERM; while :; do sleep 1; done' -", 'stubborn'],
      { cwd: process.cwd(), cancellable: true }
    );

    await until(() => started);
    await executor.shutdown(20);

    await expect(command).rejects.toThrow();
    await executor.waitForIdle();
    unsubscribe();
  });

  it('does not start a queued tracked operation after shutdown begins', async () => {
    const executor = new GitExecutor();
    const cwd = process.cwd();
    let readStarted = false;
    const unsubscribe = executor.onProgress((event) => {
      if (event.type === 'start' && event.operationId === undefined) {
        readStarted = true;
      }
    });
    const activeRead = executor.run(['-c', 'alias.pause=!sleep 5', 'pause'], { cwd });

    await until(() => readStarted);

    let queuedBodyStarted = false;
    const queuedOperation = executor.withProgressContext('queued-during-shutdown', () =>
      executor.transaction(cwd, async () => {
        queuedBodyStarted = true;
        await executor.run(['--version'], { cwd, kind: 'mutation' });
      })
    );

    await nextTask();
    await executor.shutdown(20);

    await expect(activeRead).rejects.toThrow();
    await expect(queuedOperation).rejects.toBeInstanceOf(GitOperationCancelledError);
    expect(queuedBodyStarted).toBe(false);
    await executor.waitForIdle();
    unsubscribe();
  });
});

function nextTask(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }

    await nextTask();
  }

  throw new Error('Condition was not reached.');
}
