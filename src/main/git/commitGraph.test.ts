import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { gitExecutor } from './exec';
import { loadCommitGraph } from './commitGraph';
import { loadStatus, loadWorktrees } from './repositoryOverview';

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
      await git(repoPath, ['commit', '-am', 'second', '-m', 'Graph body searchable description']);
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
      expect(page.rows[3]?.body).toContain('Graph body searchable description');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('renders a selectable WIP tip for every dirty linked worktree', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-graph-worktrees-'));

    try {
      const repoPath = join(rootPath, 'repo');
      const linkedPath = join(rootPath, 'feature-worktree');
      await mkdir(repoPath);
      await git(repoPath, ['init']);
      await git(repoPath, ['config', 'user.name', 'Graph Test']);
      await git(repoPath, ['config', 'user.email', 'graph@example.test']);
      await writeRepoFile(repoPath, 'README.md', 'base\n');
      await git(repoPath, ['add', '.']);
      await git(repoPath, ['commit', '-m', 'base']);
      await git(repoPath, ['checkout', '-B', 'main']);
      await git(repoPath, ['worktree', 'add', '-b', 'feature/worktree-wip', linkedPath, 'main']);
      const linkedBase = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await writeRepoFile(repoPath, 'main-head.txt', 'main head\n');
      await git(repoPath, ['add', 'main-head.txt']);
      await git(repoPath, ['commit', '-m', 'main head']);
      const mainHead = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await writeRepoFile(repoPath, 'main-wip.txt', 'main changes\n');
      await writeRepoFile(linkedPath, 'linked-wip.txt', 'linked changes\n');
      const canonicalRepoPath = await realpath(repoPath);
      const canonicalLinkedPath = await realpath(linkedPath);

      expect(await loadWorktrees(repoPath)).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: canonicalLinkedPath, branch: 'feature/worktree-wip', current: false })
      ]));
      expect(await loadStatus(linkedPath)).toMatchObject({ isDirty: true, dirtyCount: 1 });

      const page = await loadCommitGraph({ path: repoPath });
      const wipRows = page.rows.filter((row) => row.node.kind === 'wip');
      const linkedPage = await loadCommitGraph({ path: linkedPath });
      const linkedWipRows = linkedPage.rows.filter((row) => row.node.kind === 'wip');

      expect(wipRows).toHaveLength(2);
      expect(wipRows.find((row) => row.worktree?.path === canonicalRepoPath)).toMatchObject({
        sha: 'wip',
        worktree: { path: canonicalRepoPath, branch: 'main', current: true },
        files: [{ path: 'main-wip.txt', status: 'added' }]
      });
      expect(wipRows.find((row) => row.worktree?.path === canonicalLinkedPath)).toMatchObject({
        sha: `wip:${canonicalLinkedPath}`,
        worktree: { path: canonicalLinkedPath, branch: 'feature/worktree-wip', current: false },
        files: [{ path: 'linked-wip.txt', status: 'added' }]
      });
      expect(linkedWipRows.map((row) => row.worktree?.path)).toEqual(
        wipRows.map((row) => row.worktree?.path)
      );
      expect(linkedWipRows.find((row) => row.worktree?.path === canonicalRepoPath)?.worktree).toMatchObject({
        path: canonicalRepoPath,
        current: false
      });
      expect(linkedWipRows.find((row) => row.worktree?.path === canonicalLinkedPath)?.worktree).toMatchObject({
        path: canonicalLinkedPath,
        current: true
      });
      expect(page.rows.map((row) => row.sha)).toEqual([
        'wip',
        mainHead,
        `wip:${canonicalLinkedPath}`,
        linkedBase
      ]);

      const limitedPage = await loadCommitGraph({ path: repoPath }, 1);

      expect(limitedPage.hasMore).toBe(true);
      expect(limitedPage.rows.map((row) => row.sha)).toEqual([
        'wip',
        mainHead,
        `wip:${canonicalLinkedPath}`
      ]);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('interleaves branch histories by committer date', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-graph-'));

    try {
      const repoPath = join(rootPath, 'repo');
      await mkdir(repoPath);
      await git(repoPath, ['init']);
      await git(repoPath, ['config', 'user.name', 'Graph Test']);
      await git(repoPath, ['config', 'user.email', 'graph@example.test']);
      await commitRepoFileAt(repoPath, 'base.txt', 'base\n', 'base', '2026-07-14T10:00:00+02:00');
      await git(repoPath, ['checkout', '-B', 'main']);

      await git(repoPath, ['checkout', '-b', 'feature-a']);
      await commitRepoFileAt(repoPath, 'a.txt', 'old\n', 'feature-a old', '2026-07-14T11:00:00+02:00');
      await commitRepoFileAt(repoPath, 'a.txt', 'new\n', 'feature-a new', '2026-07-14T14:00:00+02:00');

      await git(repoPath, ['checkout', 'main']);
      await git(repoPath, ['checkout', '-b', 'feature-b']);
      await commitRepoFileAt(repoPath, 'b.txt', 'old\n', 'feature-b old', '2026-07-14T12:00:00+02:00');
      await commitRepoFileAt(repoPath, 'b.txt', 'new\n', 'feature-b new', '2026-07-14T13:00:00+02:00');
      await git(repoPath, ['checkout', 'main']);

      const page = await loadCommitGraph({ path: repoPath });

      expect(page.rows.map((row) => row.subject)).toEqual([
        'feature-a new',
        'feature-b new',
        'feature-b old',
        'feature-a old',
        'base'
      ]);
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

async function commitRepoFileAt(
  repoPath: string,
  relativePath: string,
  contents: string,
  message: string,
  committedAt: string
): Promise<void> {
  await writeRepoFile(repoPath, relativePath, contents);
  await git(repoPath, ['add', relativePath]);
  await git(repoPath, ['commit', '-m', message], {
    GIT_AUTHOR_DATE: committedAt,
    GIT_COMMITTER_DATE: committedAt
  });
}

async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv) {
  return gitExecutor.run(args, { cwd, kind: 'mutation', env });
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
