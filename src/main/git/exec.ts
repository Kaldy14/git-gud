import { spawn } from 'node:child_process';

export type GitCommandKind = 'read' | 'mutation';

export type GitCommandOptions = {
  cwd: string;
  kind?: GitCommandKind;
  env?: NodeJS.ProcessEnv;
  input?: string;
  allowedExitCodes?: readonly number[];
};

export type GitCommandResult = {
  args: string[];
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number;
};

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

export class GitExecutor {
  private readonly mutationQueues = new Map<string, Promise<void>>();

  async run(args: string[], options: GitCommandOptions): Promise<GitCommandResult> {
    const kind = options.kind ?? 'read';

    if (kind === 'mutation') {
      return this.enqueueMutation(args, options, kind);
    }

    return this.spawnGit(args, options, kind);
  }

  private enqueueMutation(
    args: string[],
    options: GitCommandOptions,
    kind: GitCommandKind
  ): Promise<GitCommandResult> {
    const previous = this.mutationQueues.get(options.cwd) ?? Promise.resolve();
    const runAfterPrevious = previous.catch(() => undefined).then(() => this.spawnGit(args, options, kind));
    const queueTail = runAfterPrevious.then(
      () => undefined,
      () => undefined
    );

    this.mutationQueues.set(options.cwd, queueTail);
    queueTail.finally(() => {
      if (this.mutationQueues.get(options.cwd) === queueTail) {
        this.mutationQueues.delete(options.cwd);
      }
    });

    return runAfterPrevious;
  }

  private spawnGit(args: string[], options: GitCommandOptions, kind: GitCommandKind): Promise<GitCommandResult> {
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
        stdio: ['pipe', 'pipe', 'pipe']
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });
      child.on('error', reject);
      child.on('close', (exitCode) => {
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

      if (options.input) {
        child.stdin.end(options.input);
        return;
      }

      child.stdin.end();
    });
  }
}

export const gitExecutor = new GitExecutor();

function createGitErrorMessage(args: string[], result: GitCommandResult): string {
  return result.stderr.trim() || `git ${args.join(' ')} failed with exit code ${result.exitCode}`;
}
