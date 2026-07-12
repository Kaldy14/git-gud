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
      await git(repoPath, ['tag', '-a', 'v-graph', '-m', 'annotated graph tag']);
      await git(rootPath, ['init', '--bare', remotePath]);
      await git(repoPath, ['remote', 'add', 'origin', remotePath]);
      await git(repoPath, ['push', '-u', 'origin', 'main']);

      await writeRepoFile(repoPath, 'README.md', 'stashed\n');
      await git(repoPath, ['stash', 'push', '-m', 'graph stash']);
      await writeRepoFile(repoPath, 'README.md', 'stashed again\n');
      await git(repoPath, ['stash', 'push', '-m', 'newer graph stash']);
      await writeRepoFile(repoPath, 'README.md', 'dirty\n');
      await writeRepoFile(repoPath, '.kiosk-dev/design_handoff_vosime/bee.png', 'bee\n');
      await writeRepoFile(repoPath, '.kiosk-dev/design_handoff_vosime/logo-full.png', 'logo\n');

      const page = await loadCommitGraph({ path: repoPath }, 1);
      const wipFiles = page.rows[0]?.files.map((file) => file.path) ?? [];

      expect(page.loadedCommitCount).toBe(1);
      expect(page.hasMore).toBe(true);
      expect(page.rows[0]).toMatchObject({ sha: 'wip', node: { kind: 'wip' } });
      expect(wipFiles).toEqual(
        expect.arrayContaining([
          '.kiosk-dev/design_handoff_vosime/bee.png',
          '.kiosk-dev/design_handoff_vosime/logo-full.png'
        ])
      );
      expect(wipFiles).not.toContain('.kiosk-dev/');
      expect(page.rows[1]).toMatchObject({
        node: { kind: 'stash' },
        refs: [{ label: 'stash@{0}', kind: 'stash' }]
      });
      expect(page.rows[1]?.subject).toBe('On main: newer graph stash');
      expect(page.rows[2]).toMatchObject({
        subject: 'On main: graph stash',
        node: { kind: 'stash' },
        refs: [{ label: 'stash@{1}', kind: 'stash' }]
      });
      expect(page.rows[1]?.sha).not.toBe(page.rows[2]?.sha);
      expect(page.rows[3]?.subject).toBe('second');
      expect(page.rows[3]?.refs).toEqual(
        expect.arrayContaining([
          { label: 'main', kind: 'branch', current: true },
          { label: 'origin/main', kind: 'remote' },
          { label: 'v-graph', kind: 'tag' }
        ])
      );
      expect(page.rows[3]?.refs?.[0]).toMatchObject({ label: 'main', current: true });
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('loads remote history when the local HEAD is unborn', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-graph-'));

    try {
      const sourcePath = join(rootPath, 'source');
      const repoPath = join(rootPath, 'unborn');
      const remotePath = join(rootPath, 'remote.git');
      await mkdir(sourcePath);
      await mkdir(repoPath);
      await git(sourcePath, ['init']);
      await git(sourcePath, ['config', 'user.name', 'Graph Test']);
      await git(sourcePath, ['config', 'user.email', 'graph@example.test']);
      await writeRepoFile(sourcePath, 'remote.txt', 'remote history\n');
      await git(sourcePath, ['add', '.']);
      await git(sourcePath, ['commit', '-m', 'remote commit']);
      await git(sourcePath, ['branch', '-M', 'main']);
      const remoteCommit = (await git(sourcePath, ['rev-parse', 'HEAD'])).stdout.trim();
      await git(rootPath, ['init', '--bare', remotePath]);
      await git(sourcePath, ['remote', 'add', 'origin', remotePath]);
      await git(sourcePath, ['push', 'origin', 'main']);

      await git(repoPath, ['init']);
      await git(repoPath, ['remote', 'add', 'origin', remotePath]);
      await git(repoPath, ['fetch', 'origin']);

      const page = await loadCommitGraph({ path: repoPath });

      expect(page.rows).toHaveLength(1);
      expect(page.rows[0]).toMatchObject({
        sha: remoteCommit,
        subject: 'remote commit',
        refs: [{ label: 'origin/main', kind: 'remote' }]
      });
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it(
    'stops pagination cleanly at the hard graph cap even when more commits exist',
    async () => {
      const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-graph-'));

      try {
        const repoPath = join(rootPath, 'repo');
        await mkdir(repoPath);
        await git(repoPath, ['init']);
        await fastImportHistory(repoPath, 12_001);
        expect((await git(repoPath, ['rev-list', '--count', 'main'])).stdout.trim()).toBe('12001');

        const page = await loadCommitGraph({ path: repoPath }, 12_000);

        expect(page.loadedCommitCount).toBe(12_000);
        expect(page.limit).toBe(12_000);
        expect(page.hasMore).toBe(false);
        expect(page.nextLimit).toBe(12_000);
      } finally {
        await rm(rootPath, { recursive: true, force: true });
      }
    },
    30_000
  );
});

async function writeRepoFile(repoPath: string, relativePath: string, contents: string): Promise<void> {
  const filePath = join(repoPath, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function git(cwd: string, args: string[]) {
  return gitExecutor.run(args, { cwd, kind: 'mutation' });
}

async function fastImportHistory(repoPath: string, commitCount: number): Promise<void> {
  const chunks = ['blob\nmark :1\ndata 5\nbase\n'];

  for (let index = 1; index <= commitCount; index += 1) {
    const mark = index + 1;
    const message = `commit ${index}\n`;
    const parent = index === 1 ? '' : `from :${mark - 1}\n`;
    const file = index === 1 ? 'M 100644 :1 file.txt\n' : '';
    chunks.push(
      `commit refs/heads/main\nmark :${mark}\ncommitter Graph Test <graph@example.test> ${index} +0000\ndata ${Buffer.byteLength(message)}\n${message}${parent}${file}\n`
    );
  }

  chunks.push('done\n');
  await gitExecutor.run(['fast-import', '--quiet'], {
    cwd: repoPath,
    kind: 'mutation',
    input: chunks.join('')
  });
}
