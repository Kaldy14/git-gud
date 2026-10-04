import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { gitExecutor, type GitCommandOptions } from './exec';
import { loadCommitGraph } from './commitGraph';
import { loadCommitSelectionDetail, loadFileDiff, loadReviewPlan } from './repositoryDetails';
import { loadRepositoryOverview, loadStatus } from './repositoryOverview';

describe('large repository working changes', () => {
  let repoPath: string;
  let baseSha: string;
  let headSha: string;

  beforeAll(async () => {
    repoPath = await mkdtemp(join(tmpdir(), 'git-gud-performance-'));
    await gitExecutor.run(['init', '-b', 'main'], { cwd: repoPath, kind: 'mutation' });
    await gitExecutor.run(['config', 'user.name', 'Performance Test'], { cwd: repoPath, kind: 'mutation' });
    await gitExecutor.run(['config', 'user.email', 'performance@example.invalid'], { cwd: repoPath, kind: 'mutation' });
    await writeFile(join(repoPath, 'selected.txt'), 'before\n');
    await gitExecutor.run(['add', 'selected.txt'], { cwd: repoPath, kind: 'mutation' });
    await gitExecutor.run(['-c', 'commit.gpgsign=false', 'commit', '-m', 'base'], { cwd: repoPath, kind: 'mutation' });
    baseSha = (await gitExecutor.run(['rev-parse', 'HEAD'], { cwd: repoPath })).stdout.trim();
    const history: string[] = [];
    for (let index = 1; index <= 4000; index++) {
      const message = `history ${index}\n`;
      history.push(`commit refs/heads/main\nmark :${index}\ncommitter Performance Test <performance@example.invalid> ${1760000000 + index} +0000\ndata ${Buffer.byteLength(message)}\n${message}from ${index === 1 ? baseSha : `:${index - 1}`}\n\n`);
    }
    await gitExecutor.run(['fast-import', '--quiet'], { cwd: repoPath, kind: 'mutation', input: history.join('') });
    headSha = (await gitExecutor.run(['rev-parse', 'HEAD'], { cwd: repoPath })).stdout.trim();
    await gitExecutor.run(['update-ref', 'refs/remotes/origin/main', baseSha], { cwd: repoPath, kind: 'mutation' });
    await gitExecutor.run(['config', 'remote.origin.url', repoPath], { cwd: repoPath, kind: 'mutation' });
    await gitExecutor.run(['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'], { cwd: repoPath, kind: 'mutation' });
    await gitExecutor.run(['config', 'branch.main.remote', 'origin'], { cwd: repoPath, kind: 'mutation' });
    await gitExecutor.run(['config', 'branch.main.merge', 'refs/heads/main'], { cwd: repoPath, kind: 'mutation' });
    await writeFile(join(repoPath, 'selected.txt'), 'after\n');
    await mkdir(join(repoPath, 'unrelated'));
    await Promise.all(Array.from({ length: 1500 }, (_, index) =>
      writeFile(join(repoPath, 'unrelated', `${index}.txt`), 'unrelated\n')
    ));
    await mkdir(join(repoPath, 'staged'));
    await Promise.all(Array.from({ length: 18 }, (_, index) =>
      writeFile(join(repoPath, 'staged', `${index}.txt`), `staged ${index}\n`)
    ));
    await gitExecutor.run(['add', 'staged'], { cwd: repoPath, kind: 'mutation' });
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await rm(repoPath, { recursive: true, force: true });
  });

  it('does not enumerate unrelated changes when opening one tracked file', async () => {
    const reads = recordStatusReads();
    const startedAt = performance.now();
    const diff = await loadFileDiff({ path: repoPath }, { kind: 'wip', path: 'selected.txt', staged: false });

    console.info(JSON.stringify({ operation: 'single-file diff', ms: performance.now() - startedAt, reads }));
    expect(diff.patch).toContain('+after');
    expect(diff.stageablePatch).toContain('+after');
    expect(reads).toHaveLength(1);
    expect(reads[0]?.bytes).toBeLessThan(1024);
    expect(reads[0]?.args.slice(-2)).toEqual(['--', 'selected.txt']);
  });

  it('reads repository status once when reviewing many staged files', async () => {
    const reads = recordStatusReads();
    const startedAt = performance.now();
    const plan = await loadReviewPlan({ path: repoPath }, { kind: 'wip', scope: 'staged' });

    console.info(JSON.stringify({ operation: '18-file staged review', ms: performance.now() - startedAt, reads }));
    expect(plan.fileContexts).toHaveLength(18);
    expect(reads).toHaveLength(1);
    expect(reads[0]?.bytes).toBeLessThan(4096);
    expect(reads[0]?.args).toContain('--untracked-files=no');
    expect(reads[0]?.args).toContain('--no-ahead-behind');
  });

  it('still identifies consecutive commit selections', async () => {
    const previousSha = (await gitExecutor.run(['rev-parse', 'HEAD^'], { cwd: repoPath })).stdout.trim();
    const detail = await loadCommitSelectionDetail({ path: repoPath }, [headSha, previousSha]);

    expect(detail.isContiguous).toBe(true);
    expect(detail.files).toEqual([]);
  });

  it('does not share limited review status with a concurrent full overview read', async () => {
    const reads = recordStatusReads();
    const [full, limited] = await Promise.all([
      loadStatus(repoPath),
      loadStatus(repoPath, undefined, [], { untrackedFiles: 'no', aheadBehind: false })
    ]);

    expect(full.untrackedCount).toBe(1500);
    expect(full.branch.ahead).toBe(4000);
    expect(limited.untrackedCount).toBe(0);
    expect(limited.branch.ahead).toBe(0);
    expect(reads).toHaveLength(2);
  });

  it('shares remote and worktree reads between the overview and history refresh', async () => {
    const run = vi.spyOn(gitExecutor, 'run');
    const [overview, graph] = await Promise.all([
      loadRepositoryOverview({ path: repoPath }),
      loadCommitGraph({ path: repoPath }, 50)
    ]);

    expect(overview.status.branch.ahead).toBe(4000);
    expect(overview.refs.localBranches.find((branch) => branch.current)?.ahead).toBe(4000);
    expect(graph.loadedCommitCount).toBe(50);
    expect(graph.rows.some((row) => row.sha === 'wip')).toBe(true);
    expect(run.mock.calls.filter(([args]) => args[0] === 'config' && args.includes('--get-regexp'))).toHaveLength(1);
    expect(run.mock.calls.filter(([args]) => args[0] === 'worktree' && args[1] === 'list')).toHaveLength(1);
  });

  it('bounds the history read needed to identify a sparse commit selection', async () => {
    const run = gitExecutor.run.bind(gitExecutor);
    let visitedCommits = 0;
    vi.spyOn(gitExecutor, 'run').mockImplementation(async (args, options) => {
      const result = await run(args, options);
      if (args[0] === 'rev-list') {
        visitedCommits += result.stdout.trim().split('\n').filter(Boolean).length;
      }
      return result;
    });
    const startedAt = performance.now();
    const detail = await loadCommitSelectionDetail({ path: repoPath }, [headSha, baseSha]);

    console.info(JSON.stringify({ operation: 'sparse commit selection', ms: performance.now() - startedAt, visitedCommits }));
    expect(detail.isContiguous).toBe(false);
    expect(detail.files.map((file) => file.path)).toEqual(['selected.txt']);
    expect(visitedCommits).toBeLessThanOrEqual(3);
  });

  it('does not calculate branch divergence while refreshing linked worktree history', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'git-gud-performance-worktrees-')));
    const linkedPaths = [join(root, 'first'), join(root, 'second')];
    try {
      for (const [index, linkedPath] of linkedPaths.entries()) {
        const branch = `performance-linked-${index}`;
        await gitExecutor.run(['worktree', 'add', '-b', branch, linkedPath, headSha], { cwd: repoPath, kind: 'mutation' });
        await gitExecutor.run(['branch', '--set-upstream-to=origin/main', branch], { cwd: repoPath, kind: 'mutation' });
      }
      await writeFile(join(linkedPaths[1]!, 'linked-change.txt'), 'linked worktree change\n');
      const reads = recordStatusReads();
      const run = vi.mocked(gitExecutor.run);
      const start = performance.now();
      const graph = await loadCommitGraph({ path: repoPath }, 50, false);

      console.info(JSON.stringify({ operation: 'linked worktree history refresh', ms: performance.now() - start, statusReads: reads.length }));
      expect(graph.rows.some((row) => row.worktree?.path === linkedPaths[1] && row.files.some((file) => file.path === 'linked-change.txt'))).toBe(true);
      expect(reads).toHaveLength(3);
      expect(reads.every((read) => read.args.includes('--no-ahead-behind'))).toBe(true);
      expect(run.mock.calls.filter(([args]) => args[0] === 'for-each-ref')
        .some(([args]) => args.some((arg) => arg.includes('%(upstream:track)')))).toBe(false);
    } finally {
      vi.restoreAllMocks();
      for (const linkedPath of linkedPaths) {
        await gitExecutor.run(['worktree', 'remove', '--force', linkedPath], { cwd: repoPath, kind: 'mutation' });
      }
      await rm(root, { recursive: true, force: true });
    }
  });
});

function recordStatusReads(): Array<{ args: string[]; ms: number; bytes: number }> {
  const reads: Array<{ args: string[]; ms: number; bytes: number }> = [];
  const run = gitExecutor.run.bind(gitExecutor);
  vi.spyOn(gitExecutor, 'run').mockImplementation(async (args: string[], options: GitCommandOptions) => {
    const startedAt = performance.now();
    const result = await run(args, options);
    if (args.includes('status')) {
      reads.push({ args, ms: performance.now() - startedAt, bytes: Buffer.byteLength(result.stdout) });
    }
    return result;
  });
  return reads;
}
