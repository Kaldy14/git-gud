import { MAX_GRAPH_PAGE_SIZE } from '@shared/settings';
import type { CommitGraphAvatarCandidate, CommitGraphPage, CommitGraphRow } from '@shared/types';

/** First page for a repository without cached history, small enough to paint immediately. */
export const INITIAL_COMMIT_GRAPH_LIMIT = 50;

export function initialCommitGraphLimit(pageSize: number): number {
  return Math.min(INITIAL_COMMIT_GRAPH_LIMIT, pageSize, MAX_GRAPH_PAGE_SIZE);
}

/**
 * Grows the graph to the next configured page boundary, so a 50-commit first page
 * is followed by exactly one configured page instead of an off-by-50 limit.
 */
export function nextCommitGraphLimit(loadedLimit: number, pageSize: number): number {
  const step = Math.max(1, Math.floor(pageSize));

  return Math.min(MAX_GRAPH_PAGE_SIZE, (Math.floor(loadedLimit / step) + 1) * step);
}

export function canLoadMoreCommitGraph(page: CommitGraphPage | undefined): boolean {
  return Boolean(page?.hasMore && page.limit < MAX_GRAPH_PAGE_SIZE);
}

export function commitGraphAvatarCandidates(rows: readonly CommitGraphRow[]): CommitGraphAvatarCandidate[] {
  const candidatesByEmail = new Map<string, CommitGraphAvatarCandidate>();

  for (const row of rows) {
    if (row.node.kind !== 'commit' && row.node.kind !== 'merge') continue;
    const email = normalizeAvatarEmail(row.author.email);
    if (!email) continue;
    const hasRemoteRef = Boolean(row.refs?.some((ref) => ref.kind === 'remote'));
    const existing = candidatesByEmail.get(email);

    if (!existing || (hasRemoteRef && !existing.hasRemoteRef)) {
      candidatesByEmail.set(email, { sha: row.sha, email, hasRemoteRef });
    }
  }

  const candidates = [...candidatesByEmail.values()];

  return [
    ...candidates.filter((candidate) => candidate.hasRemoteRef),
    ...candidates.filter((candidate) => !candidate.hasRemoteRef)
  ];
}

export function commitGraphAvatarSignature(candidates: readonly CommitGraphAvatarCandidate[]): string {
  return candidates.map((candidate) => candidate.email ?? '').sort().join('\n');
}

export function mergeCommitGraphAvatarUrls(
  page: CommitGraphPage,
  avatarUrls: Readonly<Record<string, string>> | undefined
): CommitGraphPage {
  if (!avatarUrls) return page;
  let changed = false;
  const rows = page.rows.map((row) => {
    const email = normalizeAvatarEmail(row.author.email);
    const avatarUrl = email ? avatarUrls[email] : undefined;

    if (!avatarUrl || avatarUrl === row.author.avatarUrl) return row;
    changed = true;

    return {
      ...row,
      author: {
        ...row.author,
        avatarUrl,
        fallbackAvatarUrl: row.author.fallbackAvatarUrl ?? row.author.avatarUrl
      }
    };
  });

  return changed ? { ...page, rows } : page;
}

function normalizeAvatarEmail(email: string | undefined): string | undefined {
  const normalized = email?.trim().toLowerCase();

  return normalized || undefined;
}
