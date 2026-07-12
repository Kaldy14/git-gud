import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { gitExecutor } from './exec';
import {
  loadComparison,
  loadFileBlame,
  loadFileHistory,
  RepositoryInspectionError
} from './repositoryInspection';

describe('repository inspection', () => {
  it('follows file history through a rename and respects the requested limit', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-inspection-'));

    try {
      const repoPath = await createRepository(rootPath);
      await setIdentity(repoPath, 'Alice Example', 'alice@example.test');
      await commitFile(repoPath, 'old name.txt', 'first\n', 'add old file');
      await commitFile(repoPath, 'old name.txt', 'first\nsecond\n', 'update old file');
      await git(repoPath, ['mv', 'old name.txt', 'new name.txt']);
      await git(repoPath, ['commit', '-m', 'rename file']);

      const history = await loadFileHistory({ path: repoPath }, 'new name.txt');
      const limitedHistory = await loadFileHistory({ path: repoPath }, 'new name.txt', 2);
      const minimumHistory = await loadFileHistory({ path: repoPath }, 'new name.txt', 0);

      expect(history.commits.map((commit) => commit.subject)).toEqual([
        'rename file',
        'update old file',
        'add old file'
      ]);
      expect(history.commits[2]).toMatchObject({
        author: { name: 'Alice Example', email: 'alice@example.test' }
      });
      expect(limitedHistory.commits).toHaveLength(2);
      expect(minimumHistory.commits).toHaveLength(1);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('returns line-level blame authors and contents', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-inspection-'));

    try {
      const repoPath = await createRepository(rootPath);
      await setIdentity(repoPath, 'Alice Example', 'alice@example.test');
      await commitFile(repoPath, 'notes.txt', 'alpha\nbeta\n', 'add notes');
      await setIdentity(repoPath, 'Bob Example', 'bob@example.test');
      await commitFile(repoPath, 'notes.txt', 'alpha\nbeta by bob\n', 'edit second line');

      const blame = await loadFileBlame({ path: repoPath }, 'notes.txt');

      expect(blame.revision).toMatch(/^[0-9a-f]{40,64}$/);
      expect(blame.lines).toHaveLength(2);
      expect(blame.lines[0]).toMatchObject({
        lineNumber: 1,
        originalLineNumber: 1,
        content: 'alpha',
        author: { name: 'Alice Example', email: 'alice@example.test' }
      });
      expect(blame.lines[1]).toMatchObject({
        lineNumber: 2,
        content: 'beta by bob',
        author: { name: 'Bob Example', email: 'bob@example.test' },
        summary: 'edit second line'
      });
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('compares divergent commits with ahead/behind counts, files, and stats', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-inspection-'));

    try {
      const repoPath = await createRepository(rootPath);
      await setIdentity(repoPath, 'Compare Test', 'compare@example.test');
      await commitFile(repoPath, 'base.txt', 'base\n', 'base');
      await git(repoPath, ['branch', '-M', 'main']);
      await git(repoPath, ['checkout', '-b', 'feature']);
      const featurePath = 'feature\todd\nname.txt';
      await commitFile(repoPath, featurePath, 'feature\n', 'feature change');
      await git(repoPath, ['checkout', 'main']);
      await commitFile(repoPath, 'main.txt', 'main\n', 'main change');

      const comparison = await loadComparison({ path: repoPath }, 'main', 'feature');

      expect(comparison).toMatchObject({
        base: 'main',
        head: 'feature',
        ahead: 1,
        behind: 1,
        stats: { filesChanged: 1, additions: 1, deletions: 0 }
      });
      expect(comparison.files).toEqual([
        {
          path: featurePath,
          originalPath: undefined,
          status: 'added',
          staged: false,
          unstaged: false,
          conflicted: false
        }
      ]);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('treats pathspec-magic filenames literally for history and blame', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-inspection-'));

    try {
      const repoPath = await createRepository(rootPath);
      await setIdentity(repoPath, 'Magic Test', 'magic@example.test');
      await commitFile(repoPath, 'ordinary.txt', 'ordinary\n', 'ordinary file');
      const magicPath = ':(top)**';
      await writeRepoFile(repoPath, magicPath, 'literal magic\n');
      await git(repoPath, ['--literal-pathspecs', 'add', '--', magicPath]);
      await git(repoPath, ['commit', '-m', 'magic file']);

      const history = await loadFileHistory({ path: repoPath }, magicPath);
      const blame = await loadFileBlame({ path: repoPath }, magicPath);

      expect(history.commits.map((commit) => commit.subject)).toEqual(['magic file']);
      expect(blame.lines).toMatchObject([
        { lineNumber: 1, content: 'literal magic', author: { name: 'Magic Test' } }
      ]);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('stops oversized blame output with a clear typed error', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-inspection-'));

    try {
      const repoPath = await createRepository(rootPath);
      await setIdentity(repoPath, 'Large Blame Test', 'large@example.test');
      const longLine = 'x'.repeat(256);
      await commitFile(repoPath, 'large.txt', `${longLine}\n`.repeat(25_000), 'large blame file');

      await expect(loadFileBlame({ path: repoPath }, 'large.txt')).rejects.toMatchObject({
        name: 'RepositoryInspectionError',
        code: 'OUTPUT_TOO_LARGE',
        message: expect.stringContaining('8 MiB')
      });
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('rejects unsafe paths and invalid or option-like refs with typed errors', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-inspection-'));

    try {
      const repoPath = await createRepository(rootPath);
      await setIdentity(repoPath, 'Validation Test', 'validation@example.test');
      await commitFile(repoPath, 'tracked.txt', 'tracked\n', 'tracked file');

      await expect(loadFileHistory({ path: repoPath }, '../outside.txt')).rejects.toMatchObject({
        name: 'RepositoryInspectionError',
        code: 'INVALID_PATH'
      } satisfies Partial<RepositoryInspectionError>);
      await expect(loadFileBlame({ path: repoPath }, 'tracked.txt', '--help')).rejects.toMatchObject({
        name: 'RepositoryInspectionError',
        code: 'INVALID_REF'
      } satisfies Partial<RepositoryInspectionError>);
      await expect(loadComparison({ path: repoPath }, 'missing-ref', 'HEAD')).rejects.toMatchObject({
        name: 'RepositoryInspectionError',
        code: 'INVALID_REF'
      } satisfies Partial<RepositoryInspectionError>);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});

async function createRepository(rootPath: string): Promise<string> {
  const repoPath = join(rootPath, 'repo');
  await mkdir(repoPath);
  await git(repoPath, ['init']);
  return repoPath;
}

async function setIdentity(repoPath: string, name: string, email: string): Promise<void> {
  await git(repoPath, ['config', 'user.name', name]);
  await git(repoPath, ['config', 'user.email', email]);
}

async function commitFile(repoPath: string, relativePath: string, contents: string, message: string): Promise<void> {
  await writeRepoFile(repoPath, relativePath, contents);
  await git(repoPath, ['--literal-pathspecs', 'add', '--', relativePath]);
  await git(repoPath, ['commit', '-m', message]);
}

async function writeRepoFile(repoPath: string, relativePath: string, contents: string): Promise<void> {
  const filePath = join(repoPath, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function git(cwd: string, args: string[]) {
  return gitExecutor.run(args, { cwd, kind: 'mutation' });
}
