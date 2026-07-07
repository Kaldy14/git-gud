import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GitCommandError, gitExecutor } from './exec';
import { prepareInteractiveRebasePlan, rebaseOnto, runInteractiveRebase } from './commands/rebase';
import { createBranch, deleteBranch, mergeRef, resetToCommit, resolveConflict, stashPop, stashPush, undoOperation } from './operations';

describe('git operations', () => {
  it('creates, checks out, and safely undoes a branch', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      const result = await createBranch(tab, { name: 'feature/undo-me', checkout: true });

      expect(await currentBranch(repoPath)).toBe('feature/undo-me');
      expect(result.undoEntry).toMatchObject({
        operation: 'branch-create',
        refName: 'feature/undo-me'
      });

      if (!result.undoEntry) {
        throw new Error('Expected branch create to record undo metadata.');
      }

      await undoOperation(tab, result.undoEntry.id);

      expect(await currentBranch(repoPath)).toBe('main');
      await expectGitFailure(repoPath, ['rev-parse', '--verify', 'refs/heads/feature/undo-me']);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('returns conflict state for a conflicting merge and can abort it', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };

      await git(repoPath, ['checkout', '-b', 'feature']);
      await writeRepoFile(repoPath, 'conflict.txt', 'feature\n');
      await git(repoPath, ['commit', '-am', 'feature edit']);
      await git(repoPath, ['checkout', 'main']);
      await writeRepoFile(repoPath, 'conflict.txt', 'main\n');
      await git(repoPath, ['commit', '-am', 'main edit']);

      const result = await mergeRef(tab, { ref: 'feature' });

      expect(result.operation).toMatchObject({ status: 'conflicted' });
      expect(result.conflictState).toMatchObject({
        isActive: true,
        operation: 'merge',
        canAbort: true
      });
      expect(result.conflictState?.files.map((file) => file.path)).toContain('conflict.txt');

      await resolveConflict(tab, { action: 'abort' });

      expect(await currentBranch(repoPath)).toBe('main');
      expect((await git(repoPath, ['status', '--porcelain'])).stdout).toBe('');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('undoes a clean merge without discarding unrelated tracked edits', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };

      await writeRepoFile(repoPath, 'keep.txt', 'base\n');
      await git(repoPath, ['add', 'keep.txt']);
      await git(repoPath, ['commit', '-m', 'add keep']);
      await git(repoPath, ['checkout', '-b', 'feature']);
      await writeRepoFile(repoPath, 'feature.txt', 'feature\n');
      await git(repoPath, ['add', 'feature.txt']);
      await git(repoPath, ['commit', '-m', 'feature edit']);
      await git(repoPath, ['checkout', 'main']);
      await writeRepoFile(repoPath, 'keep.txt', 'local edit\n');

      const result = await mergeRef(tab, { ref: 'feature' });

      expect(result.undoEntry).toMatchObject({
        operation: 'merge'
      });

      if (!result.undoEntry) {
        throw new Error('Expected clean merge to record undo metadata.');
      }

      await undoOperation(tab, result.undoEntry.id);

      expect((await git(repoPath, ['rev-parse', '--verify', 'HEAD'])).stdout.trim()).toBe(result.undoEntry.headBefore);
      expect((await git(repoPath, ['status', '--porcelain'])).stdout).toBe(' M keep.txt\n');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('restores upstream tracking when undoing branch deletion', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const remotePath = join(rootPath, 'origin.git');
      await git(rootPath, ['init', '--bare', remotePath]);
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };

      await git(repoPath, ['remote', 'add', 'origin', remotePath]);
      await git(repoPath, ['push', '-u', 'origin', 'main']);
      await git(repoPath, ['checkout', '-b', 'feature/tracked']);
      await writeRepoFile(repoPath, 'tracked.txt', 'tracked\n');
      await git(repoPath, ['add', 'tracked.txt']);
      await git(repoPath, ['commit', '-m', 'tracked branch']);
      await git(repoPath, ['push', '-u', 'origin', 'feature/tracked']);
      await git(repoPath, ['checkout', 'main']);

      const result = await deleteBranch(tab, { name: 'feature/tracked', force: true });

      expect(result.undoEntry).toMatchObject({
        operation: 'branch-delete',
        refName: 'feature/tracked',
        upstream: 'origin/feature/tracked'
      });

      if (!result.undoEntry) {
        throw new Error('Expected branch delete to record undo metadata.');
      }

      await undoOperation(tab, result.undoEntry.id);

      expect(await branchUpstream(repoPath, 'feature/tracked')).toBe('origin/feature/tracked');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('records and runs mode-specific undo metadata for reset', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      const headBefore = (await git(repoPath, ['rev-parse', '--verify', 'HEAD'])).stdout.trim();

      await writeRepoFile(repoPath, 'second.txt', 'second\n');
      await git(repoPath, ['add', 'second.txt']);
      await git(repoPath, ['commit', '-m', 'second']);
      const headAfterCommit = (await git(repoPath, ['rev-parse', '--verify', 'HEAD'])).stdout.trim();

      const result = await resetToCommit(tab, { target: headBefore, mode: 'mixed' });

      expect((await git(repoPath, ['rev-parse', '--verify', 'HEAD'])).stdout.trim()).toBe(headBefore);
      expect(result.undoEntry).toMatchObject({
        operation: 'reset',
        headBefore: headAfterCommit,
        headAfter: headBefore,
        resetMode: 'mixed'
      });

      if (!result.undoEntry) {
        throw new Error('Expected reset to record undo metadata.');
      }

      await undoOperation(tab, result.undoEntry.id);

      expect((await git(repoPath, ['rev-parse', '--verify', 'HEAD'])).stdout.trim()).toBe(headAfterCommit);
      expect((await git(repoPath, ['status', '--porcelain'])).stdout).toBe('');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('stashes untracked files and restores them with pop', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };

      await writeRepoFile(repoPath, 'notes/stashed.txt', 'stashed\n');

      await stashPush(tab, { message: 'test stash', includeUntracked: true });

      expect((await git(repoPath, ['status', '--porcelain'])).stdout).toBe('');
      expect((await git(repoPath, ['stash', 'list', '--format=%gd:%s'])).stdout.trim()).toContain('test stash');

      await stashPop(tab, { selector: 'stash@{0}' });

      expect(await readFile(join(repoPath, 'notes/stashed.txt'), 'utf8')).toBe('stashed\n');
      expect((await git(repoPath, ['status', '--porcelain'])).stdout).toBe('?? notes/\n');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('returns conflict state for a standard rebase and can abort it', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };

      await git(repoPath, ['checkout', '-b', 'feature/rebase-conflict']);
      await writeRepoFile(repoPath, 'conflict.txt', 'feature\n');
      await git(repoPath, ['commit', '-am', 'feature edit']);
      const featureHead = (await git(repoPath, ['rev-parse', '--verify', 'HEAD'])).stdout.trim();

      await git(repoPath, ['checkout', 'main']);
      await writeRepoFile(repoPath, 'conflict.txt', 'main\n');
      await git(repoPath, ['commit', '-am', 'main edit']);
      await git(repoPath, ['checkout', 'feature/rebase-conflict']);

      const result = await rebaseOnto(tab, { target: 'main' });

      expect(result.operation).toMatchObject({ status: 'conflicted' });
      expect(result.conflictState).toMatchObject({
        isActive: true,
        operation: 'rebase',
        canAbort: true,
        canSkip: true
      });
      expect(result.conflictState?.files.map((file) => file.path)).toContain('conflict.txt');

      await resolveConflict(tab, { action: 'abort' });

      expect(await currentBranch(repoPath)).toBe('feature/rebase-conflict');
      expect((await git(repoPath, ['rev-parse', '--verify', 'HEAD'])).stdout.trim()).toBe(featureHead);
      expect((await git(repoPath, ['status', '--porcelain'])).stdout).toBe('');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('skips a conflicting commit during standard rebase', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      const base = (await git(repoPath, ['rev-parse', '--verify', 'HEAD'])).stdout.trim();

      await git(repoPath, ['checkout', '-b', 'feature/rebase-skip']);
      await writeRepoFile(repoPath, 'conflict.txt', 'feature\n');
      await git(repoPath, ['commit', '-am', 'feature edit']);

      await git(repoPath, ['checkout', 'main']);
      await writeRepoFile(repoPath, 'conflict.txt', 'main\n');
      await git(repoPath, ['commit', '-am', 'main edit']);
      await git(repoPath, ['checkout', 'feature/rebase-skip']);

      const result = await rebaseOnto(tab, { target: 'main' });

      expect(result.operation).toMatchObject({ status: 'conflicted' });
      expect(result.conflictState).toMatchObject({
        isActive: true,
        operation: 'rebase',
        canSkip: true
      });

      const skipped = await resolveConflict(tab, { action: 'skip' });

      expect(skipped.operation).toMatchObject({ status: 'completed' });
      expect(await currentBranch(repoPath)).toBe('feature/rebase-skip');
      expect(await logSubjects(repoPath, base)).toEqual(['main edit']);
      expect(await readFile(join(repoPath, 'conflict.txt'), 'utf8')).toBe('main\n');
      expect((await git(repoPath, ['status', '--porcelain'])).stdout).toBe('');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('runs an interactive rebase with reorder, reword, and drop', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      const base = (await git(repoPath, ['rev-parse', '--verify', 'HEAD'])).stdout.trim();

      await commitFile(repoPath, 'one.txt', 'one\n', 'one');
      await commitFile(repoPath, 'two.txt', 'two\n', 'two');
      await commitFile(repoPath, 'three.txt', 'three\n', 'three');

      const plan = await prepareInteractiveRebasePlan(tab, base);
      const [one, two, three] = plan.commits;

      if (!one || !two || !three) {
        throw new Error('Expected three commits in the interactive rebase plan.');
      }

      const result = await runInteractiveRebase(tab, {
        base: plan.base,
        commits: [
          {
            sha: three.sha,
            action: 'reword',
            message: 'three rewritten\n\nkept body'
          },
          {
            sha: one.sha,
            action: 'pick'
          },
          {
            sha: two.sha,
            action: 'drop'
          }
        ]
      });

      expect(result.operation).toMatchObject({ status: 'completed' });
      expect(await logSubjects(repoPath, base)).toEqual(['three rewritten', 'one']);
      expect(await readFile(join(repoPath, 'one.txt'), 'utf8')).toBe('one\n');
      expect(await readFile(join(repoPath, 'three.txt'), 'utf8')).toBe('three\n');
      await expectGitFailure(repoPath, ['ls-files', '--error-unmatch', 'two.txt']);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('runs squash and fixup through the controlled interactive rebase editor', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      const base = (await git(repoPath, ['rev-parse', '--verify', 'HEAD'])).stdout.trim();

      await commitFile(repoPath, 'one.txt', 'one\n', 'one');
      await commitFile(repoPath, 'two.txt', 'two\n', 'two');
      await commitFile(repoPath, 'three.txt', 'three\n', 'three');

      const plan = await prepareInteractiveRebasePlan(tab, base);
      const [one, two, three] = plan.commits;

      if (!one || !two || !three) {
        throw new Error('Expected three commits in the interactive rebase plan.');
      }

      const result = await runInteractiveRebase(tab, {
        base: plan.base,
        commits: [
          {
            sha: one.sha,
            action: 'pick'
          },
          {
            sha: two.sha,
            action: 'squash'
          },
          {
            sha: three.sha,
            action: 'fixup'
          }
        ]
      });

      expect(result.operation).toMatchObject({ status: 'completed' });
      expect((await git(repoPath, ['rev-list', '--count', `${base}..HEAD`])).stdout.trim()).toBe('1');
      expect(await logSubjects(repoPath, base)).toEqual(['one']);
      expect(await readFile(join(repoPath, 'one.txt'), 'utf8')).toBe('one\n');
      expect(await readFile(join(repoPath, 'two.txt'), 'utf8')).toBe('two\n');
      expect(await readFile(join(repoPath, 'three.txt'), 'utf8')).toBe('three\n');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('returns conflict state for an interactive rebase reorder and can abort it', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      const base = (await git(repoPath, ['rev-parse', '--verify', 'HEAD'])).stdout.trim();

      await writeRepoFile(repoPath, 'conflict.txt', 'A\n');
      await git(repoPath, ['commit', '-am', 'A']);
      await writeRepoFile(repoPath, 'conflict.txt', 'B\n');
      await git(repoPath, ['commit', '-am', 'B']);
      const headBefore = (await git(repoPath, ['rev-parse', '--verify', 'HEAD'])).stdout.trim();

      const plan = await prepareInteractiveRebasePlan(tab, base);
      const [aCommit, bCommit] = plan.commits;

      if (!aCommit || !bCommit) {
        throw new Error('Expected two commits in the interactive rebase plan.');
      }

      const result = await runInteractiveRebase(tab, {
        base: plan.base,
        commits: [
          {
            sha: bCommit.sha,
            action: 'pick'
          },
          {
            sha: aCommit.sha,
            action: 'pick'
          }
        ]
      });

      expect(result.operation).toMatchObject({ status: 'conflicted' });
      expect(result.conflictState).toMatchObject({
        isActive: true,
        operation: 'rebase',
        canAbort: true
      });
      expect(result.conflictState?.files.map((file) => file.path)).toContain('conflict.txt');

      await resolveConflict(tab, { action: 'abort' });

      expect((await git(repoPath, ['rev-parse', '--verify', 'HEAD'])).stdout.trim()).toBe(headBefore);
      expect((await git(repoPath, ['status', '--porcelain'])).stdout).toBe('');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('continues an interactive rebase conflict and preserves reword editor state', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      const base = (await git(repoPath, ['rev-parse', '--verify', 'HEAD'])).stdout.trim();

      await writeRepoFile(repoPath, 'conflict.txt', 'A\n');
      await git(repoPath, ['commit', '-am', 'A']);
      await writeRepoFile(repoPath, 'conflict.txt', 'B\n');
      await git(repoPath, ['commit', '-am', 'B']);

      const plan = await prepareInteractiveRebasePlan(tab, base);
      const [aCommit, bCommit] = plan.commits;

      if (!aCommit || !bCommit) {
        throw new Error('Expected two commits in the interactive rebase plan.');
      }

      const result = await runInteractiveRebase(tab, {
        base: plan.base,
        commits: [
          {
            sha: bCommit.sha,
            action: 'reword',
            message: 'B rewritten\n\ncontinued body'
          },
          {
            sha: aCommit.sha,
            action: 'drop'
          }
        ]
      });

      expect(result.operation).toMatchObject({ status: 'conflicted' });
      expect(result.conflictState).toMatchObject({
        isActive: true,
        operation: 'rebase',
        canAbort: true,
        canSkip: true
      });
      expect(result.conflictState?.files.map((file) => file.path)).toContain('conflict.txt');

      await writeRepoFile(repoPath, 'conflict.txt', 'B resolved\n');
      await git(repoPath, ['add', 'conflict.txt']);

      const continued = await resolveConflict(tab, { action: 'continue' });

      expect(continued.operation).toMatchObject({ status: 'completed' });
      expect(await logSubjects(repoPath, base)).toEqual(['B rewritten']);
      expect((await git(repoPath, ['log', '-1', '--format=%B'])).stdout.trim()).toBe('B rewritten\n\ncontinued body');
      expect(await readFile(join(repoPath, 'conflict.txt'), 'utf8')).toBe('B resolved\n');
      expect((await git(repoPath, ['status', '--porcelain'])).stdout).toBe('');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

});

async function createBaseRepository(rootPath: string): Promise<string> {
  const repoPath = join(rootPath, 'repo');
  await mkdir(repoPath);
  await git(repoPath, ['init']);
  await git(repoPath, ['config', 'user.name', 'Operations Test']);
  await git(repoPath, ['config', 'user.email', 'operations@example.test']);
  await writeRepoFile(repoPath, 'conflict.txt', 'base\n');
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

async function commitFile(repoPath: string, relativePath: string, contents: string, message: string): Promise<void> {
  await writeRepoFile(repoPath, relativePath, contents);
  await git(repoPath, ['add', relativePath]);
  await git(repoPath, ['commit', '-m', message]);
}

async function currentBranch(repoPath: string): Promise<string> {
  return (await git(repoPath, ['branch', '--show-current'])).stdout.trim();
}

async function branchUpstream(repoPath: string, branchName: string): Promise<string> {
  return (await git(repoPath, ['for-each-ref', '--format=%(upstream:short)', `refs/heads/${branchName}`])).stdout.trim();
}

async function git(cwd: string, args: string[]) {
  return gitExecutor.run(args, { cwd, kind: 'mutation' });
}

async function logSubjects(repoPath: string, base: string): Promise<string[]> {
  const result = await git(repoPath, ['log', '--reverse', '--format=%s', `${base}..HEAD`]);
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function expectGitFailure(cwd: string, args: string[]): Promise<void> {
  try {
    await git(cwd, args);
  } catch (error) {
    if (error instanceof GitCommandError) {
      return;
    }

    throw error;
  }

  throw new Error(`git ${args.join(' ')} unexpectedly succeeded`);
}
