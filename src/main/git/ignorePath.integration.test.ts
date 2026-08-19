import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { gitExecutor } from './exec';
import { ignorePath } from './repositoryDetails';

describe('ignorePath', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('adds exact-file, extension, and folder rules to the root .gitignore without duplicates', async () => {
    const repoPath = await createRepository(roots);
    const tab = { path: repoPath, assignedProfileId: undefined };
    await writeRepoFile(repoPath, 'notes/debug.log', 'debug\n');
    await writeRepoFile(repoPath, 'tmp/output.cache', 'cache\n');
    await writeRepoFile(repoPath, 'generated/result.bin', 'binary\n');

    await ignorePath(tab, { path: 'notes/debug.log', mode: 'file' });
    await ignorePath(tab, { path: 'notes/debug.log', mode: 'file' });
    await ignorePath(tab, { path: 'tmp/output.cache', mode: 'extension' });
    await ignorePath(tab, { path: 'generated/result.bin', mode: 'folder' });

    expect(await readFile(join(repoPath, '.gitignore'), 'utf8')).toBe(
      '/notes/debug.log\n*.cache\n/generated/\n'
    );
    expect((await git(repoPath, ['check-ignore', 'notes/debug.log'])).stdout.trim()).toBe('notes/debug.log');
    expect((await git(repoPath, ['check-ignore', 'tmp/output.cache'])).stdout.trim()).toBe('tmp/output.cache');
    expect((await git(repoPath, ['check-ignore', 'generated/result.bin'])).stdout.trim()).toBe('generated/result.bin');
  });

  it('rejects tracked paths and paths outside the repository', async () => {
    const repoPath = await createRepository(roots);
    const tab = { path: repoPath, assignedProfileId: undefined };

    await expect(ignorePath(tab, { path: 'tracked.txt', mode: 'file' })).rejects.toThrow(
      'Only untracked files'
    );
    await expect(ignorePath(tab, { path: '../secret.txt', mode: 'file' })).rejects.toThrow(
      'repository-relative file path'
    );
    await expect(ignorePath(tab, { path: 'line\nbreak.txt', mode: 'file' })).rejects.toThrow(
      'line breaks'
    );
  });

  it('escapes trailing spaces and refuses to follow a root .gitignore symlink', async () => {
    const repoPath = await createRepository(roots);
    const tab = { path: repoPath, assignedProfileId: undefined };
    await writeRepoFile(repoPath, 'odd/trailing.txt ', 'odd\n');

    await ignorePath(tab, { path: 'odd/trailing.txt ', mode: 'file' });

    expect(await readFile(join(repoPath, '.gitignore'), 'utf8')).toBe('/odd/trailing.txt\\ \n');
    expect((await git(repoPath, ['check-ignore', 'odd/trailing.txt '])).stdout.trim()).toBe(
      'odd/trailing.txt'
    );

    await rm(join(repoPath, '.gitignore'));
    await writeFile(join(repoPath, '.gitignore-target'), 'keep me\n', 'utf8');
    await symlink('.gitignore-target', join(repoPath, '.gitignore'));
    await writeRepoFile(repoPath, 'another.tmp', 'tmp\n');

    await expect(ignorePath(tab, { path: 'another.tmp', mode: 'file' })).rejects.toThrow(
      'symbolic-link .gitignore'
    );
    expect(await readFile(join(repoPath, '.gitignore-target'), 'utf8')).toBe('keep me\n');
  });
});

async function createRepository(roots: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'git-gud-ignore-'));
  roots.push(root);
  await git(root, ['init', '--initial-branch=main']);
  await git(root, ['config', 'user.name', 'Git Gud Tests']);
  await git(root, ['config', 'user.email', 'tests@git-gud.local']);
  await writeRepoFile(root, 'tracked.txt', 'tracked\n');
  await git(root, ['add', 'tracked.txt']);
  await git(root, ['commit', '-m', 'initial']);
  return root;
}

async function writeRepoFile(repoPath: string, relativePath: string, contents: string): Promise<void> {
  const target = join(repoPath, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}

async function git(repoPath: string, args: string[]) {
  return gitExecutor.run(args, { cwd: repoPath, kind: 'mutation' });
}
