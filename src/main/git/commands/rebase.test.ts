import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { gitExecutor } from '../exec';
import {
  clearRebaseEditorState,
  createRebaseContinuationEnv,
  prepareInteractiveRebasePlan,
  rebaseOnto,
  runInteractiveRebase
} from './rebase';

const rebaseStatePathName = 'git-gud-rebase-state.json';

describe('prepareInteractiveRebasePlan', () => {
  it('rejects ranges containing merge commits instead of flattening their topology', async () => {
    const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-rebase-'));

    try {
      const repoPath = join(rootPath, 'repo');
      await mkdir(repoPath);
      await git(repoPath, ['init']);
      await git(repoPath, ['config', 'user.name', 'Rebase Test']);
      await git(repoPath, ['config', 'user.email', 'rebase@example.test']);
      await commitFile(repoPath, 'base.txt', 'base\n', 'base');
      await git(repoPath, ['branch', '-M', 'main']);
      const base = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();

      await git(repoPath, ['checkout', '-b', 'feature']);
      await commitFile(repoPath, 'feature.txt', 'feature\n', 'feature');
      await git(repoPath, ['checkout', 'main']);
      await commitFile(repoPath, 'main.txt', 'main\n', 'main');
      await git(repoPath, ['merge', '--no-ff', 'feature', '-m', 'merge feature']);

      await expect(prepareInteractiveRebasePlan({ path: repoPath }, base)).rejects.toThrow(
        'Interactive rebase does not support ranges containing merge commits.'
      );
      expect((await git(repoPath, ['rev-list', '--min-parents=2', `${base}..HEAD`])).stdout.trim()).not.toBe('');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});

describe('rebase ignored-untracked collision preflight', () => {
  it('blocks a standard rebase when only the target tree would overwrite an ignored path', async () => {
    const { repoPath, rootPath } = await createRepository();

    try {
      await commitFile(repoPath, '.gitignore', 'target-only.txt\n', 'ignore target path');
      await git(repoPath, ['checkout', '-b', 'feature/target-tree-collision']);
      await commitFile(repoPath, 'replay-only.txt', 'replay\n', 'unrelated replay');
      const featureHead = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();

      await git(repoPath, ['checkout', 'main']);
      await writeFile(join(repoPath, 'target-only.txt'), 'target value\n');
      await git(repoPath, ['add', '--force', 'target-only.txt']);
      await git(repoPath, ['commit', '-m', 'add target-only path']);
      await git(repoPath, ['checkout', 'feature/target-tree-collision']);
      await writeFile(join(repoPath, 'target-only.txt'), 'private ignored value\n');

      await expect(rebaseOnto({ path: repoPath }, { target: 'main' })).rejects.toThrow(
        'the target tree would overwrite ignored path "target-only.txt"'
      );
      expect((await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(featureHead);
      await expect(readFile(join(repoPath, 'target-only.txt'), 'utf8')).resolves.toBe('private ignored value\n');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('blocks an interactive rebase when only resetting to its base would overwrite an ignored path', async () => {
    const { repoPath, rootPath } = await createRepository();

    try {
      await writeFile(join(repoPath, '.gitignore'), 'base-only.txt\n');
      await writeFile(join(repoPath, 'base-only.txt'), 'base value\n');
      await git(repoPath, ['add', '.gitignore']);
      await git(repoPath, ['add', '--force', 'base-only.txt']);
      await git(repoPath, ['commit', '-m', 'base tracks ignored path']);
      const base = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await git(repoPath, ['rm', 'base-only.txt']);
      await git(repoPath, ['commit', '-m', 'delete base-only path']);
      await commitFile(repoPath, 'replay-only.txt', 'replay\n', 'unrelated replay');
      const head = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      const plan = await prepareInteractiveRebasePlan({ path: repoPath }, base);
      await writeFile(join(repoPath, 'base-only.txt'), 'private ignored value\n');

      await expect(
        runInteractiveRebase(
          { path: repoPath },
          {
            base,
            commits: plan.commits.map((commit) => ({ sha: commit.sha, action: 'pick' }))
          }
        )
      ).rejects.toThrow('the rebase base tree would overwrite ignored path "base-only.txt"');
      expect((await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(head);
      await expect(readFile(join(repoPath, 'base-only.txt'), 'utf8')).resolves.toBe('private ignored value\n');
      await expect(readFile(rebaseStatePath(repoPath), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('blocks a standard rebase before a replay can overwrite an ignored untracked file', async () => {
    const { repoPath, rootPath } = await createRepository();

    try {
      await commitFile(repoPath, '.gitignore', 'collision.txt\n', 'ignore collision');
      await git(repoPath, ['checkout', '-b', 'feature']);
      await writeFile(join(repoPath, 'collision.txt'), 'committed value\n');
      await git(repoPath, ['add', '--force', 'collision.txt']);
      await git(repoPath, ['commit', '-m', 'temporarily add collision']);
      await git(repoPath, ['rm', 'collision.txt']);
      await git(repoPath, ['commit', '-m', 'remove collision']);
      const featureHead = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();

      await git(repoPath, ['checkout', 'main']);
      await commitFile(repoPath, 'target.txt', 'target\n', 'advance target');
      await git(repoPath, ['checkout', 'feature']);
      await writeFile(join(repoPath, 'collision.txt'), 'local ignored value\n');

      await expect(rebaseOnto({ path: repoPath }, { target: 'main' })).rejects.toThrow(
        'replayed commits would overwrite ignored path "collision.txt"'
      );
      expect((await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(featureHead);
      await expect(readFile(join(repoPath, 'collision.txt'), 'utf8')).resolves.toBe('local ignored value\n');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('blocks an interactive rebase before creating editor state', async () => {
    const { repoPath, rootPath } = await createRepository();

    try {
      await commitFile(repoPath, '.gitignore', 'collision.txt\n', 'ignore collision');
      const base = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await writeFile(join(repoPath, 'collision.txt'), 'committed value\n');
      await git(repoPath, ['add', '--force', 'collision.txt']);
      await git(repoPath, ['commit', '-m', 'temporarily add collision']);
      await git(repoPath, ['rm', 'collision.txt']);
      await git(repoPath, ['commit', '-m', 'remove collision']);
      const head = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      const plan = await prepareInteractiveRebasePlan({ path: repoPath }, base);
      await writeFile(join(repoPath, 'collision.txt'), 'local ignored value\n');

      await expect(
        runInteractiveRebase(
          { path: repoPath },
          {
            base,
            commits: plan.commits.map((commit) => ({ sha: commit.sha, action: 'pick' }))
          }
        )
      ).rejects.toThrow('replayed commits would overwrite ignored path "collision.txt"');
      expect((await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(head);
      await expect(readFile(join(repoPath, 'collision.txt'), 'utf8')).resolves.toBe('local ignored value\n');
      await expect(readFile(rebaseStatePath(repoPath), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('does not flag a tracked replay path merely because it matches an ignore rule', async () => {
    const { repoPath, rootPath } = await createRepository();

    try {
      await commitFile(repoPath, '.gitignore', 'tracked.txt\n', 'ignore tracked name');
      await git(repoPath, ['checkout', '-b', 'feature']);
      await writeFile(join(repoPath, 'tracked.txt'), 'tracked value\n');
      await git(repoPath, ['add', '--force', 'tracked.txt']);
      await git(repoPath, ['commit', '-m', 'add tracked ignored path']);
      await git(repoPath, ['checkout', 'main']);
      await commitFile(repoPath, 'target.txt', 'target\n', 'advance target');
      await git(repoPath, ['checkout', 'feature']);

      const result = await rebaseOnto({ path: repoPath }, { target: 'main' });

      expect(result.operation?.status).toBe('completed');
      await expect(readFile(join(repoPath, 'tracked.txt'), 'utf8')).resolves.toBe('tracked value\n');
      expect((await git(repoPath, ['ls-files', 'tracked.txt'])).stdout.trim()).toBe('tracked.txt');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});

describe('interactive rebase editor state', () => {
  it('rejects arbitrary absolute temp directories without deleting them', async () => {
    const { repoPath, rootPath } = await createRepository();
    const victimPath = join(rootPath, 'victim');
    const sentinelPath = join(victimPath, 'keep.txt');
    await mkdir(victimPath);
    await writeFile(sentinelPath, 'keep me');
    await writeRebaseState(repoPath, victimPath, randomUUID());

    try {
      await expect(createRebaseContinuationEnv(repoPath, undefined)).rejects.toThrow('state is untrusted');
      await expect(clearRebaseEditorState(repoPath, undefined)).rejects.toThrow('state is untrusted');
      await expect(readFile(sentinelPath, 'utf8')).resolves.toBe('keep me');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('rejects temp paths containing parent traversal', async () => {
    const { repoPath, rootPath } = await createRepository();
    const fakeTempDir = join(tmpdir(), `git-gud-rebase-${randomUUID()}`);
    const traversingPath = `${fakeTempDir}${sep}..${sep}${basename(rootPath)}`;
    await writeRebaseState(repoPath, traversingPath, randomUUID());

    try {
      await expect(createRebaseContinuationEnv(repoPath, undefined)).rejects.toThrow('state is untrusted');
      await expect(clearRebaseEditorState(repoPath, undefined)).rejects.toThrow('state is untrusted');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('rejects a symlink even when its name matches the app temp directory scheme', async () => {
    const { repoPath, rootPath } = await createRepository();
    const victimPath = join(rootPath, 'victim');
    const sentinelPath = join(victimPath, 'keep.txt');
    const symlinkPath = join(tmpdir(), `git-gud-rebase-${randomUUID()}`);
    await mkdir(victimPath);
    await writeFile(sentinelPath, 'keep me');
    await symlink(victimPath, symlinkPath, 'dir');
    await writeRebaseState(repoPath, symlinkPath, randomUUID());

    try {
      await expect(createRebaseContinuationEnv(repoPath, undefined)).rejects.toThrow('state is untrusted');
      await expect(clearRebaseEditorState(repoPath, undefined)).rejects.toThrow('state is untrusted');
      await expect(readFile(sentinelPath, 'utf8')).resolves.toBe('keep me');
    } finally {
      await rm(symlinkPath, { force: true });
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('continues with and cleans up valid app-created editor state', async () => {
    const { repoPath, rootPath } = await createRepository();
    let editorTempDir: string | undefined;

    try {
      const base = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await commitFile(repoPath, 'conflict.txt', 'one\n', 'first change');
      await commitFile(repoPath, 'conflict.txt', 'two\n', 'second change');
      const plan = await prepareInteractiveRebasePlan({ path: repoPath }, base);
      const result = await runInteractiveRebase(
        { path: repoPath },
        {
          base,
          commits: [...plan.commits].reverse().map((commit) => ({ sha: commit.sha, action: 'pick' }))
        }
      );

      expect(result.operation?.status).toBe('conflicted');
      editorTempDir = await readEditorTempDir(repoPath);

      const continuationEnv = await createRebaseContinuationEnv(repoPath, undefined);
      expect(continuationEnv?.GIT_EDITOR).toContain(join(editorTempDir, 'message-editor.cjs'));

      const messageEditorPath = join(editorTempDir, 'message-editor.cjs');
      const trustedMessageEditor = await readFile(messageEditorPath, 'utf8');
      await writeFile(messageEditorPath, "require('node:child_process').execSync('false');\n");
      await expect(createRebaseContinuationEnv(repoPath, undefined)).rejects.toThrow('state is untrusted');
      await writeFile(messageEditorPath, trustedMessageEditor, { mode: 0o700 });

      await clearRebaseEditorState(repoPath, undefined);
      await expect(readFile(rebaseStatePath(repoPath), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(editorTempDir, '.git-gud-rebase-editor'), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT'
      });
    } finally {
      if (editorTempDir) {
        await rm(editorTempDir, { recursive: true, force: true });
      }

      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('selects a later reword message by commit after skipping an earlier conflicted reword', async () => {
    const { repoPath, rootPath } = await createRepository();
    let editorTempDir: string | undefined;

    try {
      const base = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await commitFile(repoPath, 'conflict.txt', 'one\n', 'first change');
      await commitFile(repoPath, 'conflict.txt', 'two\n', 'second change');
      const plan = await prepareInteractiveRebasePlan({ path: repoPath }, base);
      const [firstCommit, secondCommit] = plan.commits;

      if (!firstCommit || !secondCommit) {
        throw new Error('Expected two commits in the rebase fixture.');
      }

      const result = await runInteractiveRebase(
        { path: repoPath },
        {
          base,
          commits: [
            { sha: secondCommit.sha, action: 'reword', message: 'message for skipped commit' },
            { sha: firstCommit.sha, action: 'reword', message: 'message for surviving commit' }
          ]
        }
      );

      expect(result.operation?.status).toBe('conflicted');
      editorTempDir = await readEditorTempDir(repoPath);
      const continuationEnv = await createRebaseContinuationEnv(repoPath, undefined);
      await gitExecutor.run(['rebase', '--skip'], {
        cwd: repoPath,
        kind: 'mutation',
        env: continuationEnv
      });

      expect((await git(repoPath, ['log', '-1', '--format=%B'])).stdout.trim()).toBe('message for surviving commit');
      await clearRebaseEditorState(repoPath, undefined);
    } finally {
      if (editorTempDir) {
        await rm(editorTempDir, { recursive: true, force: true });
      }

      await rm(rootPath, { recursive: true, force: true });
    }
  });

  it('applies the correct reword message after a squash editor pass', async () => {
    const { repoPath, rootPath } = await createRepository();

    try {
      const base = (await git(repoPath, ['rev-parse', 'HEAD'])).stdout.trim();
      await commitFile(repoPath, 'one.txt', 'one\n', 'first change');
      await commitFile(repoPath, 'two.txt', 'two\n', 'second change');
      await commitFile(repoPath, 'three.txt', 'three\n', 'third change');
      const plan = await prepareInteractiveRebasePlan({ path: repoPath }, base);
      const [firstCommit, secondCommit, thirdCommit] = plan.commits;

      if (!firstCommit || !secondCommit || !thirdCommit) {
        throw new Error('Expected three commits in the rebase fixture.');
      }

      const result = await runInteractiveRebase(
        { path: repoPath },
        {
          base,
          commits: [
            { sha: firstCommit.sha, action: 'pick' },
            { sha: secondCommit.sha, action: 'squash' },
            { sha: thirdCommit.sha, action: 'reword', message: 'reword after squash' }
          ]
        }
      );

      expect(result.operation?.status).toBe('completed');
      expect((await git(repoPath, ['log', '-1', '--format=%B'])).stdout.trim()).toBe('reword after squash');
      expect((await git(repoPath, ['rev-list', '--count', `${base}..HEAD`])).stdout.trim()).toBe('2');
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });
});

async function createRepository(): Promise<{ repoPath: string; rootPath: string }> {
  const rootPath = await mkdtemp(join(tmpdir(), 'git-gud-rebase-state-test-'));
  const repoPath = join(rootPath, 'repo');
  await mkdir(repoPath);
  await git(repoPath, ['init']);
  await git(repoPath, ['config', 'user.name', 'Rebase Test']);
  await git(repoPath, ['config', 'user.email', 'rebase@example.test']);
  await commitFile(repoPath, 'base.txt', 'base\n', 'base');
  await git(repoPath, ['branch', '-M', 'main']);
  return { repoPath, rootPath };
}

async function writeRebaseState(repoPath: string, tempDir: string, nonce: string): Promise<void> {
  await writeFile(rebaseStatePath(repoPath), JSON.stringify({ tempDir, nonce }));
}

async function readEditorTempDir(repoPath: string): Promise<string> {
  const state = JSON.parse(await readFile(rebaseStatePath(repoPath), 'utf8')) as { tempDir?: unknown };

  if (typeof state.tempDir !== 'string') {
    throw new Error('Expected a persisted rebase editor temp directory.');
  }

  return state.tempDir;
}

function rebaseStatePath(repoPath: string): string {
  return join(repoPath, '.git', rebaseStatePathName);
}

async function commitFile(repoPath: string, relativePath: string, contents: string, message: string): Promise<void> {
  const filePath = join(repoPath, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
  await git(repoPath, ['add', relativePath]);
  await git(repoPath, ['commit', '-m', message]);
}

async function git(cwd: string, args: string[]) {
  return gitExecutor.run(args, { cwd, kind: 'mutation' });
}
