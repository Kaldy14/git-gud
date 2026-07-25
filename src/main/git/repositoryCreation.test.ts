import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { gitExecutor } from './exec';
import { cloneRepository, initializeRepository } from './repositoryCreation';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('repository creation', () => {
  it('initializes and validates a local repository with the requested default branch', async () => {
    const parentDirectory = await createTemporaryRoot();

    const repository = await initializeRepository({
      parentDirectory,
      name: 'new-project',
      defaultBranch: 'develop'
    });

    expect(repository.path).toBe(await realpath(join(parentDirectory, 'new-project')));
    expect(repository.name).toBe('new-project');
    const branch = await gitExecutor.run(['symbolic-ref', '--short', 'HEAD'], { cwd: repository.path });
    expect(branch.stdout.trim()).toBe('develop');
  });

  it('clones and validates a local repository', async () => {
    const root = await createTemporaryRoot();
    const source = await initializeRepository({
      parentDirectory: root,
      name: 'source',
      defaultBranch: 'main'
    });
    const cloneParent = await createTemporaryRoot();

    const repository = await cloneRepository({
      parentDirectory: cloneParent,
      sourceUrl: source.path
    });

    expect(repository.path).toBe(await realpath(join(cloneParent, 'source')));
    const origin = await gitExecutor.run(['remote', 'get-url', 'origin'], { cwd: repository.path });
    expect(origin.stdout.trim()).toBe(source.path);
  });

  it('rejects traversal and invalid branch or destination inputs', async () => {
    const parentDirectory = await createTemporaryRoot();

    await expect(
      initializeRepository({ parentDirectory, name: '../outside', defaultBranch: 'main' })
    ).rejects.toThrow('name must be a single safe directory name.');
    await expect(
      initializeRepository({ parentDirectory: 'relative/path', name: 'project', defaultBranch: 'main' })
    ).rejects.toThrow('parentDirectory must be an absolute path.');
    await expect(
      initializeRepository({
        parentDirectory: join(parentDirectory, 'missing'),
        name: 'project',
        defaultBranch: 'main'
      })
    ).rejects.toThrow('parentDirectory must be an existing directory.');
    await expect(
      initializeRepository({ parentDirectory, name: 'project', defaultBranch: 'bad..branch' })
    ).rejects.toThrow('defaultBranch must be a valid Git branch name.');
    await expect(
      cloneRepository({ parentDirectory, sourceUrl: '/source', directoryName: '../outside' })
    ).rejects.toThrow('directoryName must be a single safe directory name.');
  });
});

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'git-gud-create-'));
  temporaryRoots.push(root);
  return root;
}
