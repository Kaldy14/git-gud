import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, realpath, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { app } from 'electron';
import Store from 'electron-store';

import type {
  ExternalApplicationId,
  OpenPullRequestInApplicationInput,
  OpenPullRequestInApplicationResult
} from '@shared/externalApplications';
import { isExternalApplicationId } from '@shared/externalApplications';
import type { GitRemote, RepoTab } from '@shared/types';

import { launchExternalApplication } from './externalApplications';
import { gitExecutor, type GitExecutor } from './git/exec';
import { parseWorktreeList } from './git/parsers/worktree';
import { createProfileCommandEnv } from './profiles';

export type ManagedPullRequestWorktreeEntry = {
  id: string;
  controlPath: string;
  commonDir: string;
  refName: string;
  path: string;
  host: string;
  owner: string;
  repository: string;
  number: number;
  headSha: string;
  applicationId: ExternalApplicationId;
  leaseProcessId?: number;
  createdAt: string;
  lastOpenedAt: string;
};

export type ManagedPullRequestWorktreeRegistry = {
  list: () => ManagedPullRequestWorktreeEntry[];
  save: (entry: ManagedPullRequestWorktreeEntry) => void;
  remove: (entryId: string) => void;
};

type ManagedWorktreeStoreShape = {
  entries: ManagedPullRequestWorktreeEntry[];
};

type PrepareInput = {
  tab: RepoTab;
  pullRequest: OpenPullRequestInApplicationInput;
};

const staleWorktreeAgeMs = 24 * 60 * 60 * 1_000;
const maximumLeaseAgeMs = 7 * staleWorktreeAgeMs;
const managedWorktreeStore = new Store<ManagedWorktreeStoreShape>({
  name: 'git-gud-review-worktrees',
  clearInvalidConfig: true,
  ...testStoreDirectory('review-worktrees'),
  defaults: {
    entries: []
  }
});
const persistentRegistry: ManagedPullRequestWorktreeRegistry = {
  list: () => normalizeEntries(managedWorktreeStore.get('entries', [])),
  save: (entry) => {
    const entries = normalizeEntries(managedWorktreeStore.get('entries', []));
    managedWorktreeStore.set('entries', [
      ...entries.filter((candidate) => candidate.id !== entry.id),
      entry
    ]);
  },
  remove: (entryId) => {
    managedWorktreeStore.set(
      'entries',
      normalizeEntries(managedWorktreeStore.get('entries', []))
        .filter((entry) => entry.id !== entryId)
    );
  }
};

let productionService: ManagedPullRequestWorktreeService | undefined;

export class ManagedPullRequestWorktreeService {
  private readonly leasesByPath = new Map<string, number>();
  private readonly preparations = new Map<string, Promise<ManagedPullRequestWorktreeEntry>>();

  constructor(
    private readonly rootPath: string,
    private readonly registry: ManagedPullRequestWorktreeRegistry,
    private readonly executor: Pick<GitExecutor, 'run'> = gitExecutor
  ) {}

  async prepare(input: PrepareInput): Promise<ManagedPullRequestWorktreeEntry> {
    const commonDir = await canonicalPath(input.tab.commonDir);
    const headSha = input.pullRequest.headSha.toLowerCase();
    const preparationKey = [
      commonDir,
      input.pullRequest.owner.toLowerCase(),
      input.pullRequest.repository.toLowerCase(),
      input.pullRequest.number,
      headSha
    ].join('\0');
    const existingPreparation = this.preparations.get(preparationKey);

    if (existingPreparation) {
      return existingPreparation;
    }

    const preparation = this.prepareSnapshot(input, commonDir, headSha)
      .finally(() => {
        this.preparations.delete(preparationKey);
      });
    this.preparations.set(preparationKey, preparation);
    return preparation;
  }

  retain(entry: ManagedPullRequestWorktreeEntry): void {
    this.leasesByPath.set(entry.path, (this.leasesByPath.get(entry.path) ?? 0) + 1);
  }

  recordLeaseProcess(
    entry: ManagedPullRequestWorktreeEntry,
    processId: number | undefined
  ): ManagedPullRequestWorktreeEntry {
    const updatedEntry = {
      ...entry,
      ...(processId ? { leaseProcessId: processId } : {})
    };
    this.registry.save(updatedEntry);
    return updatedEntry;
  }

  async releaseAndCleanup(entry: ManagedPullRequestWorktreeEntry): Promise<boolean> {
    const leases = Math.max(0, (this.leasesByPath.get(entry.path) ?? 1) - 1);

    if (leases > 0) {
      this.leasesByPath.set(entry.path, leases);
      return false;
    }

    this.leasesByPath.delete(entry.path);
    return this.cleanup(entry);
  }

  async cleanupExpired(now = Date.now()): Promise<{ removed: number; preserved: number }> {
    const expiredEntries = this.registry.list().filter((entry) => {
      const age = now - Date.parse(entry.lastOpenedAt);

      if (!entry.leaseProcessId) {
        return age >= staleWorktreeAgeMs;
      }

      return !isProcessRunning(entry.leaseProcessId) || age >= maximumLeaseAgeMs;
    });
    let removed = 0;

    for (const entry of expiredEntries) {
      try {
        if (await this.cleanup(entry)) {
          removed += 1;
        }
      } catch {
        // Missing repositories and unsafe worktrees are preserved for a later pass.
      }
    }

    return {
      removed,
      preserved: expiredEntries.length - removed
    };
  }

  async cleanup(entry: ManagedPullRequestWorktreeEntry): Promise<boolean> {
    if ((this.leasesByPath.get(entry.path) ?? 0) > 0 || !this.ownsPath(entry.path)) {
      return false;
    }

    await mkdir(this.rootPath, { recursive: true });
    const commandContext = await this.commandContext(entry);
    const registeredWorktree = await this.findRegisteredWorktree(entry, commandContext);
    const worktreeExists = await pathExists(entry.path);

    if (!worktreeExists && !registeredWorktree) {
      await this.deleteManagedRef(commandContext, entry);
      this.registry.remove(entry.id);
      await this.removeEmptyParents(entry.path);
      return true;
    }

    if (!worktreeExists || !registeredWorktree || registeredWorktree.head !== entry.headSha) {
      return false;
    }

    const canonicalRoot = await canonicalPath(this.rootPath);
    const canonicalWorktree = await canonicalPath(entry.path);

    if (!isDescendant(canonicalRoot, canonicalWorktree)) {
      return false;
    }

    const [status, head] = await Promise.all([
      this.executor.run(
        ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
        { cwd: entry.path }
      ),
      this.executor.run(['rev-parse', 'HEAD'], { cwd: entry.path })
    ]);

    if (status.stdout.length > 0 || head.stdout.trim().toLowerCase() !== entry.headSha) {
      return false;
    }

    await this.executor.run(
      [...commandContext.gitPrefix, 'worktree', 'remove', entry.path],
      { cwd: commandContext.cwd, kind: 'mutation' }
    );
    await this.deleteManagedRef(commandContext, entry);
    this.registry.remove(entry.id);
    await this.removeEmptyParents(entry.path);
    return true;
  }

  private async prepareSnapshot(
    input: PrepareInput,
    commonDir: string,
    headSha: string
  ): Promise<ManagedPullRequestWorktreeEntry> {
    await mkdir(this.rootPath, { recursive: true });
    const host = new URL(input.pullRequest.url).host.toLowerCase();
    const entries = this.registry.list();
    const reusableEntry = entries.find((entry) =>
      entry.commonDir === commonDir &&
      entry.host === host &&
      entry.owner.toLowerCase() === input.pullRequest.owner.toLowerCase() &&
      entry.repository.toLowerCase() === input.pullRequest.repository.toLowerCase() &&
      entry.number === input.pullRequest.number &&
      entry.headSha === headSha
    );

    if (reusableEntry && await this.isReusable(reusableEntry)) {
      const updatedEntry = {
        ...reusableEntry,
        applicationId: input.pullRequest.applicationId,
        lastOpenedAt: new Date().toISOString()
      };
      this.registry.save(updatedEntry);
      return updatedEntry;
    }

    const env = createProfileCommandEnv(input.tab.assignedProfileId);
    const remoteResult = await this.executor.run(
      ['config', '--get-regexp', '^remote\\..*\\.(url|pushurl)$'],
      {
        cwd: input.tab.path,
        env,
        allowedExitCodes: [1]
      }
    );
    const repositoryKey = createRepositoryKey(
      host,
      input.pullRequest.owner,
      input.pullRequest.repository
    );
    const remote = parseConfiguredRemotes(remoteResult.stdout).find((candidate) =>
      [candidate.fetchUrl, candidate.pushUrl]
        .map(repositoryKeyFromRemoteUrl)
        .includes(repositoryKey)
    );

    if (!remote) {
      throw new Error(
        `No local remote matches ${input.pullRequest.owner}/${input.pullRequest.repository}.`
      );
    }

    const repositoryHash = shortHash(commonDir);
    const refName = [
      'refs/git-gud/pull-requests',
      repositoryHash,
      input.pullRequest.number,
      headSha
    ].join('/');
    const existingRef = await this.executor.run(
      ['rev-parse', '--verify', '--quiet', `${refName}^{commit}`],
      { cwd: input.tab.path, env, allowedExitCodes: [1] }
    );

    if (existingRef.stdout.trim().toLowerCase() !== headSha) {
      await this.executor.run(
        [
          'fetch',
          '--no-tags',
          '--force',
          remote.name,
          `+refs/pull/${input.pullRequest.number}/head:${refName}`
        ],
        {
          cwd: input.tab.path,
          kind: 'mutation',
          env,
          cancellable: true
        }
      );
    }

    const resolvedHead = await this.executor.run(
      ['rev-parse', '--verify', `${refName}^{commit}`],
      { cwd: input.tab.path, env }
    );

    if (resolvedHead.stdout.trim().toLowerCase() !== headSha) {
      await this.executor.run(
        ['update-ref', '-d', refName, resolvedHead.stdout.trim()],
        {
          cwd: input.tab.path,
          kind: 'mutation',
          env
        }
      );
      throw new Error(
        'The pull request changed while its temporary checkout was being prepared. Refresh and try again.'
      );
    }

    const repositoryDirectory = join(this.rootPath, repositoryHash);
    await mkdir(repositoryDirectory, { recursive: true });
    const baseName = [
      sanitizePathPart(input.pullRequest.owner),
      sanitizePathPart(input.pullRequest.repository),
      `pr-${input.pullRequest.number}`,
      headSha.slice(0, 12)
    ].join('-');
    const basePath = join(repositoryDirectory, baseName);
    const worktreePath = await pathExists(basePath)
      ? `${basePath}-${randomUUID().slice(0, 8)}`
      : basePath;

    const now = new Date().toISOString();
    const entry: ManagedPullRequestWorktreeEntry = {
      id: randomUUID(),
      controlPath: input.tab.path,
      commonDir,
      refName,
      path: worktreePath,
      host,
      owner: input.pullRequest.owner,
      repository: input.pullRequest.repository,
      number: input.pullRequest.number,
      headSha,
      applicationId: input.pullRequest.applicationId,
      createdAt: now,
      lastOpenedAt: now
    };

    try {
      await this.executor.run(
        ['worktree', 'add', '--detach', worktreePath, refName],
        {
          cwd: input.tab.path,
          kind: 'mutation',
          env
        }
      );
      this.registry.save(entry);
    } catch (error) {
      await this.cleanup(entry).catch(() => false);
      throw error;
    }

    for (const candidate of entries) {
      if (
        candidate.commonDir === commonDir &&
        candidate.host === host &&
        candidate.owner.toLowerCase() === input.pullRequest.owner.toLowerCase() &&
        candidate.repository.toLowerCase() === input.pullRequest.repository.toLowerCase() &&
        candidate.number === input.pullRequest.number &&
        candidate.headSha !== headSha
      ) {
        try {
          await this.cleanup(candidate);
        } catch {
          // A superseded but unsafe checkout must never block opening the current PR.
        }
      }
    }

    return entry;
  }

  private async isReusable(entry: ManagedPullRequestWorktreeEntry): Promise<boolean> {
    if (!this.ownsPath(entry.path) || !await pathExists(entry.path)) {
      return false;
    }

    try {
      const commandContext = await this.commandContext(entry);
      const worktree = await this.findRegisteredWorktree(entry, commandContext);
      return Boolean(
        worktree &&
        worktree.head === entry.headSha &&
        worktree.detached
      );
    } catch {
      return false;
    }
  }

  private ownsPath(path: string): boolean {
    return isDescendant(resolve(this.rootPath), resolve(path));
  }

  private async commandContext(entry: ManagedPullRequestWorktreeEntry): Promise<{
    cwd: string;
    gitPrefix: string[];
  }> {
    if (await pathExists(entry.controlPath)) {
      return { cwd: entry.controlPath, gitPrefix: [] };
    }

    if (await pathExists(entry.commonDir)) {
      return {
        cwd: entry.commonDir,
        gitPrefix: [`--git-dir=${entry.commonDir}`]
      };
    }

    throw new Error('The repository for this temporary worktree is no longer available.');
  }

  private async loadWorktrees(commandContext: {
    cwd: string;
    gitPrefix: string[];
  }): Promise<ReturnType<typeof parseWorktreeList>> {
    const result = await this.executor.run(
      [...commandContext.gitPrefix, 'worktree', 'list', '--porcelain', '-z'],
      { cwd: commandContext.cwd }
    );
    return parseWorktreeList(result.stdout, commandContext.cwd);
  }

  private async findRegisteredWorktree(
    entry: ManagedPullRequestWorktreeEntry,
    commandContext: { cwd: string; gitPrefix: string[] }
  ): Promise<ReturnType<typeof parseWorktreeList>[number] | undefined> {
    const targetPath = await canonicalPath(entry.path);

    for (const worktree of await this.loadWorktrees(commandContext)) {
      if (await canonicalPath(worktree.path) === targetPath) {
        return worktree;
      }
    }

    return undefined;
  }

  private async deleteManagedRef(
    commandContext: { cwd: string; gitPrefix: string[] },
    entry: ManagedPullRequestWorktreeEntry
  ): Promise<void> {
    await this.executor.run(
      [
        ...commandContext.gitPrefix,
        'update-ref',
        '-d',
        entry.refName,
        entry.headSha
      ],
      {
        cwd: commandContext.cwd,
        kind: 'mutation',
        allowedExitCodes: [1]
      }
    );
  }

  private async removeEmptyParents(worktreePath: string): Promise<void> {
    let current = dirname(worktreePath);
    const root = resolve(this.rootPath);

    while (isDescendant(root, resolve(current))) {
      try {
        await rmdir(current);
      } catch {
        return;
      }
      current = dirname(current);
    }
  }
}

export async function openPullRequestInApplication(
  tab: RepoTab,
  pullRequest: OpenPullRequestInApplicationInput
): Promise<OpenPullRequestInApplicationResult> {
  const service = getProductionService();
  await service.cleanupExpired();
  const entry = await service.prepare({ tab, pullRequest });
  let launchedApplication: Awaited<ReturnType<typeof launchExternalApplication>>;

  try {
    launchedApplication = await launchExternalApplication(
      pullRequest.applicationId,
      entry.path
    );
  } catch (error) {
    await service.cleanup(entry).catch(() => false);
    throw error;
  }

  const { application, launch } = launchedApplication;
  const leasedEntry = service.recordLeaseProcess(entry, launch.processId);
  service.retain(leasedEntry);
  void launch.closed.finally(() => {
    void service.releaseAndCleanup(leasedEntry).catch((error: unknown) => {
      console.warn('Could not clean a managed pull request worktree:', error);
    });
  });

  return {
    applicationName: application.name,
    worktreePath: entry.path,
    cleanup: 'when-closed',
    message: `Opened pull request #${pullRequest.number} in ${application.name}. The temporary checkout will be cleaned after the app session ends.`
  };
}

export async function cleanupExpiredPullRequestWorktrees(): Promise<void> {
  const result = await getProductionService().cleanupExpired();

  if (result.preserved > 0) {
    console.warn(
      `Preserved ${result.preserved} temporary pull request worktree(s) because they could not be removed safely.`
    );
  }
}

function getProductionService(): ManagedPullRequestWorktreeService {
  productionService ??= new ManagedPullRequestWorktreeService(
    join(app.getPath('userData'), 'review-worktrees'),
    persistentRegistry
  );
  return productionService;
}

function createRepositoryKey(host: string, owner: string, repository: string): string {
  return `${host}/${owner}/${repository}`.toLowerCase();
}

function parseConfiguredRemotes(output: string): GitRemote[] {
  const remotes = new Map<string, GitRemote>();

  for (const line of output.split('\n')) {
    const match = /^remote\.(.+)\.(url|pushurl)\s+(.+)$/.exec(line.trim());

    if (!match) {
      continue;
    }

    const [, name, property, url] = match;
    const remote = remotes.get(name) ?? { name };

    if (property === 'url') {
      remote.fetchUrl = url;
    } else {
      remote.pushUrl = url;
    }

    remotes.set(name, remote);
  }

  return [...remotes.values()];
}

function repositoryKeyFromRemoteUrl(value: string | undefined): string | undefined {
  const remoteUrl = value?.trim();

  if (!remoteUrl) {
    return undefined;
  }

  try {
    const url = new URL(remoteUrl);
    return repositoryKeyFromPath(url.host, url.pathname);
  } catch {
    const scpMatch = /^(?:[^@]+@)?([^:]+):(.+)$/.exec(remoteUrl);
    return scpMatch
      ? repositoryKeyFromPath(scpMatch[1], scpMatch[2])
      : undefined;
  }
}

function repositoryKeyFromPath(host: string, repositoryPath: string): string | undefined {
  const parts = repositoryPath
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '')
    .split('/');

  return parts.length === 2
    ? createRepositoryKey(host, parts[0], parts[1])
    : undefined;
}

function sanitizePathPart(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'repository';
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function isDescendant(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return Boolean(pathFromParent) &&
    !pathFromParent.startsWith('..') &&
    !isAbsolute(pathFromParent);
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function normalizeEntries(value: unknown): ManagedPullRequestWorktreeEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isManagedPullRequestWorktreeEntry);
}

function isManagedPullRequestWorktreeEntry(
  value: unknown
): value is ManagedPullRequestWorktreeEntry {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.controlPath === 'string' &&
    typeof value.commonDir === 'string' &&
    typeof value.refName === 'string' &&
    typeof value.path === 'string' &&
    typeof value.host === 'string' &&
    typeof value.owner === 'string' &&
    typeof value.repository === 'string' &&
    Number.isInteger(value.number) &&
    typeof value.headSha === 'string' &&
    isExternalApplicationId(value.applicationId) &&
    (value.leaseProcessId === undefined ||
      (typeof value.leaseProcessId === 'number' &&
        Number.isInteger(value.leaseProcessId) &&
        value.leaseProcessId > 0)) &&
    typeof value.createdAt === 'string' &&
    typeof value.lastOpenedAt === 'string'
  );
}

function isProcessRunning(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function testStoreDirectory(name: string): { cwd: string } | Record<string, never> {
  if (process.env.NODE_ENV !== 'test') {
    return {};
  }

  return {
    cwd: join(tmpdir(), 'git-gud-vitest-store', name)
  };
}
