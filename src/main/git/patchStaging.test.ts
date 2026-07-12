import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { gitExecutor, type GitCommandResult } from './exec';
import { applyWipPatch, loadFileDiff } from './repositoryDetails';

describe('patch staging', () => {
  it('stages one worktree hunk without staging the rest of the file', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-patch-staging-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };

      await writeRepoFile(repoPath, 'file.txt', 'one\ntwo changed\nthree\nfour\nfive changed\n');

      const diff = await loadFileDiff(tab, { kind: 'wip', path: 'file.txt', staged: false });
      const [firstHunk, secondHunk] = splitHunkPatches(diff.stageablePatch ?? '');

      expect(firstHunk).toContain('two changed');
      expect(secondHunk).toContain('five changed');

      await applyWipPatch(tab, { path: 'file.txt', mode: 'stage', patch: firstHunk ?? '' });

      expect((await git(repoPath, ['show', ':file.txt'])).stdout).toBe('one\ntwo changed\nthree\nfour\nfive\n');
      const unstagedPatch = (await git(repoPath, ['diff', '--unified=0', '--', 'file.txt'])).stdout;

      expect(unstagedPatch).toContain('+five changed');
      expect(unstagedPatch).not.toContain('+two changed');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('unstages one staged hunk without clearing the rest of the index', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-patch-staging-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };

      await writeRepoFile(repoPath, 'file.txt', 'one\ntwo changed\nthree\nfour\nfive changed\n');
      await git(repoPath, ['add', 'file.txt']);

      const diff = await loadFileDiff(tab, { kind: 'wip', path: 'file.txt', staged: true });
      const [firstHunk] = splitHunkPatches(diff.stageablePatch ?? '');

      expect(firstHunk).toContain('two changed');

      await applyWipPatch(tab, { path: 'file.txt', mode: 'unstage', patch: firstHunk ?? '' });

      expect((await git(repoPath, ['show', ':file.txt'])).stdout).toBe('one\ntwo\nthree\nfour\nfive changed\n');
      const stagedPatch = (await git(repoPath, ['diff', '--cached', '--unified=0', '--', 'file.txt'])).stdout;
      const unstagedPatch = (await git(repoPath, ['diff', '--unified=0', '--', 'file.txt'])).stdout;

      expect(stagedPatch).toContain('+five changed');
      expect(stagedPatch).not.toContain('+two changed');
      expect(unstagedPatch).toContain('+two changed');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('preserves trailing whitespace in the final staged patch line', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-patch-staging-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      await writeRepoFile(repoPath, 'file.txt', 'one\ntwo\nthree\nfour\ntrailing spaces   \n');

      const diff = await loadFileDiff(tab, { kind: 'wip', path: 'file.txt', staged: false });
      await applyWipPatch(tab, {
        path: 'file.txt',
        mode: 'stage',
        patch: diff.stageablePatch ?? ''
      });

      expect((await git(repoPath, ['show', ':file.txt'])).stdout).toBe(
        'one\ntwo\nthree\nfour\ntrailing spaces   \n'
      );
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('preserves a final line without a newline while staging', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-patch-staging-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      await writeRepoFile(repoPath, 'file.txt', 'one\ntwo\nthree\nfour\nno final newline');

      const diff = await loadFileDiff(tab, { kind: 'wip', path: 'file.txt', staged: false });
      await applyWipPatch(tab, {
        path: 'file.txt',
        mode: 'stage',
        patch: diff.stageablePatch ?? ''
      });

      expect((await git(repoPath, ['show', ':file.txt'])).stdout).toBe(
        'one\ntwo\nthree\nfour\nno final newline'
      );
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});

async function createBaseRepository(rootPath: string): Promise<string> {
  const repoPath = join(rootPath, 'repo');
  await mkdir(repoPath);
  await git(repoPath, ['init']);
  await git(repoPath, ['config', 'user.name', 'Patch Test']);
  await git(repoPath, ['config', 'user.email', 'patch@example.test']);
  await writeRepoFile(repoPath, 'file.txt', 'one\ntwo\nthree\nfour\nfive\n');
  await git(repoPath, ['add', '.']);
  await git(repoPath, ['commit', '-m', 'base']);
  await git(repoPath, ['checkout', '-B', 'main']);
  return repoPath;
}

async function writeRepoFile(repoPath: string, relativePath: string, contents: string): Promise<void> {
  const filePath = join(repoPath, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function git(repoPath: string, args: string[]): Promise<GitCommandResult> {
  return gitExecutor.run(args, { cwd: repoPath });
}

function splitHunkPatches(patch: string): string[] {
  const lines = splitPatchLines(patch);
  const firstHunkIndex = lines.findIndex((line) => line.startsWith('@@'));

  if (firstHunkIndex === -1) {
    return [];
  }

  const headerLines = lines.slice(0, firstHunkIndex);
  const hunkPatches: string[] = [];
  let hunkStart = firstHunkIndex;

  while (hunkStart < lines.length) {
    const hunkEnd = findNextHunkIndex(lines, hunkStart + 1);
    hunkPatches.push(ensureTrailingNewline([...headerLines, ...lines.slice(hunkStart, hunkEnd)].join('')));
    hunkStart = hunkEnd;
  }

  return hunkPatches;
}

function splitPatchLines(patch: string): string[] {
  const rawLines = patch.split('\n');
  return rawLines
    .map((line, index) => (index < rawLines.length - 1 ? `${line}\n` : line))
    .filter((line) => line.length > 0);
}

function findNextHunkIndex(lines: string[], startIndex: number): number {
  const nextIndex = lines.findIndex((line, index) => index >= startIndex && line.startsWith('@@'));
  return nextIndex === -1 ? lines.length : nextIndex;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}
