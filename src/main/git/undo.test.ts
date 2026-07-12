import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Store from 'electron-store';
import { describe, expect, it, vi } from 'vitest';

import { gitExecutor } from './exec';

describe('persisted undo state', () => {
  it('discards malformed repository buckets instead of trusting their shape', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-undo-store-'));
    const repoPath = join(rootPath, 'repo');

    try {
      const storePath = seedUndoStore(rootPath, {
        [repoPath]: {
          id: 'not-an-array'
        }
      });
      vi.stubEnv('TMPDIR', rootPath);
      vi.resetModules();
      const { loadLatestUndoEntry } = await import('./undo');

      await expect(loadLatestUndoEntry(repoPath)).resolves.toBeUndefined();
      expect(await readPersistedEntries(storePath)).toEqual({});
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('rejects a cross-repository entry without mutating the embedded repository', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-undo-store-'));

    try {
      const callerRepoPath = join(rootPath, 'caller');
      const embeddedRepoPath = join(rootPath, 'embedded');
      const callerHead = await createRepository(callerRepoPath, 'caller');
      const embeddedHeadBefore = await createRepository(embeddedRepoPath, 'embedded');
      await writeFile(join(embeddedRepoPath, 'second.txt'), 'second\n');
      await git(embeddedRepoPath, ['add', 'second.txt']);
      await git(embeddedRepoPath, ['commit', '-m', 'second']);
      const embeddedHeadAfter = await revParseHead(embeddedRepoPath);
      const storePath = seedUndoStore(rootPath, {
        [callerRepoPath]: [
          {
            id: 'cross-repository-entry',
            repoPath: embeddedRepoPath,
            operation: 'commit',
            label: 'Injected cross-repository undo',
            createdAt: new Date().toISOString(),
            requiresConfirmation: true,
            headBefore: embeddedHeadBefore,
            headAfter: embeddedHeadAfter
          }
        ]
      });
      vi.stubEnv('TMPDIR', rootPath);
      vi.resetModules();
      const { undoOperation } = await import('./operations');

      await expect(undoOperation({ path: callerRepoPath }, 'cross-repository-entry')).rejects.toThrow(
        'Undo entry was not found.'
      );
      expect(await revParseHead(callerRepoPath)).toBe(callerHead);
      expect(await revParseHead(embeddedRepoPath)).toBe(embeddedHeadAfter);
      expect(await readPersistedEntries(storePath)).toEqual({
        [callerRepoPath]: []
      });
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});

function seedUndoStore(rootPath: string, entriesByRepo: Record<string, unknown>): string {
  const store = new Store<{ entriesByRepo: unknown }>({
    name: 'git-gud-undo',
    cwd: join(rootPath, 'git-gud-vitest-store', 'undo'),
    defaults: {
      entriesByRepo: {}
    }
  });
  store.set('entriesByRepo', entriesByRepo);
  return store.path;
}

async function readPersistedEntries(storePath: string): Promise<unknown> {
  const stored = JSON.parse(await readFile(storePath, 'utf8')) as { entriesByRepo?: unknown };
  return stored.entriesByRepo;
}

async function createRepository(repoPath: string, label: string): Promise<string> {
  await mkdir(repoPath, { recursive: true });
  await git(repoPath, ['init']);
  await git(repoPath, ['config', 'user.name', 'Undo Store Test']);
  await git(repoPath, ['config', 'user.email', 'undo-store@example.test']);
  await writeFile(join(repoPath, 'initial.txt'), `${label}\n`);
  await git(repoPath, ['add', 'initial.txt']);
  await git(repoPath, ['commit', '-m', 'initial']);
  return revParseHead(repoPath);
}

async function revParseHead(repoPath: string): Promise<string> {
  return (await git(repoPath, ['rev-parse', '--verify', 'HEAD'])).stdout.trim();
}

function git(cwd: string, args: string[]) {
  return gitExecutor.run(args, { cwd, kind: 'mutation' });
}
