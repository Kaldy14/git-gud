import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';

import type { ArtifactCleanupCandidate, ArtifactCleanupInput, ArtifactCleanupPlan, ArtifactCleanupResult } from '@shared/maintenance';
import type { RepoTab } from '@shared/types';

import { createProfileCommandEnv } from '../profiles';
import { gitExecutor } from './exec';

type MaintenanceTab = Pick<RepoTab, 'path' | 'assignedProfileId'>;
type WorktreeRecord = { path: string; sha: string; branch?: string; bare: boolean; locked: boolean; missing: boolean };
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const STASH_SELECTOR = /^stash@\{(\d+)\}$/;
const MAX_ITEMS = 100;
const MAX_SCAN_ITEMS = 1000;

/** Read-only inventory. Worktree activity never implies that saved work is disposable. */
export async function analyzeArtifactCleanup(
  tab: MaintenanceTab,
  options: { olderThanDays: number },
  openPaths: readonly string[] = [],
  selectedIds?: ReadonlySet<string>
): Promise<ArtifactCleanupPlan> {
  assertAge(options.olderThanDays);
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const deadlineAt = Date.now() + 60_000;
  const run = (cwd: string, args: string[]) => gitExecutor.run(args, { cwd, env, deadlineAt, maxStdoutBytes: 8 * 1024 * 1024 });
  const [stashes, worktreeOutput, currentPath, canonicalOpenPaths] = await Promise.all([
    run(tab.path, ['stash', 'list', '--format=%gd%x00%H%x00%ct%x00%gs']),
    run(tab.path, ['worktree', 'list', '--porcelain', '-z']),
    canonicalPath(tab.path),
    Promise.all(openPaths.map(canonicalPath))
  ]);
  const scannedAt = new Date().toISOString();
  const candidates: ArtifactCleanupCandidate[] = [];
  const allStashes = stashes.stdout.split('\n').filter(Boolean);
  const allWorktrees = parseWorktrees(worktreeOutput.stdout);
  const warnings: string[] = [];
  if (!selectedIds && allStashes.length + allWorktrees.length > MAX_SCAN_ITEMS) warnings.push(`Showing the first ${MAX_SCAN_ITEMS} items. Additional items were not scanned.`);
  const stashLines = selectedIds ? allStashes.filter((line) => selectedIds.has(`stash:${line.split('\0')[0]}`)) : allStashes.slice(0, MAX_SCAN_ITEMS);
  for (const line of stashLines) {
    const [id = '', sha = '', timestamp = '', subject = ''] = line.split('\0');
    if (!STASH_SELECTOR.test(id) || !OID.test(sha)) continue;
    candidates.push({ kind: 'stash', id, name: subject || id, sha, ...ageFields(Number(timestamp), scannedAt, options.olderThanDays) });
  }
  const worktrees = selectedIds ? allWorktrees.filter((entry) => selectedIds.has(`worktree:${entry.path}`))
    : allWorktrees.slice(0, Math.max(0, MAX_SCAN_ITEMS - candidates.length));
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(4, worktrees.length) }, async () => {
    while (nextIndex < worktrees.length) {
      const worktree = worktrees[nextIndex++];
      if (!worktree) break;
      const path = await canonicalPath(worktree.path);
      let protectedReason = worktree === allWorktrees[0] || worktree.bare ? 'Main worktree' : undefined;
      if (path === currentPath) protectedReason = protectedReason ?? 'Current worktree';
      else if (canonicalOpenPaths.includes(path)) protectedReason = protectedReason ?? 'Open in Git Gud';
      if (worktree.locked) protectedReason = protectedReason ?? 'Locked worktree';
      if (worktree.missing) protectedReason = protectedReason ?? 'Worktree directory is missing; repair or prune it manually';
      const candidate: ArtifactCleanupCandidate = {
        kind: 'worktree', id: worktree.path, name: basename(worktree.path), sha: worktree.sha,
        branch: worktree.branch, oldEnough: false, protectedReason
      };
      try {
        if (worktree.bare || worktree.missing) {
          candidates.push(candidate);
          continue;
        }
        // Read reflog event dates, not the dates of the commits they point at.
        const activity = await run(worktree.path, ['reflog', 'show', '-1', '--format=%gD', '--date=unix', 'HEAD']);
        const activityTimestamp = Number(/^HEAD@\{(\d+)\}$/.exec(activity.stdout.trim())?.[1]);
        const timestamp = activityTimestamp > 0 ? activityTimestamp
          : Number((await run(worktree.path, ['show', '-s', '--format=%ct', 'HEAD'])).stdout.trim());
        Object.assign(candidate, ageFields(timestamp, scannedAt, options.olderThanDays));
        candidate.ageSource = activityTimestamp > 0 ? 'head-activity' : 'tip-commit';
        if (!candidate.protectedReason) {
          const status = await run(worktree.path, ['status', '--porcelain', '-z', '--untracked-files=all', '--ignore-submodules=none']);
          if (status.stdout) candidate.protectedReason = 'Contains modified or untracked files';
          const submodules = await run(worktree.path, ['ls-files', '--stage', '-z']);
          if (submodules.stdout.split('\0').some((entry) => entry.startsWith('160000 '))) candidate.protectedReason = 'Contains submodules';
        }
      } catch {
        candidate.protectedReason = candidate.protectedReason ?? 'Unable to verify worktree state';
      }
      candidates.push(candidate);
    }
  }));
  return {
    repoPath: tab.path, scannedAt, olderThanDays: options.olderThanDays,
    candidates: candidates.sort((a, b) => a.kind.localeCompare(b.kind) || (b.ageDays ?? -1) - (a.ageDays ?? -1) || a.id.localeCompare(b.id)),
    warnings
  };
}

export async function cleanupArtifacts(
  tab: MaintenanceTab,
  input: ArtifactCleanupInput,
  getOpenPaths: () => readonly string[] = () => []
): Promise<ArtifactCleanupResult> {
  assertInput(input);
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const plan = await analyzeArtifactCleanup(tab, input, getOpenPaths(), new Set(input.items.map((item) => `${item.kind}:${item.id}`)));
  const selected = input.items.map((item) => {
    const candidate = plan.candidates.find((entry) => entry.kind === item.kind && entry.id === item.id);
    if (!candidate || candidate.sha !== item.expectedSha) throw new Error('A selected item changed or disappeared. Scan again before deleting.');
    assertEligible(candidate);
    return candidate;
  });
  // Drop highest indices first so earlier selectors remain stable in this batch.
  selected.sort((a, b) => a.kind.localeCompare(b.kind) || (a.kind === 'stash'
    ? stashIndex(b.id) - stashIndex(a.id) : a.id.localeCompare(b.id)));
  const session = randomUUID();
  const outcomes: ArtifactCleanupResult['outcomes'] = [];
  for (const [index, candidate] of selected.entries()) {
    const recoveryRef = `refs/git-gud/cleanup/${session}/${candidate.kind}/${index}`;
    let recoverySaved = false;
    try {
      // Recheck activity, dirtiness, locks, and application tabs for each item.
      const current = await analyzeArtifactCleanup(tab, input, getOpenPaths(), new Set([`${candidate.kind}:${candidate.id}`]));
      const fresh = current.candidates.find((entry) => entry.kind === candidate.kind && entry.id === candidate.id);
      if (!fresh || fresh.sha !== candidate.sha) throw new Error('The selected item changed or disappeared. Scan again.');
      assertEligible(fresh);
      if (candidate.kind === 'stash') {
        // Pin the stash and verify the list's top ref before touching its reflog.
        const top = (await gitExecutor.run(['rev-parse', '--verify', 'refs/stash'], { cwd: tab.path, env })).stdout.trim();
        const actual = (await gitExecutor.run(['rev-parse', '--verify', candidate.id], { cwd: tab.path, env })).stdout.trim();
        if (actual !== candidate.sha) throw new Error('The selected stash changed. Scan again.');
        await gitExecutor.run(['update-ref', '--stdin'], {
          cwd: tab.path, env, kind: 'mutation',
          input: `start\nverify refs/stash ${top}\ncreate ${recoveryRef} ${candidate.sha}\nprepare\ncommit\n`
        });
        recoverySaved = true;
        const verified = (await gitExecutor.run(['rev-parse', '--verify', candidate.id], { cwd: tab.path, env })).stdout.trim();
        if (verified !== candidate.sha) throw new Error('The selected stash changed. Scan again.');
        await gitExecutor.run(['stash', 'drop', candidate.id], { cwd: tab.path, env, kind: 'mutation', cancellable: false });
      } else {
        await gitExecutor.run(['update-ref', recoveryRef, candidate.sha, ''], { cwd: tab.path, env, kind: 'mutation' });
        recoverySaved = true;
        const actual = (await gitExecutor.run(['rev-parse', '--verify', 'HEAD'], { cwd: candidate.id, env })).stdout.trim();
        if (actual !== candidate.sha) throw new Error('The selected worktree changed. Scan again.');
        // Never force removal: Git rechecks cleanliness and locks itself.
        await gitExecutor.run(['worktree', 'remove', '--', candidate.id], { cwd: tab.path, env, kind: 'mutation', cancellable: false });
      }
      outcomes.push({ kind: candidate.kind, id: candidate.id, status: 'deleted',
        message: candidate.kind === 'stash' ? 'Stash removed. Saved changes are retained in the recovery ref.'
          : 'Worktree removed. Its branch and reviewed commit are retained.', recoveryRef });
    } catch (error) {
      outcomes.push({ kind: candidate.kind, id: candidate.id, status: 'failed',
        message: error instanceof Error ? error.message : 'Cleanup failed.', ...(recoverySaved ? { recoveryRef } : {}) });
    }
  }
  return {
    repoPath: tab.path, happenedAt: new Date().toISOString(), invalidates: ['overview', 'graph'], outcomes,
    operation: { id: session, label: 'Clean up stashes and worktrees', status: 'completed',
      message: `${outcomes.filter((outcome) => outcome.status === 'deleted').length} deleted; ${outcomes.filter((outcome) => outcome.status === 'failed').length} failed.` }
  };
}

function parseWorktrees(output: string): WorktreeRecord[] {
  const worktrees: WorktreeRecord[] = [];
  let current: WorktreeRecord | undefined;
  for (const token of output.split('\0')) {
    if (token.startsWith('worktree ')) {
      current = { path: token.slice(9), sha: '', bare: false, locked: false, missing: false };
      worktrees.push(current);
    } else if (current) {
      if (token.startsWith('HEAD ')) current.sha = token.slice(5);
      else if (token.startsWith('branch ')) current.branch = token.slice(7).replace(/^refs\/heads\//, '');
      else if (token === 'bare') current.bare = true;
      else if (token === 'locked' || token.startsWith('locked ')) current.locked = true;
      else if (token === 'prunable' || token.startsWith('prunable ')) current.missing = true;
    }
  }
  return worktrees;
}

async function canonicalPath(path: string): Promise<string> {
  try { return await realpath(path); } catch { return path; }
}

function ageFields(timestamp: number, scannedAt: string, olderThanDays: number): Pick<ArtifactCleanupCandidate, 'date' | 'ageDays' | 'oldEnough'> {
  const ageDays = Number.isFinite(timestamp) && timestamp > 0 ? Math.max(0, (Date.parse(scannedAt) / 1000 - timestamp) / 86400) : undefined;
  return { date: ageDays !== undefined ? new Date(timestamp * 1000).toISOString() : undefined, ageDays,
    oldEnough: ageDays !== undefined && ageDays >= olderThanDays };
}

function stashIndex(id: string): number { return Number(STASH_SELECTOR.exec(id)?.[1]); }
function assertAge(age: number): void {
  if (!Number.isInteger(age) || age < 0 || age > 36500) throw new Error('Age must be a whole number from 0 to 36500 days.');
}
function assertEligible(candidate: ArtifactCleanupCandidate): void {
  if (candidate.protectedReason) throw new Error(`${candidate.name} is protected: ${candidate.protectedReason}.`);
  if (!candidate.oldEnough) throw new Error(`${candidate.name} does not meet the age filter.`);
}
function assertInput(input: ArtifactCleanupInput): void {
  assertAge(input.olderThanDays);
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > MAX_ITEMS) throw new Error(`Select between 1 and ${MAX_ITEMS} items.`);
  const keys = new Set<string>();
  for (const item of input.items) {
    if (!OID.test(item.expectedSha) || typeof item.id !== 'string' || item.id.includes('\0')
      || (item.kind !== 'stash' && item.kind !== 'worktree')
      || (item.kind === 'stash' ? !STASH_SELECTOR.test(item.id) : !isAbsolute(item.id))) throw new Error('Invalid cleanup selection.');
    const key = `${item.kind}:${item.id}`;
    if (keys.has(key)) throw new Error('Duplicate cleanup selections are not allowed.');
    keys.add(key);
  }
}
