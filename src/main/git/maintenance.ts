import { randomUUID } from 'node:crypto';

import type {
  BranchCleanupCandidate,
  BranchCleanupInput,
  BranchCleanupOptions,
  BranchCleanupPlan,
  BranchCleanupResult
} from '@shared/maintenance';
import type { GitOperationResult, RepoTab } from '@shared/types';

import { createProfileCommandEnv } from '../profiles';
import { gitExecutor } from './exec';

type MaintenanceTab = Pick<RepoTab, 'path' | 'assignedProfileId'>;
type RefRecord = { ref: string; sha: string; timestamp: number; upstream: string; symref: string };
const MAX_SCAN_BRANCHES = 1000;
const MAX_DELETE_BRANCHES = 100;
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const MAINLINE = /^(main|master|trunk|develop|development|production|release(?:s)?)(?:\/|$)/i;

export async function analyzeBranchCleanup(
  tab: MaintenanceTab,
  options: BranchCleanupOptions,
  selectedRefs?: ReadonlySet<string>
): Promise<BranchCleanupPlan> {
  assertAge(options.olderThanDays);
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const deadlineAt = Date.now() + 60_000;
  const run = (args: string[], allowedExitCodes?: readonly number[]) => gitExecutor.run(args, {
    cwd: tab.path, env, deadlineAt, allowedExitCodes, maxStdoutBytes: 4 * 1024 * 1024
  });
  const [refOutput, remoteOutput, worktreeOutput, driverOutput, shallowOutput, protectedOutput] = await Promise.all([
    run(['for-each-ref', '--format=%(refname)%00%(objectname)%00%(committerdate:unix)%00%(upstream)%00%(symref)', 'refs/heads/', 'refs/remotes/']),
    run(['remote']),
    run(['worktree', 'list', '--porcelain', '-z']),
    run(['config', '--get-regexp', '^merge[.].*[.]driver$'], [0, 1]),
    run(['rev-parse', '--is-shallow-repository']),
    run(['config', '--get-regexp', '^branch[.].*[.]deletemerged$'], [0, 1])
  ]);
  const refs = parseRefs(refOutput.stdout);
  const refByName = new Map(refs.map((ref) => [ref.ref, ref]));
  const remotes = remoteOutput.stdout.trim().split('\n').filter(Boolean).sort((a, b) => b.length - a.length);
  const remoteDefaults = refs.filter((ref) => ref.symref && remotes.some((remote) => ref.ref === `refs/remotes/${remote}/HEAD`));
  const baseRef = options.baseRef ?? remoteDefaults.find((ref) => ref.ref === 'refs/remotes/origin/HEAD')?.symref
    ?? remoteDefaults[0]?.symref
    ?? ['refs/remotes/origin/main', 'refs/remotes/origin/master', 'refs/heads/main', 'refs/heads/master', 'refs/heads/trunk', 'refs/heads/develop'].find((ref) => refByName.has(ref));
  const base = baseRef ? refByName.get(baseRef) : undefined;
  if (!base || base.symref || !OID.test(base.sha)) {
    throw new Error('Choose an existing local or remote branch to compare against. Repositories without commits cannot be scanned.');
  }
  const baseTree = (await run(['rev-parse', '--verify', `${base.sha}^{tree}`])).stdout.trim();
  const worktreeBranches = new Set(worktreeOutput.stdout.split('\0').filter((token) => token.startsWith('branch ')).map((token) => token.slice(7)));
  const worktreeUpstreams = new Set(refs.filter((ref) => worktreeBranches.has(ref.ref)).map((ref) => ref.upstream).filter(Boolean));
  const defaultBranchNames = new Set(remoteDefaults.map((ref) => remoteBranch(ref.symref, remotes)?.branchName).filter(Boolean));
  const configuredProtections = new Set(protectedOutput.stdout.split('\n').map((line) => /^branch\.(.+)\.deletemerged\s+(false|no|off|0)$/i.exec(line)?.[1]).filter(Boolean));
  const warnings = ['Age is the tip commit date, not the last time someone used the branch. Remote results use local tracking refs; refresh before reviewing remote cleanup.'];
  if (shallowOutput.stdout.trim() === 'true') warnings.push('This is a shallow repository. Missing history can prevent merge detection.');
  const customDrivers = driverOutput.stdout.trim().length > 0;
  if (customDrivers) warnings.push('Content comparison is disabled because custom merge drivers are configured.');
  const allBranches = refs.filter((ref) => !ref.symref && (ref.ref.startsWith('refs/heads/') || remoteBranch(ref.ref, remotes)));
  const candidates = selectedRefs ? allBranches.filter((ref) => selectedRefs.has(ref.ref)) : allBranches.slice(0, MAX_SCAN_BRANCHES);
  if (!selectedRefs && allBranches.length > MAX_SCAN_BRANCHES) warnings.push(`Showing the first ${MAX_SCAN_BRANCHES} branches. Additional branches were not analyzed.`);
  const scannedAt = new Date().toISOString();
  const branches: BranchCleanupCandidate[] = [];
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, async () => {
    while (nextIndex < candidates.length) {
      const ref = candidates[nextIndex++];
      if (!ref) break;
      const remote = remoteBranch(ref.ref, remotes);
      const branchName = remote?.branchName ?? ref.ref.slice('refs/heads/'.length);
      const ageDays = Number.isFinite(ref.timestamp) && ref.timestamp > 0
        ? Math.max(0, (Date.parse(scannedAt) / 1000 - ref.timestamp) / 86400) : undefined;
      let protectedReason: string | undefined;
      if (ref.ref === base.ref) protectedReason = 'Comparison branch';
      else if (MAINLINE.test(branchName) || defaultBranchNames.has(branchName)) protectedReason = 'Mainline or default branch';
      else if (configuredProtections.has(branchName)) protectedReason = 'Protected by branch configuration';
      else if (worktreeBranches.has(ref.ref) || worktreeBranches.has(`refs/heads/${branchName}`) || worktreeUpstreams.has(ref.ref)) protectedReason = 'In use by a worktree';
      else if (remote && !remoteDefaults.some((entry) => entry.ref === `refs/remotes/${remote.remote}/HEAD`)) protectedReason = 'Refresh refs to identify the remote default branch';
      const candidate: BranchCleanupCandidate = {
        ref: ref.ref, name: remote ? `${remote.remote}/${branchName}` : branchName, sha: ref.sha,
        branchName, scope: remote ? 'remote' : 'local', ...(remote ? { remote: remote.remote } : {}),
        ...(ageDays !== undefined ? { ageDays, tipCommittedAt: new Date(ref.timestamp * 1000).toISOString() } : {}),
        oldEnough: ageDays !== undefined && ageDays >= options.olderThanDays,
        evidence: 'unknown', explanation: protectedReason ?? 'Newer than the age filter.', protectedReason,
        upstreamGone: Boolean(ref.upstream && !refByName.has(ref.upstream))
      };
      if (!protectedReason && candidate.oldEnough) {
        try {
          const merged = await run(['merge-base', '--is-ancestor', ref.sha, base.sha], [0, 1]);
          if (merged.exitCode === 0) {
            candidate.evidence = 'merged';
            candidate.explanation = 'The branch tip is an ancestor of the comparison branch.';
          } else {
            const merges = await run(['rev-list', '--count', '--merges', `${base.sha}..${ref.sha}`]);
            const cherry = await run(['cherry', base.sha, ref.sha]);
            const patches = cherry.stdout.trim().split('\n').filter(Boolean);
            if (merges.stdout.trim() === '0' && patches.length > 0 && patches.every((line) => /^- [a-f0-9]+$/.test(line))) {
              candidate.evidence = 'patch-equivalent';
              candidate.explanation = 'Every branch-only commit has an equivalent patch in the comparison history. This can indicate rebase or cherry-pick; whitespace is ignored.';
            } else if (!customDrivers) {
              // merge-tree writes tree objects, but never touches the index,
              // checkout, branch refs, or creates a commit. Conflicts fail closed.
              const merge = await run(['merge-tree', '--write-tree', base.sha, ref.sha], [0, 1, 128, 129]);
              if (merge.exitCode === 0 && merge.stdout.split('\n')[0]?.trim() === baseTree) {
                candidate.evidence = 'content-integrated';
                candidate.explanation = 'Merging this branch would add no changes. This can indicate a squash merge, but does not prove how it was integrated.';
              } else {
                candidate.evidence = merge.exitCode === 128 || merge.exitCode === 129 ? 'unknown' : 'unmerged';
                candidate.explanation = candidate.evidence === 'unknown'
                  ? 'Content comparison is unavailable with this Git version or repository history.'
                  : 'The branch may contain changes that are absent from the comparison branch.';
              }
            } else {
              candidate.explanation = 'No ancestry or patch match; content comparison is disabled for custom merge drivers.';
            }
          }
        } catch {
          candidate.evidence = 'unknown';
          candidate.explanation = 'Merge detection could not complete. Review this branch manually.';
        }
      }
      branches.push(candidate);
    }
  }));
  branches.sort((a, b) => a.scope.localeCompare(b.scope) || a.name.localeCompare(b.name));
  return { repoPath: tab.path, scannedAt, baseRef: base.ref, baseSha: base.sha, olderThanDays: options.olderThanDays, branches, warnings };
}

export async function cleanupBranches(tab: MaintenanceTab, input: BranchCleanupInput): Promise<BranchCleanupResult> {
  assertCleanupInput(input);
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const refs = new Set(input.branches.map((entry) => entry.ref));
  const plan = await analyzeBranchCleanup(tab, input, refs);
  if (plan.baseSha !== input.expectedBaseSha) {
    // Background fetches can advance the comparison branch during review.
    // Accept only preserved history; all selected tips and eligibility are
    // revalidated below against this newer base. Rewrites still need review.
    const advancement = await gitExecutor.run(['merge-base', '--is-ancestor', input.expectedBaseSha, plan.baseSha], {
      cwd: tab.path, env, allowedExitCodes: [0, 1, 128]
    });
    if (advancement.exitCode !== 0) throw new Error('The comparison branch changed and its reviewed history is no longer preserved. Scan again before deleting branches.');
  }
  const selected = input.branches.map((entry) => {
    const branch = plan.branches.find((candidate) => candidate.ref === entry.ref);
    if (!branch || branch.sha !== entry.expectedSha) throw new Error('A selected branch changed or disappeared. Scan again before deleting branches.');
    if (branch.protectedReason) throw new Error(`${branch.name} is protected: ${branch.protectedReason}.`);
    if (!branch.oldEnough) throw new Error(`${branch.name} does not meet the age filter.`);
    if (branch.evidence !== 'merged' && !input.allowUnverified) throw new Error('Acknowledge deletion of branches without confirmed merge ancestry.');
    return branch;
  });
  const session = randomUUID();
  const outcomes: BranchCleanupResult['outcomes'] = [];
  for (const branch of selected) {
    const recoveryRef = `refs/git-gud/cleanup/${session}/${branch.scope}/${branch.name}`;
    let recoverySaved = false;
    try {
      // Recheck checkout protection immediately before ref writes. The common
      // repository transaction prevents competing operations from this app.
      const worktrees = await gitExecutor.run(['worktree', 'list', '--porcelain', '-z'], { cwd: tab.path, env });
      if (worktrees.stdout.split('\0').includes(`branch refs/heads/${branch.branchName}`)) throw new Error('The branch is now in use by a worktree.');
      if (branch.scope === 'remote') {
        await assertRemoteDeletionTarget(tab, branch, env);
      }
      const commands = [
        'start', `verify ${plan.baseRef} ${plan.baseSha}`,
        ...(branch.scope === 'remote' ? [`verify ${branch.ref} ${branch.sha}`] : []),
        `create ${recoveryRef} ${branch.sha}`,
        ...(branch.scope === 'local' ? [`delete ${branch.ref} ${branch.sha}`] : []),
        'prepare', 'commit', ''
      ].join('\n');
      // One atomic transaction both pins the commit and deletes only the
      // reviewed local OID; a concurrent ref update aborts the entire write.
      // Local deletes retain branch configuration for easier recovery.
      await gitExecutor.run(['update-ref', '--stdin'], { cwd: tab.path, env, kind: 'mutation', input: commands });
      recoverySaved = true;
      if (branch.scope === 'remote') {
        await gitExecutor.run([
          'push', '--porcelain', '--no-follow-tags', '--no-mirror', '--recurse-submodules=no',
          `--force-with-lease=refs/heads/${branch.branchName}:${branch.sha}`,
          '--', branch.remote!, `:refs/heads/${branch.branchName}`
        ], { cwd: tab.path, env, kind: 'mutation', cancellable: false, timeoutMs: 60_000 });
      }
      outcomes.push({ ref: branch.ref, status: 'deleted', message: `Deleted ${branch.name}. The reviewed commit is retained locally.`, recoveryRef });
    } catch (error) {
      outcomes.push({ ref: branch.ref, status: 'failed', message: error instanceof Error ? error.message : 'Branch deletion failed.', ...(recoverySaved ? { recoveryRef } : {}) });
    }
  }
  return {
    ...operationResult(tab, 'Clean up branches'), outcomes,
    operation: { id: session, label: 'Clean up branches', status: 'completed', message: `${outcomes.filter((outcome) => outcome.status === 'deleted').length} deleted; ${outcomes.filter((outcome) => outcome.status === 'failed').length} failed.` }
  };
}

export async function refreshMaintenanceRefs(tab: MaintenanceTab): Promise<GitOperationResult> {
  const env = createProfileCommandEnv(tab.assignedProfileId);
  const remotes = (await gitExecutor.run(['remote'], { cwd: tab.path, env })).stdout.trim().split('\n').filter(Boolean);
  for (const remote of remotes) {
    await gitExecutor.run(['check-ref-format', `refs/remotes/${remote}/placeholder`], { cwd: tab.path, env });
    await gitExecutor.run([
      'fetch', '--prune', '--no-prune-tags', '--no-tags', '--no-recurse-submodules', '--refmap=', '--', remote,
      `+refs/heads/*:refs/remotes/${remote}/*`
    ], { cwd: tab.path, env, kind: 'mutation', cancellable: true, timeoutMs: 60_000 });
    const head = await gitExecutor.run(['ls-remote', '--symref', '--', remote, 'HEAD'], { cwd: tab.path, env, timeoutMs: 60_000 });
    const branch = /^ref: refs\/heads\/(.+)\tHEAD$/m.exec(head.stdout)?.[1];
    if (branch) {
      const target = `refs/remotes/${remote}/${branch}`;
      await gitExecutor.run(['show-ref', '--verify', target], { cwd: tab.path, env });
      await gitExecutor.run(['symbolic-ref', `refs/remotes/${remote}/HEAD`, target], { cwd: tab.path, env, kind: 'mutation' });
    }
  }
  return operationResult(tab, 'Refresh branch references');
}

async function assertRemoteDeletionTarget(tab: MaintenanceTab, branch: BranchCleanupCandidate, env: NodeJS.ProcessEnv | undefined): Promise<void> {
  const remote = branch.remote!;
  const [fetchUrls, pushUrls, head] = await Promise.all([
    gitExecutor.run(['remote', 'get-url', '--all', '--', remote], { cwd: tab.path, env }),
    gitExecutor.run(['remote', 'get-url', '--push', '--all', '--', remote], { cwd: tab.path, env }),
    gitExecutor.run(['ls-remote', '--symref', '--', remote, 'HEAD'], { cwd: tab.path, env, timeoutMs: 60_000 })
  ]);
  const fetch = fetchUrls.stdout.trim().split('\n');
  const push = pushUrls.stdout.trim().split('\n');
  if (fetch.length !== 1 || push.length !== 1 || fetch[0] !== push[0]) {
    throw new Error('Remote cleanup requires one matching fetch and push URL. Review this remote manually.');
  }
  const defaultBranch = /^ref: refs\/heads\/(.+)\tHEAD$/m.exec(head.stdout)?.[1];
  if (!defaultBranch) throw new Error('Unable to verify the live remote default branch. No branch was deleted.');
  if (defaultBranch === branch.branchName) throw new Error('The remote default branch is protected.');
}

function parseRefs(output: string): RefRecord[] {
  return output.split('\n').filter(Boolean).map((line) => {
    const [ref = '', sha = '', date = '', upstream = '', symref = ''] = line.split('\0');
    return { ref, sha, timestamp: Number(date), upstream, symref };
  });
}

function remoteBranch(ref: string, remotes: string[]): { remote: string; branchName: string } | undefined {
  const remote = remotes.find((name) => ref.startsWith(`refs/remotes/${name}/`));
  if (!remote) return undefined;
  const branchName = ref.slice(`refs/remotes/${remote}/`.length);
  return branchName && branchName !== 'HEAD' ? { remote, branchName } : undefined;
}

function assertAge(age: number): void {
  if (!Number.isInteger(age) || age < 0 || age > 36500) throw new Error('Branch age must be a whole number from 0 to 36500 days.');
}

function assertCleanupInput(input: BranchCleanupInput): void {
  assertAge(input.olderThanDays);
  if (!input.baseRef.startsWith('refs/heads/') && !input.baseRef.startsWith('refs/remotes/')) throw new Error('Choose a branch comparison reference.');
  if (!OID.test(input.expectedBaseSha) || typeof input.allowUnverified !== 'boolean') throw new Error('Invalid cleanup confirmation.');
  if (!Array.isArray(input.branches) || input.branches.length < 1 || input.branches.length > MAX_DELETE_BRANCHES) throw new Error(`Select between 1 and ${MAX_DELETE_BRANCHES} branches.`);
  if (new Set(input.branches.map((branch) => branch.ref)).size !== input.branches.length) throw new Error('Duplicate branch selections are not allowed.');
  for (const branch of input.branches) {
    if (!OID.test(branch.expectedSha) || /[\s\0]/.test(branch.ref) || (!branch.ref.startsWith('refs/heads/') && !branch.ref.startsWith('refs/remotes/'))) throw new Error('Invalid branch selection.');
  }
}

function operationResult(tab: MaintenanceTab, label: string): GitOperationResult {
  return { repoPath: tab.path, happenedAt: new Date().toISOString(), operation: { id: randomUUID(), label, status: 'completed' }, invalidates: ['overview', 'graph'] };
}
