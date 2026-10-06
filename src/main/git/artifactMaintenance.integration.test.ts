import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ArtifactCleanupCandidate, ArtifactCleanupInput, ArtifactCleanupPlan } from '@shared/maintenance';
import { analyzeArtifactCleanup, cleanupArtifacts } from './artifactMaintenance';
import { gitExecutor } from './exec';

const roots: string[] = [];
const oldEnv = { GIT_AUTHOR_DATE: '2025-01-01T12:00:00Z', GIT_COMMITTER_DATE: '2025-01-01T12:00:00Z' };
const git = (cwd: string, args: string[], env?: NodeJS.ProcessEnv) => gitExecutor.run(args, { cwd, kind: 'mutation', env });
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(): Promise<{ root: string; path: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'git-gud-artifact-maintenance-')));
  roots.push(root);
  const path = join(root, 'repo');
  await mkdir(path);
  await git(path, ['init', '-b', 'main']);
  await git(path, ['config', 'user.name', 'Maintenance Tests']);
  await git(path, ['config', 'user.email', 'maintenance@example.invalid']);
  await git(path, ['config', 'commit.gpgsign', 'false']);
  await writeFile(join(path, 'tracked.txt'), 'original\n');
  await git(path, ['add', '.']);
  await git(path, ['commit', '-m', 'root'], oldEnv);
  return { root, path };
}

async function stash(path: string, subject: string, env: NodeJS.ProcessEnv = oldEnv): Promise<string> {
  await writeFile(join(path, 'tracked.txt'), subject);
  await git(path, ['stash', 'push', '-m', subject], env);
  return (await git(path, ['rev-parse', 'refs/stash'])).stdout.trim();
}

async function worktree(root: string, path: string, name: string, env: NodeJS.ProcessEnv = oldEnv): Promise<string> {
  const linked = join(root, name);
  await git(path, ['worktree', 'add', '-b', `feature/${name}`, linked, 'main'], env);
  return linked;
}

function selection(plan: ArtifactCleanupPlan, candidates: ArtifactCleanupCandidate[]): ArtifactCleanupInput {
  return { olderThanDays: plan.olderThanDays, items: candidates.map((entry) => ({ kind: entry.kind, id: entry.id, expectedSha: entry.sha })) };
}

describe('stash and worktree maintenance with real Git', () => {
  it('drops nonadjacent old stash selections without index shifts and retains recoverable commits', async () => {
    const { path } = await repository();
    const first = await stash(path, 'first old');
    const middle = await stash(path, 'keep middle');
    const last = await stash(path, 'last old');
    const recent = await stash(path, 'recent', {});
    const plan = await analyzeArtifactCleanup({ path }, { olderThanDays: 30 });
    expect(plan.candidates.find((entry) => entry.sha === recent)?.oldEnough).toBe(false);
    const result = await cleanupArtifacts({ path }, selection(plan, plan.candidates.filter((entry) => entry.sha === first || entry.sha === last)));
    expect(result.outcomes.map((entry) => entry.status)).toEqual(['deleted', 'deleted']);
    const remaining = (await git(path, ['stash', 'list', '--format=%H'])).stdout.trim().split('\n');
    expect(remaining).toEqual([recent, middle]);
    const backup = result.outcomes.find((entry) => entry.id === 'stash@{3}')!.recoveryRef!;
    expect((await git(path, ['rev-parse', backup])).stdout.trim()).toBe(first);
    await git(path, ['stash', 'store', '-m', 'restored', backup]);
    await git(path, ['stash', 'apply', 'stash@{0}']);
    expect((await git(path, ['diff'])).stdout).toContain('first old');
  });

  it('rejects a changed stash selector and recent stashes before deletion', async () => {
    const { path } = await repository();
    await stash(path, 'old');
    const plan = await analyzeArtifactCleanup({ path }, { olderThanDays: 30 });
    const old = plan.candidates.find((entry) => entry.kind === 'stash')!;
    await stash(path, 'new', {});
    await expect(cleanupArtifacts({ path }, selection(plan, [old]))).rejects.toThrow('changed or disappeared');
    const current = await analyzeArtifactCleanup({ path }, { olderThanDays: 30 });
    await expect(cleanupArtifacts({ path }, selection(current, [current.candidates.find((entry) => entry.id === 'stash@{0}')!]))).rejects.toThrow('age filter');
    expect((await git(path, ['stash', 'list', '--format=%H'])).stdout.trim().split('\n')).toHaveLength(2);
  });

  it('protects main, current, open, locked, dirty, missing, and recently used worktrees', async () => {
    const { root, path } = await repository();
    const clean = await worktree(root, path, 'clean');
    const dirty = await worktree(root, path, 'dirty');
    const locked = await worktree(root, path, 'locked');
    const open = await worktree(root, path, 'open');
    const ignored = await worktree(root, path, 'ignored');
    const missing = await worktree(root, path, 'missing');
    const recent = await worktree(root, path, 'recent', {});
    await writeFile(join(dirty, 'untracked.txt'), 'keep');
    await git(path, ['worktree', 'lock', '--reason', 'keep this', locked]);
    await writeFile(join(ignored, '.gitignore'), 'secret.txt\n');
    await git(ignored, ['add', '.gitignore']);
    await git(ignored, ['commit', '-m', 'ignore'], oldEnv);
    await writeFile(join(ignored, 'secret.txt'), 'keep');
    await rm(missing, { recursive: true });
    const plan = await analyzeArtifactCleanup({ path }, { olderThanDays: 30 }, [open]);
    const find = (id: string) => plan.candidates.find((entry) => entry.id === id)!;
    expect(find(path).protectedReason).toBe('Main worktree');
    expect(find(clean)).toMatchObject({ oldEnough: true, ageSource: 'head-activity', protectedReason: undefined });
    expect(find(dirty).protectedReason).toContain('files');
    // Ignored build output follows native Git removal semantics. The UI review
    // explicitly explains that removing a worktree also removes ignored files.
    expect(find(ignored)).toMatchObject({ oldEnough: true, protectedReason: undefined });
    expect(find(locked).protectedReason).toBe('Locked worktree');
    expect(find(open).protectedReason).toBe('Open in Git Gud');
    expect(find(missing).protectedReason).toContain('missing');
    expect(find(recent).oldEnough).toBe(false);
    const linkedPlan = await analyzeArtifactCleanup({ path: clean }, { olderThanDays: 30 });
    expect(linkedPlan.candidates.find((entry) => entry.id === clean)?.protectedReason).toBe('Current worktree');
    for (const id of [path, dirty, locked]) {
      await expect(cleanupArtifacts({ path }, selection(plan, [find(id)]))).rejects.toThrow('protected');
    }
    await expect(cleanupArtifacts({ path }, selection(plan, [find(open)]), () => [open])).rejects.toThrow('Open in Git Gud');
  });

  it('removes old clean attached and detached worktrees and preserves branches and recovery refs', async () => {
    const { root, path } = await repository();
    const attached = await worktree(root, path, 'attached');
    const detached = join(root, 'detached');
    await git(path, ['worktree', 'add', '--detach', detached, 'main'], oldEnv);
    await writeFile(join(detached, 'extra.txt'), 'detached work\n');
    await git(detached, ['add', '.']);
    await git(detached, ['commit', '-m', 'detached work'], oldEnv);
    const plan = await analyzeArtifactCleanup({ path }, { olderThanDays: 30 });
    const chosen = plan.candidates.filter((entry) => entry.id === attached || entry.id === detached);
    const result = await cleanupArtifacts({ path }, selection(plan, chosen));
    expect(result.outcomes.map((entry) => entry.status)).toEqual(['deleted', 'deleted']);
    expect((await git(path, ['worktree', 'list', '--porcelain'])).stdout).not.toContain(attached);
    expect((await git(path, ['show-ref', '--verify', 'refs/heads/feature/attached'])).exitCode).toBe(0);
    for (const outcome of result.outcomes) {
      expect((await git(path, ['rev-parse', outcome.recoveryRef!])).stdout.trim()).toBe(chosen.find((entry) => entry.id === outcome.id)!.sha);
    }
  });

  it('revalidates dirty state and new app tabs after preview', async () => {
    const { root, path } = await repository();
    const linked = await worktree(root, path, 'changed');
    const plan = await analyzeArtifactCleanup({ path }, { olderThanDays: 30 });
    const chosen = plan.candidates.find((entry) => entry.id === linked)!;
    await writeFile(join(linked, 'tracked.txt'), 'modified after preview');
    await expect(cleanupArtifacts({ path }, selection(plan, [chosen]))).rejects.toThrow('protected');
    await git(linked, ['restore', 'tracked.txt']);
    let reads = 0;
    const result = await cleanupArtifacts({ path }, selection(plan, [chosen]), () => ++reads === 1 ? [] : [linked]);
    expect(result.outcomes[0]).toMatchObject({ status: 'failed', message: expect.stringContaining('Open in Git Gud') });
    expect((await git(path, ['worktree', 'list', '--porcelain'])).stdout).toContain(linked);
  });

  it('validates batch limits, identifiers, duplicate selection, and age', async () => {
    const { path } = await repository();
    const sha = await stash(path, 'old');
    const item = { kind: 'stash' as const, id: 'stash@{0}', expectedSha: sha };
    for (const items of [[], [item, item], [{ ...item, id: '--all' }], [{ ...item, expectedSha: 'nope' }], Array(101).fill(item)]) {
      await expect(cleanupArtifacts({ path }, { olderThanDays: 30, items })).rejects.toThrow();
    }
    await expect(analyzeArtifactCleanup({ path }, { olderThanDays: -1 })).rejects.toThrow('whole number');
  });

  it('reports a concurrent lock as a partial failure and retains a recovery ref', async () => {
    const { root, path } = await repository();
    const locked = await worktree(root, path, 'a-concurrently-locked');
    const clean = await worktree(root, path, 'b-clean');
    const plan = await analyzeArtifactCleanup({ path }, { olderThanDays: 30 });
    const chosen = plan.candidates.filter((entry) => entry.id === locked || entry.id === clean);
    const original = gitExecutor.run.bind(gitExecutor);
    let injected = false;
    vi.spyOn(gitExecutor, 'run').mockImplementation(async (args, options) => {
      if (!injected && args[0] === 'worktree' && args[1] === 'remove') {
        injected = true;
        await original(['worktree', 'lock', locked], { cwd: path, kind: 'mutation' });
      }
      return original(args, options);
    });
    const result = await cleanupArtifacts({ path }, selection(plan, chosen));
    expect(result.outcomes[0]).toMatchObject({ id: locked, status: 'failed', recoveryRef: expect.any(String) });
    expect(result.outcomes[1]).toMatchObject({ id: clean, status: 'deleted' });
    expect((await git(path, ['worktree', 'list', '--porcelain'])).stdout).toContain(locked);
    expect((await git(path, ['rev-parse', result.outcomes[0]!.recoveryRef!])).stdout.trim()).toBe(chosen.find((entry) => entry.id === locked)!.sha);
  });
});
