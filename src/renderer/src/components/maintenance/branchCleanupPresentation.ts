import type { BranchCleanupCandidate } from '@shared/maintenance';

export const MAX_AGE_DAYS = 36500;
/** Matches the per-cleanup limit enforced by the main process. */
export const MAX_CLEANUP_BRANCHES = 100;

/** Protected and recent branches are never analyzed for merge evidence. */
export function isAnalyzed(candidate: Pick<BranchCleanupCandidate, 'protectedReason' | 'oldEnough'>): boolean {
  return !candidate.protectedReason && candidate.oldEnough;
}

/**
 * Adds refs in order until the selection reaches `limit`. Returns the next
 * selection and how many refs did not fit.
 */
export function addWithinLimit(
  current: ReadonlySet<string>,
  refs: readonly string[],
  limit = MAX_CLEANUP_BRANCHES
): { next: Set<string>; skipped: number } {
  const next = new Set(current);
  let skipped = 0;

  for (const ref of refs) {
    if (next.has(ref)) {
      continue;
    }

    if (next.size >= limit) {
      skipped += 1;
      continue;
    }

    next.add(ref);
  }

  return { next, skipped };
}

export function shortRefName(ref: string): string {
  return ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\//, '');
}

export function parseAgeDays(text: string): number | undefined {
  const trimmed = text.trim();

  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }

  const value = Number(trimmed);
  return value <= MAX_AGE_DAYS ? value : undefined;
}

export function formatAge(ageDays: number | undefined): string {
  if (ageDays === undefined) {
    return 'Unknown';
  }

  if (ageDays < 1) {
    return 'Today';
  }

  if (ageDays < 60) {
    return `${Math.floor(ageDays)} d`;
  }

  if (ageDays < 730) {
    return `${Math.floor(ageDays / 30)} mo`;
  }

  return `${Math.floor(ageDays / 365)} y`;
}

/** POSIX single-quote a shell argument. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Builds a copyable command that recreates a deleted branch from its recovery
 * ref. Neither form overwrites a branch that already exists: `git branch`
 * refuses existing names, and the remote push leases on the branch being absent.
 */
export function buildRestoreCommand(candidate: BranchCleanupCandidate, recoveryRef: string): string {
  if (candidate.scope === 'remote') {
    const remote = candidate.remote ?? 'origin';
    const target = `refs/heads/${candidate.branchName}`;
    return [
      'git push --no-mirror --no-follow-tags --recurse-submodules=no',
      shellQuote(`--force-with-lease=${target}:`),
      '--',
      shellQuote(remote),
      shellQuote(`${recoveryRef}:${target}`)
    ].join(' ');
  }

  return `git branch -- ${shellQuote(candidate.branchName)} ${shellQuote(recoveryRef)}`;
}
