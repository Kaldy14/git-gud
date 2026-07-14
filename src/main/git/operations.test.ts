import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { GitCommandError, gitExecutor } from './exec';
import { prepareInteractiveRebasePlan, rebaseOnto, runInteractiveRebase } from './commands/rebase';
import {
  cherryPickCommit,
  cherryPickCommits,
  checkoutRef,
  createBranch,
  createTag,
  deleteBranch,
  deleteTag,
  mergeRef,
  pullRepository,
  resetToCommit,
  resolveConflict,
  revertCommit,
  stashDrop,
  stashPop,
  stashPush,
  undoOperation
} from './operations';

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

  it('does not leave a branch behind when create-and-checkout is blocked by an untracked file', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      const base = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await git(repoPath, ['checkout', '-b', 'branch-target']);
      await writeRepoFile(repoPath, 'untracked-collision.txt', 'tracked target value\n');
      await git(repoPath, ['add', 'untracked-collision.txt']);
      await git(repoPath, ['commit', '-m', 'track checkout collision']);
      await git(repoPath, ['checkout', '--detach', base]);
      await writeRepoFile(repoPath, 'untracked-collision.txt', 'private untracked value\n');

      await expect(
        createBranch(tab, {
          name: 'should-not-exist',
          startPoint: 'branch-target',
          checkout: true
        })
      ).rejects.toThrow('would be overwritten by checkout');

      await expectGitFailure(repoPath, ['rev-parse', '--verify', 'refs/heads/should-not-exist']);
      expect((await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(base);
      expect(await readFile(join(repoPath, 'untracked-collision.txt'), 'utf8')).toBe('private untracked value\n');
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

  it('continues a resolved merge without opening an editor and preserves MERGE_MSG', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };

      await git(repoPath, ['checkout', '-b', 'feature/continue-merge']);
      await writeRepoFile(repoPath, 'conflict.txt', 'feature\n');
      await git(repoPath, ['commit', '-am', 'feature edit']);
      await git(repoPath, ['checkout', 'main']);
      await writeRepoFile(repoPath, 'conflict.txt', 'main\n');
      await git(repoPath, ['commit', '-am', 'main edit']);
      await mergeRef(tab, { ref: 'feature/continue-merge' });

      await writeRepoFile(repoPath, 'conflict.txt', 'resolved\n');
      await git(repoPath, ['add', 'conflict.txt']);
      await git(repoPath, ['config', 'core.editor', 'false']);
      await writeFile(join(repoPath, '.git', 'MERGE_MSG'), 'Resolved merge message\n\nPreserved body\n');

      const result = await resolveConflict(tab, { action: 'continue' });

      expect(result.operation).toMatchObject({ status: 'completed' });
      expect((await git(repoPath, ['log', '-1', '--format=%B'])).stdout.trim()).toBe(
        'Resolved merge message\n\nPreserved body'
      );
      expect((await git(repoPath, ['status', '--porcelain'])).stdout).toBe('');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('blocks checkout only when a target write collides with an ignored path, including newline names', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      const collisionPath = 'generated/target\nname.txt';
      await commitFile(repoPath, '.gitignore', 'generated/\nnode_modules/\n', 'ignore generated output');
      await git(repoPath, ['checkout', '-b', 'feature/ignored-checkout']);
      await writeRepoFile(repoPath, collisionPath, 'tracked target\n');
      await git(repoPath, ['add', '-f', collisionPath]);
      await git(repoPath, ['commit', '-m', 'track generated output']);
      await git(repoPath, ['checkout', 'main']);
      await writeRepoFile(repoPath, collisionPath, 'ignored local value\n');
      await writeRepoFile(repoPath, 'node_modules/unrelated/package.json', '{}\n');

      await expect(checkoutRef(tab, { kind: 'local', name: 'feature/ignored-checkout' })).rejects.toThrow(
        'would be overwritten by checkout'
      );
      expect(await currentBranch(repoPath)).toBe('main');
      expect(await readFile(join(repoPath, collisionPath), 'utf8')).toBe('ignored local value\n');

      await rm(join(repoPath, collisionPath));
      await checkoutRef(tab, { kind: 'local', name: 'feature/ignored-checkout' });

      expect(await readFile(join(repoPath, collisionPath), 'utf8')).toBe('tracked target\n');
      expect(await readFile(join(repoPath, 'node_modules/unrelated/package.json'), 'utf8')).toBe('{}\n');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('uses native checkout protection without scanning the worktree or every ignored file', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      await git(repoPath, ['checkout', '-b', 'feature/fast-checkout']);
      await commitFile(repoPath, 'feature.txt', 'feature\n', 'feature commit');
      await git(repoPath, ['checkout', 'main']);
      const runSpy = vi.spyOn(gitExecutor, 'run');

      try {
        await checkoutRef(tab, { kind: 'local', name: 'feature/fast-checkout' });

        const commands = runSpy.mock.calls.map(([args]) => args);
        expect(commands).toContainEqual(['checkout', '--no-overwrite-ignore', 'feature/fast-checkout']);
        expect(commands.some(([command]) => command === 'status' || command === 'ls-files')).toBe(false);
      } finally {
        runSpy.mockRestore();
      }
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('does not leave a branch behind when create-and-checkout collides with an ignored file', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      await commitFile(repoPath, '.gitignore', 'generated/\n', 'ignore generated output');
      await git(repoPath, ['checkout', '-b', 'branch-target']);
      await writeRepoFile(repoPath, 'generated/output.txt', 'tracked target\n');
      await git(repoPath, ['add', '-f', 'generated/output.txt']);
      await git(repoPath, ['commit', '-m', 'track generated output']);
      await git(repoPath, ['checkout', 'main']);
      await writeRepoFile(repoPath, 'generated/output.txt', 'ignored local value\n');

      await expect(
        createBranch(tab, {
          name: 'should-not-exist',
          startPoint: 'branch-target',
          checkout: true
        })
      ).rejects.toThrow('would be overwritten by checkout');

      await expectGitFailure(repoPath, ['rev-parse', '--verify', 'refs/heads/should-not-exist']);
      expect(await currentBranch(repoPath)).toBe('main');
      expect(await readFile(join(repoPath, 'generated/output.txt'), 'utf8')).toBe('ignored local value\n');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('blocks checkout when a target file would replace an ignored directory', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      await commitFile(repoPath, '.gitignore', 'generated\n', 'ignore generated output');
      await git(repoPath, ['checkout', '-b', 'feature/ignored-directory']);
      await writeRepoFile(repoPath, 'generated', 'tracked target\n');
      await git(repoPath, ['add', '-f', 'generated']);
      await git(repoPath, ['commit', '-m', 'track generated file']);
      await git(repoPath, ['checkout', 'main']);
      await writeRepoFile(repoPath, 'generated/keep.txt', 'ignored local value\n');

      await expect(checkoutRef(tab, { kind: 'local', name: 'feature/ignored-directory' })).rejects.toThrow(
        'would lose untracked files'
      );

      expect(await currentBranch(repoPath)).toBe('main');
      expect(await readFile(join(repoPath, 'generated/keep.txt'), 'utf8')).toBe('ignored local value\n');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('blocks checkout when a target directory would replace an ignored file', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      await commitFile(repoPath, '.gitignore', 'generated\n', 'ignore generated output');
      await git(repoPath, ['checkout', '-b', 'feature/ignored-file']);
      await writeRepoFile(repoPath, 'generated/output.txt', 'tracked target\n');
      await git(repoPath, ['add', '-f', 'generated/output.txt']);
      await git(repoPath, ['commit', '-m', 'track generated directory']);
      await git(repoPath, ['checkout', 'main']);
      await writeRepoFile(repoPath, 'generated', 'ignored local value\n');

      await expect(checkoutRef(tab, { kind: 'local', name: 'feature/ignored-file' })).rejects.toThrow(
        'would be overwritten by checkout'
      );

      expect(await currentBranch(repoPath)).toBe('main');
      expect(await readFile(join(repoPath, 'generated'), 'utf8')).toBe('ignored local value\n');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('blocks a hard reset when a target file would replace an ignored directory', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      await commitFile(repoPath, '.gitignore', 'generated\n', 'ignore generated output');
      const safeHead = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await writeRepoFile(repoPath, 'generated', 'tracked target\n');
      await git(repoPath, ['add', '-f', 'generated']);
      await git(repoPath, ['commit', '-m', 'track generated file']);
      const targetHead = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await git(repoPath, ['reset', '--hard', safeHead]);
      await writeRepoFile(repoPath, 'generated/keep.txt', 'ignored local value\n');

      await expect(resetToCommit(tab, { target: targetHead, mode: 'hard' })).rejects.toThrow('overwrite ignored path');

      expect((await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(safeHead);
      expect(await readFile(join(repoPath, 'generated/keep.txt'), 'utf8')).toBe('ignored local value\n');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('blocks a merge when a target directory would replace an ignored file', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      await commitFile(repoPath, '.gitignore', 'generated\n', 'ignore generated output');
      await git(repoPath, ['checkout', '-b', 'feature/ignored-merge']);
      await writeRepoFile(repoPath, 'generated/output.txt', 'tracked target\n');
      await git(repoPath, ['add', '-f', 'generated/output.txt']);
      await git(repoPath, ['commit', '-m', 'track generated directory']);
      await git(repoPath, ['checkout', 'main']);
      await writeRepoFile(repoPath, 'generated', 'ignored local value\n');

      await expect(mergeRef(tab, { ref: 'feature/ignored-merge' })).rejects.toThrow('overwrite ignored path');

      expect(await currentBranch(repoPath)).toBe('main');
      expect(await readFile(join(repoPath, 'generated'), 'utf8')).toBe('ignored local value\n');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('blocks a fast-forward pull before an ignored path can be overwritten', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const { repoPath, remoteWriterPath } = await createPullRepositoryPair(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      await writeRepoFile(remoteWriterPath, 'generated/output.txt', 'tracked upstream value\n');
      await git(remoteWriterPath, ['add', '-f', 'generated/output.txt']);
      await git(remoteWriterPath, ['commit', '-m', 'track generated output upstream']);
      await git(remoteWriterPath, ['push', 'origin', 'main']);
      const upstreamHead = (await git(remoteWriterPath, ['rev-parse', 'HEAD'])).stdout.trim();
      const localHead = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await writeRepoFile(repoPath, 'generated/output.txt', 'ignored local value\n');

      await expect(pullRepository(tab, { mode: 'ff-only' })).rejects.toThrow('overwrite ignored path');

      expect((await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(localHead);
      expect((await git(repoPath, ['rev-parse', 'refs/remotes/origin/main'])).stdout.trim()).toBe(upstreamHead);
      expect(await readFile(join(repoPath, 'generated/output.txt'), 'utf8')).toBe('ignored local value\n');
      await expectNoPullOperationState(repoPath);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('blocks a rebase pull before its upstream checkout can overwrite an ignored path', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const { repoPath, remoteWriterPath } = await createPullRepositoryPair(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      await commitFile(repoPath, 'local.txt', 'local commit\n', 'local work');
      const localHead = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await writeRepoFile(remoteWriterPath, 'generated/output.txt', 'tracked upstream value\n');
      await git(remoteWriterPath, ['add', '-f', 'generated/output.txt']);
      await git(remoteWriterPath, ['commit', '-m', 'track generated output upstream']);
      await git(remoteWriterPath, ['push', 'origin', 'main']);
      const upstreamHead = (await git(remoteWriterPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await writeRepoFile(repoPath, 'generated/output.txt', 'ignored local value\n');

      await expect(pullRepository(tab, { mode: 'rebase' })).rejects.toThrow('overwrite ignored path');

      expect((await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(localHead);
      expect((await git(repoPath, ['rev-parse', 'refs/remotes/origin/main'])).stdout.trim()).toBe(upstreamHead);
      expect(await readFile(join(repoPath, 'generated/output.txt'), 'utf8')).toBe('ignored local value\n');
      await expectNoPullOperationState(repoPath);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('fast-forwards and rebases from the configured upstream without touching unrelated ignored data', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const { repoPath, remoteWriterPath } = await createPullRepositoryPair(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      await writeRepoFile(repoPath, 'generated/unrelated.txt', 'keep me\n');
      await commitFile(remoteWriterPath, 'upstream-one.txt', 'one\n', 'upstream one');
      await git(remoteWriterPath, ['push', 'origin', 'main']);
      const firstUpstreamHead = (await git(remoteWriterPath, ['rev-parse', 'HEAD'])).stdout.trim();

      const fastForward = await pullRepository(tab, { mode: 'ff-only' });

      expect(fastForward.operation).toMatchObject({ status: 'completed' });
      expect((await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(firstUpstreamHead);
      await commitFile(repoPath, 'local.txt', 'local\n', 'local work');
      await commitFile(remoteWriterPath, 'upstream-two.txt', 'two\n', 'upstream two');
      await git(remoteWriterPath, ['push', 'origin', 'main']);
      const secondUpstreamHead = (await git(remoteWriterPath, ['rev-parse', 'HEAD'])).stdout.trim();

      const rebased = await pullRepository(tab, { mode: 'rebase' });

      expect(rebased.operation).toMatchObject({ status: 'completed' });
      expect((await git(repoPath, ['merge-base', '--is-ancestor', secondUpstreamHead, 'HEAD'])).exitCode).toBe(0);
      expect((await git(repoPath, ['log', '-1', '--format=%s'])).stdout.trim()).toBe('local work');
      expect(await readFile(join(repoPath, 'generated/unrelated.txt'), 'utf8')).toBe('keep me\n');
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

      const result = await deleteBranch(tab, { localName: 'feature/tracked', force: true });

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

  it('deletes a remote branch without deleting its local branch', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const remotePath = join(rootPath, 'origin.git');
      await git(rootPath, ['init', '--bare', remotePath]);
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };

      await git(repoPath, ['remote', 'add', 'origin', remotePath]);
      await git(repoPath, ['checkout', '-b', 'feature/remote-only']);
      await git(repoPath, ['push', '-u', 'origin', 'feature/remote-only']);
      await git(repoPath, ['checkout', 'main']);

      const result = await deleteBranch(tab, {
        remote: { name: 'origin', branch: 'feature/remote-only' },
        force: false
      });

      expect((await git(repoPath, ['rev-parse', 'refs/heads/feature/remote-only'])).stdout.trim()).not.toBe('');
      await expectGitFailure(remotePath, ['rev-parse', '--verify', 'refs/heads/feature/remote-only']);
      expect(result.undoEntry).toBeUndefined();
      expect(result.operation?.label).toBe('Delete branch origin/feature/remote-only');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('deletes local and remote branches while keeping local undo available', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const remotePath = join(rootPath, 'origin.git');
      await git(rootPath, ['init', '--bare', remotePath]);
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };

      await git(repoPath, ['remote', 'add', 'origin', remotePath]);
      await git(repoPath, ['checkout', '-b', 'feature/delete-both']);
      await git(repoPath, ['push', '-u', 'origin', 'feature/delete-both']);
      await git(repoPath, ['checkout', 'main']);

      const result = await deleteBranch(tab, {
        localName: 'feature/delete-both',
        remote: { name: 'origin', branch: 'feature/delete-both' },
        force: false
      });

      await expectGitFailure(repoPath, ['rev-parse', '--verify', 'refs/heads/feature/delete-both']);
      await expectGitFailure(remotePath, ['rev-parse', '--verify', 'refs/heads/feature/delete-both']);
      expect(result.undoEntry).toMatchObject({
        operation: 'branch-delete',
        refName: 'feature/delete-both'
      });
      expect(result.undoEntry?.upstream).toBeUndefined();

      if (!result.undoEntry) {
        throw new Error('Expected combined branch delete to record local undo metadata.');
      }

      await undoOperation(tab, result.undoEntry.id);

      expect((await git(repoPath, ['rev-parse', 'refs/heads/feature/delete-both'])).stdout.trim()).not.toBe('');
      await expectGitFailure(repoPath, ['rev-parse', '--verify', 'feature/delete-both@{upstream}']);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('restores a local branch when its paired remote deletion fails', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };

      await git(repoPath, ['branch', 'feature/keep-local']);

      await expect(
        deleteBranch(tab, {
          localName: 'feature/keep-local',
          remote: { name: 'missing', branch: 'feature/keep-local' },
          force: false
        })
      ).rejects.toThrow();

      expect((await git(repoPath, ['rev-parse', 'refs/heads/feature/keep-local'])).stdout.trim()).not.toBe('');
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
      const stashSha = (await git(repoPath, ['rev-parse', 'stash@{0}'])).stdout.trim();

      expect((await git(repoPath, ['status', '--porcelain'])).stdout).toBe('');
      expect((await git(repoPath, ['stash', 'list', '--format=%gd:%s'])).stdout.trim()).toContain('test stash');

      await stashPop(tab, { selector: 'stash@{0}', expectedSha: stashSha });

      expect(await readFile(join(repoPath, 'notes/stashed.txt'), 'utf8')).toBe('stashed\n');
      expect((await git(repoPath, ['status', '--porcelain'])).stdout).toBe('?? notes/\n');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('blocks stash pop when it would overwrite a path that became ignored', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      await writeRepoFile(repoPath, 'generated/stashed.txt', 'stashed value\n');
      await stashPush(tab, { message: 'generated output', includeUntracked: true });
      const stashSha = (await git(repoPath, ['rev-parse', 'stash@{0}'])).stdout.trim();
      await commitFile(repoPath, '.gitignore', 'generated/\n', 'ignore generated output');
      await writeRepoFile(repoPath, 'generated/stashed.txt', 'ignored local value\n');

      await expect(stashPop(tab, { selector: 'stash@{0}', expectedSha: stashSha })).rejects.toThrow(
        'overwrite ignored path'
      );

      expect(await readFile(join(repoPath, 'generated/stashed.txt'), 'utf8')).toBe('ignored local value\n');
      expect((await git(repoPath, ['stash', 'list', '--format=%gd'])).stdout.trim()).toBe('stash@{0}');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('rejects a stash action when its selector shifted to a different stash', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      await writeRepoFile(repoPath, 'first-stash.txt', 'first\n');
      await stashPush(tab, { message: 'first stash', includeUntracked: true });
      const firstSha = (await git(repoPath, ['rev-parse', 'stash@{0}'])).stdout.trim();
      await writeRepoFile(repoPath, 'second-stash.txt', 'second\n');
      await stashPush(tab, { message: 'second stash', includeUntracked: true });
      const secondSha = (await git(repoPath, ['rev-parse', 'stash@{0}'])).stdout.trim();

      await expect(
        stashDrop(tab, { selector: 'stash@{0}', expectedSha: firstSha })
      ).rejects.toThrow('stash@{0} changed since it was loaded');

      expect((await git(repoPath, ['stash', 'list', '--format=%H'])).stdout.trim().split('\n')).toEqual([
        secondSha,
        firstSha
      ]);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('blocks cherry-pick when an added path collides with ignored local data', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      await commitFile(repoPath, '.gitignore', 'generated/\n', 'ignore generated output');
      await git(repoPath, ['checkout', '-b', 'feature/cherry-pick-collision']);
      await writeRepoFile(repoPath, 'generated/output.txt', 'tracked target\n');
      await git(repoPath, ['add', '-f', 'generated/output.txt']);
      await git(repoPath, ['commit', '-m', 'add generated output']);
      const targetCommit = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await git(repoPath, ['checkout', 'main']);
      await writeRepoFile(repoPath, 'generated/output.txt', 'ignored local value\n');

      await expect(cherryPickCommit(tab, targetCommit)).rejects.toThrow('overwrite ignored path');

      expect(await readFile(join(repoPath, 'generated/output.txt'), 'utf8')).toBe('ignored local value\n');
      expect((await git(repoPath, ['log', '-1', '--format=%s'])).stdout.trim()).toBe('ignore generated output');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('cherry-picks multiple commits in one ordered operation with one undo entry', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      const base = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await git(repoPath, ['checkout', '-b', 'feature/bulk-pick']);
      await commitFile(repoPath, 'first.txt', 'first\n', 'first selected commit');
      const firstSha = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await commitFile(repoPath, 'second.txt', 'second\n', 'second selected commit');
      const secondSha = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await git(repoPath, ['checkout', 'main']);

      const result = await cherryPickCommits(tab, [firstSha, secondSha]);

      expect(await logSubjects(repoPath, base)).toEqual(['first selected commit', 'second selected commit']);
      expect(result.operation).toMatchObject({ label: 'Cherry-pick 2 commits', status: 'completed' });
      expect(result.undoEntry).toMatchObject({
        operation: 'commit',
        label: 'Undo cherry-pick 2 commits',
        headBefore: base
      });

      if (!result.undoEntry) {
        throw new Error('Expected bulk cherry-pick to record one undo entry.');
      }

      await undoOperation(tab, result.undoEntry.id);
      expect((await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(base);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('rejects empty or duplicate bulk cherry-pick selections', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      const head = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();

      await expect(cherryPickCommits(tab, [])).rejects.toThrow('Select at least one commit');
      await expect(cherryPickCommits(tab, [head, head])).rejects.toThrow('only be cherry-picked once');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('blocks revert when restoring a deleted path would collide with ignored local data', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      await commitFile(repoPath, '.gitignore', 'generated/\n', 'ignore generated output');
      await writeRepoFile(repoPath, 'generated/output.txt', 'tracked before delete\n');
      await git(repoPath, ['add', '-f', 'generated/output.txt']);
      await git(repoPath, ['commit', '-m', 'track generated output']);
      await git(repoPath, ['rm', 'generated/output.txt']);
      await git(repoPath, ['commit', '-m', 'delete generated output']);
      const deleteCommit = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await writeRepoFile(repoPath, 'generated/output.txt', 'ignored local value\n');

      await expect(revertCommit(tab, deleteCommit)).rejects.toThrow('overwrite ignored path');

      expect(await readFile(join(repoPath, 'generated/output.txt'), 'utf8')).toBe('ignored local value\n');
      expect((await git(repoPath, ['log', '-1', '--format=%s'])).stdout.trim()).toBe('delete generated output');
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

  it('aborts an interactive rebase when its persisted editor temp directory is missing', async () => {
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
          { sha: bCommit.sha, action: 'pick' },
          { sha: aCommit.sha, action: 'pick' }
        ]
      });

      expect(result.operation).toMatchObject({ status: 'conflicted' });
      const statePath = join(repoPath, '.git', 'git-gud-rebase-state.json');
      const persistedState = JSON.parse(await readFile(statePath, 'utf8')) as { tempDir?: unknown };

      if (typeof persistedState.tempDir !== 'string') {
        throw new Error('Expected persisted interactive rebase editor state.');
      }

      await rm(persistedState.tempDir, { recursive: true, force: true });

      const aborted = await resolveConflict(tab, { action: 'abort' });

      expect(aborted.operation).toMatchObject({ status: 'completed' });
      expect((await git(repoPath, ['rev-parse', '--verify', 'HEAD'])).stdout.trim()).toBe(headBefore);
      expect((await git(repoPath, ['status', '--porcelain'])).stdout).toBe('');
      await expect(readFile(statePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('blocks continue or skip when a new ignored path collides with a remaining rebase commit', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      await commitFile(repoPath, '.gitignore', 'later.txt\n', 'ignore later path');
      const base = (await git(repoPath, ['rev-parse', '--verify', 'HEAD'])).stdout.trim();

      await writeRepoFile(repoPath, 'conflict.txt', 'A\n');
      await git(repoPath, ['commit', '-am', 'A']);
      await writeRepoFile(repoPath, 'conflict.txt', 'C\n');
      await git(repoPath, ['commit', '-am', 'C']);
      await writeRepoFile(repoPath, 'later.txt', 'committed later value\n');
      await git(repoPath, ['add', '--force', 'later.txt']);
      await git(repoPath, ['commit', '-m', 'add later path']);
      const plan = await prepareInteractiveRebasePlan(tab, base);
      const [aCommit, cCommit, laterCommit] = plan.commits;

      if (!aCommit || !cCommit || !laterCommit) {
        throw new Error('Expected three commits in the interactive rebase plan.');
      }

      const result = await runInteractiveRebase(tab, {
        base: plan.base,
        commits: [
          { sha: cCommit.sha, action: 'pick' },
          { sha: aCommit.sha, action: 'pick' },
          { sha: laterCommit.sha, action: 'pick' }
        ]
      });

      expect(result.operation).toMatchObject({ status: 'conflicted' });
      await writeRepoFile(repoPath, 'later.txt', 'private ignored value\n');

      await expect(resolveConflict(tab, { action: 'skip' })).rejects.toThrow(
        'replayed commits would overwrite ignored path "later.txt"'
      );
      await expect(readFile(join(repoPath, 'later.txt'), 'utf8')).resolves.toBe('private ignored value\n');
      await expect(readFile(join(repoPath, '.git', 'rebase-merge', 'git-rebase-todo'), 'utf8')).resolves.toContain(
        laterCommit.sha
      );

      await rm(join(repoPath, 'later.txt'));
      await resolveConflict(tab, { action: 'abort' });
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

  it('rejects option-like and invalid tag names without changing refs', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };

      await expect(createTag(tab, { name: '--list' })).rejects.toThrow('cannot start with a dash');
      await expect(createTag(tab, { name: 'invalid..tag' })).rejects.toBeInstanceOf(GitCommandError);
      expect((await git(repoPath, ['tag', '--list'])).stdout).toBe('');

      const created = await createTag(tab, { name: 'safe/v1' });
      expect((await git(repoPath, ['rev-parse', '--verify', 'refs/tags/safe/v1'])).stdout.trim()).toBe(
        (await git(repoPath, ['rev-parse', '--verify', 'HEAD'])).stdout.trim()
      );
      expect(created.undoEntry?.affectedRefs).toEqual(['refs/tags/safe/v1']);

      await deleteTag(tab, { name: 'safe/v1' });
      await expectGitFailure(repoPath, ['rev-parse', '--verify', 'refs/tags/safe/v1']);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('refuses a hard reset while tracked or untracked work would be lost', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      const initialHead = (await git(repoPath, ['rev-parse', '--verify', 'HEAD'])).stdout.trim();
      await commitFile(repoPath, 'second.txt', 'second\n', 'second');
      const currentHead = (await git(repoPath, ['rev-parse', '--verify', 'HEAD'])).stdout.trim();
      await writeRepoFile(repoPath, 'conflict.txt', 'local work\n');

      await expect(resetToCommit(tab, { target: initialHead, mode: 'hard' })).rejects.toThrow(
        'Hard reset is blocked'
      );

      expect((await git(repoPath, ['rev-parse', '--verify', 'HEAD'])).stdout.trim()).toBe(currentHead);
      expect(await readFile(join(repoPath, 'conflict.txt'), 'utf8')).toBe('local work\n');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('refuses to undo a hard reset after the index or working tree changes', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      const initialHead = (await git(repoPath, ['rev-parse', '--verify', 'HEAD'])).stdout.trim();
      await commitFile(repoPath, 'second.txt', 'second\n', 'second');

      const result = await resetToCommit(tab, { target: initialHead, mode: 'hard' });

      if (!result.undoEntry) {
        throw new Error('Expected hard reset to record undo metadata.');
      }

      await writeRepoFile(repoPath, 'conflict.txt', 'changed after reset\n');

      await expect(undoOperation(tab, result.undoEntry.id)).rejects.toThrow('index or working tree changed');
      expect(await readFile(join(repoPath, 'conflict.txt'), 'utf8')).toBe('changed after reset\n');
      expect((await git(repoPath, ['rev-parse', '--verify', 'HEAD'])).stdout.trim()).toBe(initialHead);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('blocks undoing a hard reset when the restored tree would overwrite an ignored path', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      await commitFile(repoPath, '.gitignore', 'generated/\n', 'ignore generated output');
      const headWithoutGenerated = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await writeRepoFile(repoPath, 'generated/output.txt', 'tracked before reset\n');
      await git(repoPath, ['add', '-f', 'generated/output.txt']);
      await git(repoPath, ['commit', '-m', 'track generated output']);

      const result = await resetToCommit(tab, { target: headWithoutGenerated, mode: 'hard' });

      if (!result.undoEntry) {
        throw new Error('Expected hard reset to record undo metadata.');
      }

      await writeRepoFile(repoPath, 'generated/output.txt', 'ignored after reset\n');
      expect((await git(repoPath, ['status', '--porcelain'])).stdout).toBe('');

      await expect(undoOperation(tab, result.undoEntry.id)).rejects.toThrow('overwrite ignored path');

      expect((await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(headWithoutGenerated);
      expect(await readFile(join(repoPath, 'generated/output.txt'), 'utf8')).toBe('ignored after reset\n');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('blocks undoing a merge when the restored tree would overwrite an ignored path', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      await commitFile(repoPath, '.gitignore', 'generated/\n', 'ignore generated output');
      await writeRepoFile(repoPath, 'generated/output.txt', 'tracked before merge\n');
      await git(repoPath, ['add', '-f', 'generated/output.txt']);
      await git(repoPath, ['commit', '-m', 'track generated output']);
      await git(repoPath, ['checkout', '-b', 'feature/delete-generated']);
      await git(repoPath, ['rm', 'generated/output.txt']);
      await git(repoPath, ['commit', '-m', 'delete generated output']);
      await git(repoPath, ['checkout', 'main']);
      await commitFile(repoPath, 'main.txt', 'main\n', 'diverge main');

      const result = await mergeRef(tab, { ref: 'feature/delete-generated' });

      if (!result.undoEntry) {
        throw new Error('Expected merge to record undo metadata.');
      }

      const mergedHead = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await writeRepoFile(repoPath, 'generated/output.txt', 'ignored after merge\n');

      await expect(undoOperation(tab, result.undoEntry.id)).rejects.toThrow('overwrite ignored path');

      expect((await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(mergedHead);
      expect(await readFile(join(repoPath, 'generated/output.txt'), 'utf8')).toBe('ignored after merge\n');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('undoes checkout to the recorded commit when the previous branch moved', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      const originalMain = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await git(repoPath, ['checkout', '-b', 'feature/checkout-target']);
      await commitFile(repoPath, 'feature.txt', 'feature\n', 'feature target');
      await git(repoPath, ['checkout', 'main']);
      await git(repoPath, ['checkout', '-b', 'alternate-main']);
      await commitFile(repoPath, 'alternate.txt', 'alternate\n', 'alternate main');
      await git(repoPath, ['checkout', 'main']);

      const result = await checkoutRef(tab, { kind: 'local', name: 'feature/checkout-target' });

      expect(result.operation?.status).toBe('completed');
      expect(result.conflictState).toBeUndefined();

      if (!result.undoEntry) {
        throw new Error('Expected checkout to record undo metadata.');
      }

      await git(repoPath, ['branch', '-f', 'main', 'alternate-main']);
      await undoOperation(tab, result.undoEntry.id);

      expect((await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(originalMain);
      expect(await currentBranch(repoPath)).toBe('');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('marks merge undo stale after the merge is published upstream', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const remotePath = join(rootPath, 'origin.git');
      await git(rootPath, ['init', '--bare', remotePath]);
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      await git(repoPath, ['remote', 'add', 'origin', remotePath]);
      await git(repoPath, ['push', '-u', 'origin', 'main']);
      await git(repoPath, ['checkout', '-b', 'feature/published']);
      await commitFile(repoPath, 'feature.txt', 'feature\n', 'feature');
      await git(repoPath, ['checkout', 'main']);
      await commitFile(repoPath, 'main.txt', 'main\n', 'main');

      const result = await mergeRef(tab, { ref: 'feature/published' });

      if (!result.undoEntry) {
        throw new Error('Expected merge to record undo metadata.');
      }

      const mergedHead = (await git(repoPath, ['rev-parse', '--verify', 'HEAD'])).stdout.trim();
      await git(repoPath, ['push', 'origin', 'main']);

      await expect(undoOperation(tab, result.undoEntry.id)).rejects.toThrow('published to a remote-tracking branch');
      expect((await git(repoPath, ['rev-parse', '--verify', 'HEAD'])).stdout.trim()).toBe(mergedHead);
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('marks merge undo stale after publishing to a non-upstream remote branch', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-operations-'));

    try {
      const remotePath = join(rootPath, 'origin.git');
      await git(rootPath, ['init', '--bare', remotePath]);
      const repoPath = await createBaseRepository(rootPath);
      const tab = { path: repoPath, assignedProfileId: undefined };
      await git(repoPath, ['remote', 'add', 'origin', remotePath]);
      await git(repoPath, ['checkout', '-b', 'feature/publish-elsewhere']);
      await commitFile(repoPath, 'feature.txt', 'feature\n', 'feature');
      await git(repoPath, ['checkout', 'main']);
      await commitFile(repoPath, 'main.txt', 'main\n', 'main');

      const result = await mergeRef(tab, { ref: 'feature/publish-elsewhere' });

      if (!result.undoEntry) {
        throw new Error('Expected merge to record undo metadata.');
      }

      const mergedHead = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await git(repoPath, ['push', 'origin', 'HEAD:refs/heads/review/merged']);
      await expectGitFailure(repoPath, ['rev-parse', '--verify', '@{upstream}']);
      expect((await git(repoPath, ['rev-parse', 'refs/remotes/origin/review/merged'])).stdout.trim()).toBe(mergedHead);

      await expect(undoOperation(tab, result.undoEntry.id)).rejects.toThrow('published to a remote-tracking branch');
      expect((await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(mergedHead);
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

async function createPullRepositoryPair(
  rootPath: string
): Promise<{ repoPath: string; remoteWriterPath: string }> {
  const seedPath = await createBaseRepository(rootPath);
  const remotePath = join(rootPath, 'origin.git');
  const repoPath = join(rootPath, 'local');
  const remoteWriterPath = join(rootPath, 'remote-writer');
  await commitFile(seedPath, '.gitignore', 'generated/\n', 'ignore generated output');
  await git(rootPath, ['init', '--bare', remotePath]);
  await git(seedPath, ['remote', 'add', 'origin', remotePath]);
  await git(seedPath, ['push', '-u', 'origin', 'main']);
  await git(remotePath, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  await git(rootPath, ['clone', remotePath, repoPath]);
  await git(rootPath, ['clone', remotePath, remoteWriterPath]);

  for (const clonePath of [repoPath, remoteWriterPath]) {
    await git(clonePath, ['config', 'user.name', 'Operations Test']);
    await git(clonePath, ['config', 'user.email', 'operations@example.test']);
  }

  return { repoPath, remoteWriterPath };
}

async function expectNoPullOperationState(repoPath: string): Promise<void> {
  for (const relativePath of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply']) {
    await expect(access(join(repoPath, '.git', relativePath))).rejects.toMatchObject({ code: 'ENOENT' });
  }
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
