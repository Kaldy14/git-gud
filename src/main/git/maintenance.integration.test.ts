import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BranchCleanupInput, BranchCleanupPlan } from '@shared/maintenance';
import { gitExecutor } from './exec';
import { analyzeBranchCleanup, cleanupBranches, refreshMaintenanceRefs } from './maintenance';

const roots: string[] = [];
const oldEnv = { GIT_AUTHOR_DATE: '2025-01-01T12:00:00Z', GIT_COMMITTER_DATE: '2025-01-01T12:00:00Z' };
const git = (cwd: string, args: string[], env?: NodeJS.ProcessEnv) => gitExecutor.run(args, { cwd, kind: 'mutation', env });
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), 'git-gud-maintenance-'));
  roots.push(root);
  const path = join(root, 'repo');
  await mkdir(path);
  await git(path, ['init', '-b', 'main']);
  await git(path, ['config', 'user.name', 'Maintenance Tests']);
  await git(path, ['config', 'user.email', 'maintenance@example.invalid']);
  await git(path, ['config', 'commit.gpgsign', 'false']);
  await git(path, ['commit', '--allow-empty', '-m', 'root'], oldEnv);
  return { root, path };
}

async function commit(path: string, file: string, contents: string, message = file, env = oldEnv): Promise<string> {
  await writeFile(join(path, file), contents);
  await git(path, ['add', file]);
  await git(path, ['commit', '-m', message], env);
  return (await git(path, ['rev-parse', 'HEAD'])).stdout.trim();
}

async function analyze(path: string, olderThanDays = 30): Promise<BranchCleanupPlan> {
  return analyzeBranchCleanup({ path }, { baseRef: 'refs/heads/main', olderThanDays });
}

function selection(plan: BranchCleanupPlan, refs: string[], allowUnverified = false): BranchCleanupInput {
  return { baseRef: plan.baseRef, expectedBaseSha: plan.baseSha, olderThanDays: plan.olderThanDays, allowUnverified,
    branches: refs.map((ref) => ({ ref, expectedSha: plan.branches.find((branch) => branch.ref === ref)!.sha })) };
}

async function exists(path: string, ref: string): Promise<boolean> {
  return (await gitExecutor.run(['show-ref', '--verify', '--quiet', ref], { cwd: path, allowedExitCodes: [0, 1] })).exitCode === 0;
}

describe('repository branch maintenance with real Git', () => {
  it('distinguishes merged, rebased, squash-content, unmerged, and recent branches without changing checkout or index', async () => {
    const { path } = await repository();
    const rootSha = (await git(path, ['rev-parse', 'HEAD'])).stdout.trim();
    await git(path, ['checkout', '-b', 'feature/merged']);
    await commit(path, 'merged.txt', 'merged\n');
    await git(path, ['checkout', 'main']);
    await git(path, ['merge', '--no-ff', 'feature/merged', '-m', 'merged'], oldEnv);
    await git(path, ['checkout', '-b', 'feature/rebased', rootSha]);
    const rebased = await commit(path, 'rebased.txt', 'rebased\n');
    await git(path, ['checkout', 'main']);
    await git(path, ['cherry-pick', rebased], oldEnv);
    await git(path, ['checkout', '-b', 'feature/squashed', rootSha]);
    await commit(path, 'squashed.txt', 'first\n');
    await commit(path, 'squashed.txt', 'first\nsecond\n');
    await git(path, ['checkout', 'main']);
    await git(path, ['merge', '--squash', 'feature/squashed']);
    await git(path, ['commit', '-m', 'squashed'], oldEnv);
    await git(path, ['checkout', '-b', 'feature/unmerged', rootSha]);
    await commit(path, 'unmerged.txt', 'keep me\n');
    await git(path, ['checkout', '-b', 'feature/recent', rootSha]);
    await commit(path, 'recent.txt', 'recent\n', 'recent', { GIT_AUTHOR_DATE: new Date().toISOString(), GIT_COMMITTER_DATE: new Date().toISOString() });
    await git(path, ['checkout', 'main']);
    await writeFile(join(path, 'staged.txt'), 'staged remains\n');
    await git(path, ['add', 'staged.txt']);
    const indexBefore = (await git(path, ['write-tree'])).stdout;
    const result = await analyze(path);
    expect(result.branches.find((branch) => branch.name === 'feature/merged')?.evidence).toBe('merged');
    expect(result.branches.find((branch) => branch.name === 'feature/rebased')?.evidence).toBe('patch-equivalent');
    expect(result.branches.find((branch) => branch.name === 'feature/squashed')?.evidence).toBe('content-integrated');
    expect(result.branches.find((branch) => branch.name === 'feature/unmerged')?.evidence).toBe('unmerged');
    expect(result.branches.find((branch) => branch.name === 'feature/recent')?.oldEnough).toBe(false);
    expect(result.branches.find((branch) => branch.name === 'main')?.protectedReason).toBe('Comparison branch');
    expect((await git(path, ['symbolic-ref', 'HEAD'])).stdout.trim()).toBe('refs/heads/main');
    expect((await git(path, ['write-tree'])).stdout).toBe(indexBefore);
  });

  it('protects current/worktree/mainline/configured branches and keeps evidence inconclusive with custom drivers', async () => {
    const { root, path } = await repository();
    await git(path, ['branch', 'feature/worktree']);
    await git(path, ['worktree', 'add', join(root, 'linked'), 'feature/worktree']);
    await git(path, ['branch', 'release/keep']);
    await git(path, ['branch', 'feature/protected']);
    await git(path, ['config', 'branch.feature/protected.deleteMerged', 'false']);
    await git(path, ['checkout', '-b', 'feature/custom']);
    await commit(path, 'custom.txt', 'custom content\n');
    await git(path, ['checkout', 'main']);
    await git(path, ['config', 'merge.ours.driver', 'true']);
    const plan = await analyze(path);
    expect(plan.branches.find((branch) => branch.name === 'feature/worktree')?.protectedReason).toBe('In use by a worktree');
    expect(plan.branches.find((branch) => branch.name === 'release/keep')?.protectedReason).toBe('Mainline or default branch');
    expect(plan.branches.find((branch) => branch.name === 'feature/protected')?.protectedReason).toBe('Protected by branch configuration');
    expect(plan.branches.find((branch) => branch.name === 'feature/custom')?.evidence).toBe('unknown');
    await expect(cleanupBranches({ path }, selection(plan, ['refs/heads/feature/worktree'], true))).rejects.toThrow('protected');
  });

  it('pins recoverable commits and refuses stale base/branch previews, young branches, and unacknowledged age-only deletion', async () => {
    const { path } = await repository();
    await git(path, ['branch', 'feature/merged']);
    let plan = await analyze(path);
    const result = await cleanupBranches({ path }, selection(plan, ['refs/heads/feature/merged']));
    expect(result.outcomes[0]?.status, result.outcomes[0]?.message).toBe('deleted');
    expect(await exists(path, 'refs/heads/feature/merged')).toBe(false);
    expect((await git(path, ['rev-parse', result.outcomes[0]!.recoveryRef!])).stdout.trim()).toBe(plan.baseSha);
    await git(path, ['branch', 'feature/changed']);
    plan = await analyze(path);
    await commit(path, 'base.txt', 'new base\n');
    await expect(cleanupBranches({ path }, selection(plan, ['refs/heads/feature/changed']))).rejects.toThrow('comparison branch changed');
    plan = await analyze(path);
    await git(path, ['update-ref', 'refs/heads/feature/changed', plan.baseSha]);
    await expect(cleanupBranches({ path }, selection(plan, ['refs/heads/feature/changed']))).rejects.toThrow('selected branch changed');
    await git(path, ['checkout', '-b', 'feature/keep']);
    await commit(path, 'keep.txt', 'unmerged\n');
    await git(path, ['checkout', 'main']);
    plan = await analyze(path);
    await expect(cleanupBranches({ path }, selection(plan, ['refs/heads/feature/keep']))).rejects.toThrow('Acknowledge');
    expect(await exists(path, 'refs/heads/feature/keep')).toBe(true);
    const acknowledged = await cleanupBranches({ path }, selection(plan, ['refs/heads/feature/keep'], true));
    expect(acknowledged.outcomes[0]?.status).toBe('deleted');
    await git(path, ['branch', 'feature/young']);
    plan = await analyze(path, 36500);
    await expect(cleanupBranches({ path }, selection(plan, ['refs/heads/feature/young'], true))).rejects.toThrow('age filter');
  });

  it('fails compare-and-delete when an external writer changes a ref during cleanup', async () => {
    const { path } = await repository();
    await git(path, ['branch', 'feature/race']);
    const plan = await analyze(path);
    await commit(path, 'later.txt', 'later\n');
    const later = (await git(path, ['rev-parse', 'HEAD'])).stdout.trim();
    await git(path, ['reset', '--hard', plan.baseSha]);
    const realRun = gitExecutor.run.bind(gitExecutor);
    vi.spyOn(gitExecutor, 'run').mockImplementation(async (args, options) => {
      if (args[0] === 'update-ref' && args[1] === '--stdin') {
        await realRun(['update-ref', 'refs/heads/feature/race', later], { cwd: path, kind: 'mutation' });
      }
      return realRun(args, options);
    });
    const result = await cleanupBranches({ path }, selection(plan, ['refs/heads/feature/race']));
    expect(result.outcomes[0]?.status).toBe('failed');
    expect(result.outcomes[0]?.recoveryRef).toBeUndefined();
    expect((await realRun(['rev-parse', 'refs/heads/feature/race'], { cwd: path })).stdout.trim()).toBe(later);
  });

  it('refreshes only tracking branches while preserving local tags, then deletes real remote branches with leases', async () => {
    const { root, path } = await repository();
    const remote = join(root, 'origin.git');
    await git(root, ['clone', '--bare', path, remote]);
    await git(path, ['remote', 'add', 'origin', remote]);
    await git(path, ['branch', 'feature/remote']);
    await git(path, ['push', 'origin', 'feature/remote']);
    await git(path, ['branch', 'feature/active']);
    await git(path, ['worktree', 'add', join(root, 'active'), 'feature/active']);
    await git(path, ['push', 'origin', 'feature/active']);
    await git(path, ['tag', 'local-only']);
    await git(path, ['config', 'fetch.pruneTags', 'true']);
    await git(path, ['config', 'remote.origin.pruneTags', 'true']);
    await git(path, ['config', '--add', 'remote.origin.fetch', '+refs/tags/*:refs/tags/*']);
    await git(path, ['update-ref', 'refs/remotes/origin/obsolete', 'HEAD']);
    await refreshMaintenanceRefs({ path });
    expect(await exists(path, 'refs/tags/local-only')).toBe(true);
    expect(await exists(path, 'refs/remotes/origin/obsolete')).toBe(false);
    const plan = await analyze(path);
    expect(plan.branches.find((branch) => branch.name === 'origin/main')?.protectedReason).toBe('Mainline or default branch');
    expect(plan.branches.find((branch) => branch.name === 'origin/feature/active')?.protectedReason).toBe('In use by a worktree');
    const result = await cleanupBranches({ path }, selection(plan, ['refs/remotes/origin/feature/remote']));
    expect(result.outcomes[0]?.status, result.outcomes[0]?.message).toBe('deleted');
    expect(await exists(remote, 'refs/heads/feature/remote')).toBe(false);
    expect(await exists(path, 'refs/heads/feature/remote')).toBe(true);
    expect(await exists(path, 'refs/tags/local-only')).toBe(true);
  });

  it('reports partial remote failures, rejects moved server refs, changed defaults, and different push destinations', async () => {
    const { root, path } = await repository();
    const remote = join(root, 'origin.git');
    await git(root, ['clone', '--bare', path, remote]);
    await git(path, ['remote', 'add', 'origin', remote]);
    await git(path, ['branch', 'feature/stale']);
    await git(path, ['branch', 'feature/good']);
    await git(path, ['push', 'origin', 'feature/stale', 'feature/good']);
    await refreshMaintenanceRefs({ path });
    let plan = await analyze(path);
    const later = await commit(path, 'remote.txt', 'later\n');
    await git(remote, ['update-ref', 'refs/heads/feature/stale', later]).catch(async () => {
      await git(path, ['push', 'origin', `${later}:refs/heads/feature/stale`]);
    });
    // Restore the reviewed tracking ref to simulate an unfetched collaborator update.
    await git(path, ['update-ref', 'refs/remotes/origin/feature/stale', plan.branches.find((branch) => branch.name === 'origin/feature/stale')!.sha]);
    await git(path, ['reset', '--hard', plan.baseSha]);
    const result = await cleanupBranches({ path }, selection(plan, ['refs/remotes/origin/feature/stale', 'refs/remotes/origin/feature/good']));
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual(['failed', 'deleted']);
    expect(await exists(remote, 'refs/heads/feature/stale')).toBe(true);
    expect(await exists(remote, 'refs/heads/feature/good')).toBe(false);
    await git(path, ['branch', 'feature/default']);
    await git(path, ['push', 'origin', 'feature/default']);
    await refreshMaintenanceRefs({ path });
    plan = await analyze(path);
    await git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/feature/default']);
    const defaultResult = await cleanupBranches({ path }, selection(plan, ['refs/remotes/origin/feature/default']));
    expect(defaultResult.outcomes[0]?.message).toContain('default branch is protected');
    await git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    await git(path, ['config', 'remote.origin.pushurl', join(root, 'elsewhere.git')]);
    const pushResult = await cleanupBranches({ path }, selection(plan, ['refs/remotes/origin/feature/default']));
    expect(pushResult.outcomes[0]?.message).toContain('matching fetch and push URL');
  });

  it('does not mistake cherry-equivalent commits for integration when a unique merge resolution exists', async () => {
    const { path } = await repository();
    const rootSha = (await git(path, ['rev-parse', 'HEAD'])).stdout.trim();
    await git(path, ['checkout', '-b', 'feature/side']);
    const side = await commit(path, 'side.txt', 'side\n');
    await git(path, ['checkout', '-b', 'feature/merge', rootSha]);
    await git(path, ['merge', '--no-ff', '--no-commit', 'feature/side']);
    await writeFile(join(path, 'resolution.txt'), 'unique merge result\n');
    await git(path, ['add', 'resolution.txt']);
    await git(path, ['commit', '-m', 'unique merge'], oldEnv);
    await git(path, ['checkout', 'main']);
    await commit(path, 'unrelated.txt', 'unrelated\n');
    await git(path, ['cherry-pick', side], oldEnv);
    const plan = await analyze(path);
    expect(plan.branches.find((branch) => branch.name === 'feature/merge')?.evidence).toBe('unmerged');
  });
});
