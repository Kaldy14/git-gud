import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { gitExecutor } from './exec';
import { loadCommitGraph } from './commitGraph';

describe('loadCommitGraph', () => {
  it('loads real commits with refs, stash nodes, WIP row, and pagination metadata', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-graph-'));

    try {
      const repoPath = join(rootPath, 'repo');
      const remotePath = join(rootPath, 'remote.git');
      await mkdir(repoPath);

      await git(repoPath, ['init']);
      await git(repoPath, ['config', 'user.name', 'Graph Test']);
      await git(repoPath, ['config', 'user.email', 'graph@example.test']);
      await writeRepoFile(repoPath, 'README.md', 'base\n');
      await git(repoPath, ['add', '.']);
      await git(repoPath, ['commit', '-m', 'base']);
      await git(repoPath, ['checkout', '-B', 'main']);
      await writeRepoFile(repoPath, 'README.md', 'second\n');
      await git(repoPath, ['commit', '-am', 'second']);
      await git(repoPath, ['tag', 'v-graph']);
      await git(rootPath, ['init', '--bare', remotePath]);
      await git(repoPath, ['remote', 'add', 'origin', remotePath]);
      await git(repoPath, ['push', '-u', 'origin', 'main']);

      await writeRepoFile(repoPath, 'README.md', 'stashed\n');
      await git(repoPath, ['stash', 'push', '-m', 'graph stash']);
      await writeRepoFile(repoPath, 'README.md', 'dirty\n');

      const page = await loadCommitGraph({ path: repoPath }, 1);

      expect(page.loadedCommitCount).toBe(1);
      expect(page.hasMore).toBe(true);
      expect(page.rows[0]).toMatchObject({ sha: 'wip', node: { kind: 'wip' } });
      expect(page.rows[1]).toMatchObject({ node: { kind: 'stash' }, refs: [{ label: 'stash@{0}', kind: 'stash' }] });
      expect(page.rows[2]?.subject).toBe('second');
      expect(page.rows[2]?.refs).toEqual(
        expect.arrayContaining([
          { label: 'main', kind: 'branch' },
          { label: 'origin/main', kind: 'remote' },
          { label: 'v-graph', kind: 'tag' }
        ])
      );
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});

async function writeRepoFile(repoPath: string, relativePath: string, contents: string): Promise<void> {
  const filePath = join(repoPath, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function git(cwd: string, args: string[]) {
  return gitExecutor.run(args, { cwd, kind: 'mutation' });
}
