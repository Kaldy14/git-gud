import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export type GitCommandKind = 'read' | 'mutation';

export type GitCommandOptions = {
  cwd: string;
  kind?: GitCommandKind;
  env?: NodeJS.ProcessEnv;
  input?: string;
  allowedExitCodes?: readonly number[];
  maxStdoutBytes?: number;
  cancellable?: boolean;
  reportStdoutProgress?: boolean;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
};

export type GitCommandResult = {
  args: string[];
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number;
};

type LockKind = 'read' | 'write';

type LockWaiter = {
  kind: LockKind;
  resolve: (release: () => void) => void;
};

type RepoLockState = {
  activeReaders: number;
  writerActive: boolean;
  queue: LockWaiter[];
};

type ActiveCommand = {
  child: ChildProcessWithoutNullStreams;
  cancellable: boolean;
  ownsProcessGroup: boolean;
};

type OperationContext = {
  operationId: string;
  cancelRequested: boolean;
  activeCommands: Set<ActiveCommand>;
};

export type GitProgressEvent =
  | {
      type: 'start';
      cwd: string;
      kind: GitCommandKind;
      processId?: number;
      operationId?: string;
    }
  | {
      type: 'output';
      cwd: string;
      kind: GitCommandKind;
      processId?: number;
      operationId?: string;
      stream: 'stdout' | 'stderr';
      chunk: string;
    }
  | {
      type: 'close';
      cwd: string;
      kind: GitCommandKind;
      processId?: number;
      operationId?: string;
      exitCode: number;
    };

export type GitProgressListener = (event: GitProgressEvent) => void;

export class GitCommandError extends Error {
  readonly args: string[];
  readonly cwd: string;
  readonly stderr: string;
  readonly stdout: string;
  readonly exitCode: number;
  readonly kind: GitCommandKind;

  constructor(message: string, result: GitCommandResult, kind: GitCommandKind) {
    super(message);
    this.name = 'GitCommandError';
    this.args = result.args;
    this.cwd = result.cwd;
    this.stderr = result.stderr;
    this.stdout = result.stdout;
    this.exitCode = result.exitCode;
    this.kind = kind;
  }
}

export class GitOutputLimitError extends Error {
  readonly args: string[];
  readonly cwd: string;
  readonly maxStdoutBytes: number;

  constructor(args: string[], cwd: string, maxStdoutBytes: number) {
    super(`git ${args.join(' ')} exceeded the ${maxStdoutBytes}-byte output limit.`);
    this.name = 'GitOutputLimitError';
    this.args = args;
    this.cwd = cwd;
    this.maxStdoutBytes = maxStdoutBytes;
  }
}

export class GitOperationCancelledError extends Error {
  readonly operationId: string;

  constructor(operationId: string) {
    super('Git operation was cancelled.');
    this.name = 'GitOperationCancelledError';
    this.operationId = operationId;
  }
}

export class GitExecutor {
  private readonly locks = new Map<string, RepoLockState>();
  private readonly transactionContext = new AsyncLocalStorage<ReadonlySet<string>>();
  private readonly progressContext = new AsyncLocalStorage<OperationContext>();
  private readonly operationContexts = new Map<string, OperationContext>();
  private readonly mutationGenerations = new Map<string, number>();
  private readonly activeCommands = new Set<ActiveCommand>();
  private readonly idleWaiters = new Set<() => void>();
  private readonly progressListeners = new Set<GitProgressListener>();

  getMutationGeneration(cwd: string): number {
    return this.mutationGenerations.get(cwd) ?? 0;
  }

  isInTransaction(cwd: string): boolean {
    return this.transactionContext.getStore()?.has(cwd) ?? false;
  }

  async run(args: string[], options: GitCommandOptions): Promise<GitCommandResult> {
    const kind = options.kind ?? 'read';
    this.throwIfCurrentOperationCancelled();

    if (this.isInTransaction(options.cwd)) {
      return this.spawnGit(args, options, kind);
    }

    if (kind === 'mutation') {
      return this.transaction(options.cwd, () => this.spawnGit(args, options, kind));
    }

    const release = await this.acquire(options.cwd, 'read');

    try {
      this.throwIfCurrentOperationCancelled();
      return await this.spawnGit(args, options, kind);
    } finally {
      release();
    }
  }

  async transaction<T>(cwd: string, task: () => Promise<T>): Promise<T> {
    this.throwIfCurrentOperationCancelled();

    if (this.isInTransaction(cwd)) {
      return task();
    }

    const release = await this.acquire(cwd, 'write');
    let transactionStarted = false;

    try {
      this.throwIfCurrentOperationCancelled();
      const currentContext = this.transactionContext.getStore() ?? new Set<string>();
      const nextContext = new Set(currentContext);
      nextContext.add(cwd);
      transactionStarted = true;
      this.advanceMutationGeneration(cwd);
      return await this.transactionContext.run(nextContext, task);
    } finally {
      if (transactionStarted) {
        this.advanceMutationGeneration(cwd);
      }
      release();
    }
  }

  waitForIdle(): Promise<void> {
    if (this.isIdle()) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.idleWaiters.add(resolve);
    });
  }

  onProgress(listener: GitProgressListener): () => void {
    this.progressListeners.add(listener);
    return () => {
      this.progressListeners.delete(listener);
    };
  }

  async withProgressContext<T>(operationId: string, task: () => Promise<T>): Promise<T> {
    if (this.operationContexts.has(operationId)) {
      throw new Error(`Git operation ${operationId} is already registered.`);
    }

    const context: OperationContext = {
      operationId,
      cancelRequested: false,
      activeCommands: new Set()
    };
    this.operationContexts.set(operationId, context);

    try {
      return await this.progressContext.run(context, async () => {
        this.throwIfOperationCancelled(context);
        const result = await task();
        this.throwIfOperationCancelled(context);
        return result;
      });
    } finally {
      if (this.operationContexts.get(operationId) === context) {
        this.operationContexts.delete(operationId);
      }
      this.notifyIdleIfNeeded();
    }
  }

  terminateActiveProcesses(signal: NodeJS.Signals = 'SIGTERM'): void {
    for (const command of this.activeCommands) {
      this.signalCommand(command, signal);
    }
  }

  cancelOperation(operationId: string): boolean {
    const context = this.operationContexts.get(operationId);

    if (!context) {
      return false;
    }

    const commands = [...context.activeCommands];

    if (commands.some((command) => !command.cancellable)) {
      return false;
    }

    context.cancelRequested = true;

    for (const command of commands) {
      this.signalCommand(command, 'SIGTERM');
    }

    if (commands.length > 0) {
      this.forceTerminateAfter(commands, 750);
    }

    return true;
  }

  async shutdown(graceMs = 1500): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timedOut = await Promise.race([
      this.waitForIdle().then(() => false),
      new Promise<true>((resolve) => {
        timer = setTimeout(() => resolve(true), graceMs);
        timer.unref();
      })
    ]);

    if (timer) {
      clearTimeout(timer);
    }

    if (!timedOut) {
      return;
    }

    for (const context of this.operationContexts.values()) {
      context.cancelRequested = true;
    }

    const commands = [...this.activeCommands];
    for (const command of commands) {
      this.signalCommand(command, 'SIGTERM');
    }

    await this.waitForIdleWithin(Math.min(100, Math.max(20, Math.floor(graceMs / 4))));

    for (const command of commands) {
      if (command.ownsProcessGroup || this.activeCommands.has(command)) {
        this.signalCommand(command, 'SIGKILL');
      }
    }
    await this.waitForIdleWithin(100);
  }

  private acquire(cwd: string, kind: LockKind): Promise<() => void> {
    const state = this.locks.get(cwd) ?? {
      activeReaders: 0,
      writerActive: false,
      queue: []
    };
    this.locks.set(cwd, state);

    if (kind === 'read' && !state.writerActive && !state.queue.some((waiter) => waiter.kind === 'write')) {
      state.activeReaders += 1;
      return Promise.resolve(this.createRelease(cwd, kind));
    }

    if (kind === 'write' && !state.writerActive && state.activeReaders === 0 && state.queue.length === 0) {
      state.writerActive = true;
      return Promise.resolve(this.createRelease(cwd, kind));
    }

    return new Promise((resolve) => {
      state.queue.push({ kind, resolve });
    });
  }

  private createRelease(cwd: string, kind: LockKind): () => void {
    let released = false;

    return () => {
      if (released) {
        return;
      }

      released = true;
      const state = this.locks.get(cwd);

      if (!state) {
        return;
      }

      if (kind === 'read') {
        state.activeReaders -= 1;
      } else {
        state.writerActive = false;
      }

      this.drainLock(cwd, state);
      this.notifyIdleIfNeeded();
    };
  }

  private drainLock(cwd: string, state: RepoLockState): void {
    if (state.writerActive || state.activeReaders > 0) {
      return;
    }

    const first = state.queue[0];

    if (!first) {
      this.locks.delete(cwd);
      return;
    }

    if (first.kind === 'write') {
      state.queue.shift();
      state.writerActive = true;
      first.resolve(this.createRelease(cwd, 'write'));
      return;
    }

    while (state.queue[0]?.kind === 'read') {
      const reader = state.queue.shift();

      if (!reader) {
        break;
      }

      state.activeReaders += 1;
      reader.resolve(this.createRelease(cwd, 'read'));
    }
  }

  private spawnGit(args: string[], options: GitCommandOptions, kind: GitCommandKind): Promise<GitCommandResult> {
    const operationContext = this.progressContext.getStore();
    this.throwIfOperationCancelled(operationContext);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...options.env
    };

    if (kind === 'read') {
      env.GIT_OPTIONAL_LOCKS = '0';
    }

    return new Promise((resolve, reject) => {
      const child = spawn('git', args, {
        cwd: options.cwd,
        env,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      const activeCommand: ActiveCommand = {
        child,
        cancellable: options.cancellable ?? kind === 'read',
        ownsProcessGroup: process.platform !== 'win32'
      };
      const operationId = operationContext?.operationId;
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutBytes = 0;
      let outputLimitError: GitOutputLimitError | undefined;
      let spawnError: Error | undefined;

      this.activeCommands.add(activeCommand);
      operationContext?.activeCommands.add(activeCommand);
      this.emitProgress({
        type: 'start',
        cwd: options.cwd,
        kind,
        processId: child.pid,
        operationId
      });

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.byteLength;

        if (options.maxStdoutBytes !== undefined && stdoutBytes > options.maxStdoutBytes) {
          outputLimitError ??= new GitOutputLimitError(args, options.cwd, options.maxStdoutBytes);
          this.signalCommand(activeCommand, 'SIGTERM');
          this.forceTerminateAfter([activeCommand], 750);
          return;
        }

        stdoutChunks.push(chunk);
        const text = chunk.toString('utf8');
        options.onStdout?.(text);
        if (options.reportStdoutProgress ?? kind === 'mutation') {
          this.emitProgress({
            type: 'output',
            cwd: options.cwd,
            kind,
            processId: child.pid,
            operationId,
            stream: 'stdout',
            chunk: sanitizeProgressChunk(text)
          });
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
        const text = chunk.toString('utf8');
        options.onStderr?.(text);
        this.emitProgress({
          type: 'output',
          cwd: options.cwd,
          kind,
          processId: child.pid,
          operationId,
          stream: 'stderr',
          chunk: sanitizeProgressChunk(text)
        });
      });
      child.stdin.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EPIPE') {
          spawnError = error;
        }
      });
      child.on('error', (error) => {
        spawnError = error;
      });
      child.on('close', (exitCode) => {
        this.activeCommands.delete(activeCommand);
        operationContext?.activeCommands.delete(activeCommand);
        this.emitProgress({
          type: 'close',
          cwd: options.cwd,
          kind,
          processId: child.pid,
          operationId,
          exitCode: exitCode ?? 1
        });
        this.notifyIdleIfNeeded();

        if (outputLimitError) {
          reject(outputLimitError);
          return;
        }

        if (spawnError) {
          reject(spawnError);
          return;
        }

        const result: GitCommandResult = {
          args,
          cwd: options.cwd,
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          exitCode: exitCode ?? 1
        };

        if (result.exitCode === 0 || options.allowedExitCodes?.includes(result.exitCode)) {
          resolve(result);
          return;
        }

        reject(new GitCommandError(createGitErrorMessage(args, result), result, kind));
      });

      if (options.input !== undefined) {
        child.stdin.end(options.input);
        return;
      }

      child.stdin.end();
    });
  }

  private advanceMutationGeneration(cwd: string): void {
    this.mutationGenerations.set(cwd, this.getMutationGeneration(cwd) + 1);
  }

  private isIdle(): boolean {
    return this.activeCommands.size === 0 && this.locks.size === 0 && this.operationContexts.size === 0;
  }

  private throwIfCurrentOperationCancelled(): void {
    this.throwIfOperationCancelled(this.progressContext.getStore());
  }

  private throwIfOperationCancelled(context: OperationContext | undefined): void {
    if (context?.cancelRequested) {
      throw new GitOperationCancelledError(context.operationId);
    }
  }

  private notifyIdleIfNeeded(): void {
    if (!this.isIdle()) {
      return;
    }

    for (const resolve of this.idleWaiters) {
      resolve();
    }

    this.idleWaiters.clear();
  }

  private emitProgress(event: GitProgressEvent): void {
    for (const listener of this.progressListeners) {
      listener(event);
    }
  }

  private signalCommand(command: ActiveCommand, signal: NodeJS.Signals): void {
    if (command.ownsProcessGroup && command.child.pid !== undefined) {
      try {
        process.kill(-command.child.pid, signal);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
          return;
        }
      }
    }

    command.child.kill(signal);
  }

  private async waitForIdleWithin(delayMs: number): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const becameIdle = await Promise.race([
      this.waitForIdle().then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), delayMs);
        timer.unref();
      })
    ]);

    if (timer) {
      clearTimeout(timer);
    }

    return becameIdle;
  }

  private forceTerminateAfter(commands: ActiveCommand[], delayMs: number): void {
    const timer = setTimeout(() => {
      for (const command of commands) {
        if (command.ownsProcessGroup || this.activeCommands.has(command)) {
          this.signalCommand(command, 'SIGKILL');
        }
      }
    }, delayMs);
    timer.unref();
  }
}

export const gitExecutor = new GitExecutor();

function createGitErrorMessage(args: string[], result: GitCommandResult): string {
  return result.stderr.trim() || `git ${args.join(' ')} failed with exit code ${result.exitCode}`;
}

function sanitizeProgressChunk(chunk: string): string {
  let sanitized = '';

  for (const character of chunk) {
    const codePoint = character.codePointAt(0);

    if (codePoint === 9 || codePoint === 10 || codePoint === 13 || (codePoint !== undefined && codePoint >= 32 && codePoint !== 127)) {
      sanitized += character;
    }

    if (sanitized.length >= 16 * 1024) {
      break;
    }
  }

  return sanitized;
}
