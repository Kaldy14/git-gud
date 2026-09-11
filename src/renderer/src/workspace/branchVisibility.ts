import { buildCommitGraphRows, type GraphCommitInput } from '@shared/graph';
import type { CommitGraphRow, GitRefsSummary } from '@shared/types';

export type BranchVisibilityMode = 'solo' | 'hidden';

export type BranchVisibilityTarget = {
  scope: 'local' | 'remote';
  kind: 'branch' | 'folder';
  path: string;
};

export type BranchVisibilityState = {
  solo: BranchVisibilityTarget[];
  hidden: BranchVisibilityTarget[];
};

export const EMPTY_BRANCH_VISIBILITY: BranchVisibilityState = {
  solo: [],
  hidden: []
};

export function toggleBranchVisibility(
  state: BranchVisibilityState,
  mode: BranchVisibilityMode,
  target: BranchVisibilityTarget
): BranchVisibilityState {
  const otherMode: BranchVisibilityMode = mode === 'solo' ? 'hidden' : 'solo';
  const isActive = state[mode].some((candidate) => sameTarget(candidate, target));

  return {
    ...state,
    [mode]: isActive
      ? state[mode].filter((candidate) => !sameTarget(candidate, target))
      : [...state[mode], target],
    [otherMode]: state[otherMode].filter((candidate) => !sameTarget(candidate, target))
  };
}

export function isBranchVisibilityTargetActive(
  state: BranchVisibilityState,
  mode: BranchVisibilityMode,
  target: BranchVisibilityTarget
): boolean {
  return state[mode].some((candidate) => sameTarget(candidate, target));
}

export function branchVisibilityModeForRef(
  state: BranchVisibilityState,
  scope: BranchVisibilityTarget['scope'],
  branchName: string
): BranchVisibilityMode | undefined {
  if (state.hidden.some((target) => targetMatchesBranch(target, scope, branchName))) {
    return 'hidden';
  }

  return state.solo.some((target) => targetMatchesBranch(target, scope, branchName))
    ? 'solo'
    : undefined;
}

export function filterGraphRowsByBranchVisibility(
  rows: readonly CommitGraphRow[],
  refs: GitRefsSummary,
  state: BranchVisibilityState
): CommitGraphRow[] {
  if (state.solo.length === 0 && state.hidden.length === 0) {
    return rows as CommitGraphRow[];
  }

  const soloRefs = matchingRefs(refs, state.solo);
  const hiddenRefs = matchingRefs(refs, state.hidden);
  const visibleBranchRefs = new Set<string>();
  const allBranchRefs = branchRefs(refs);

  for (const ref of state.solo.length > 0 ? soloRefs : allBranchRefs) {
    if (!hiddenRefs.has(ref)) {
      visibleBranchRefs.add(ref);
    }
  }

  const rowsBySha = new Map(rows.map((row) => [row.sha, row]));
  const rootShas = new Set<string>();

  for (const branch of refs.localBranches) {
    if (visibleBranchRefs.has(refKey('local', branch.name))) {
      rootShas.add(branch.sha);
    }
  }

  for (const branch of refs.remoteBranches) {
    if (visibleBranchRefs.has(refKey('remote', branch.name))) {
      rootShas.add(branch.sha);
    }
  }

  if (state.solo.length === 0) {
    for (const tag of refs.tags) {
      rootShas.add(tag.sha);
    }
  }

  for (const row of rows) {
    if (row.node.kind === 'stash' && state.solo.length === 0) {
      rootShas.add(row.sha);
      continue;
    }

    if (row.node.kind !== 'wip') {
      continue;
    }

    const branch = row.worktree?.branch;
    if (branch ? visibleBranchRefs.has(refKey('local', branch)) : state.solo.length === 0) {
      rootShas.add(row.sha);
    }
  }

  const visibleShas = reachableShas(rootShas, rowsBySha);
  const filteredInputs = rows
    .filter((row) => visibleShas.has(row.sha))
    .map((row) => rowToGraphInput(row, visibleBranchRefs));

  return buildCommitGraphRows(filteredInputs);
}

function matchingRefs(
  refs: GitRefsSummary,
  targets: readonly BranchVisibilityTarget[]
): Set<string> {
  const matches = new Set<string>();

  for (const branch of refs.localBranches) {
    if (targets.some((target) => targetMatchesBranch(target, 'local', branch.name))) {
      matches.add(refKey('local', branch.name));
    }
  }

  for (const branch of refs.remoteBranches) {
    if (targets.some((target) => targetMatchesBranch(target, 'remote', branch.name))) {
      matches.add(refKey('remote', branch.name));
    }
  }

  return matches;
}

function branchRefs(refs: GitRefsSummary): Set<string> {
  return new Set([
    ...refs.localBranches.map((branch) => refKey('local', branch.name)),
    ...refs.remoteBranches.map((branch) => refKey('remote', branch.name))
  ]);
}

function refKey(scope: BranchVisibilityTarget['scope'], branchName: string): string {
  return `${scope}:${branchName}`;
}

function targetMatchesBranch(
  target: BranchVisibilityTarget,
  scope: BranchVisibilityTarget['scope'],
  branchName: string
): boolean {
  return (
    target.scope === scope &&
    (target.kind === 'branch'
      ? target.path === branchName
      : branchName.startsWith(`${target.path}/`))
  );
}

function sameTarget(left: BranchVisibilityTarget, right: BranchVisibilityTarget): boolean {
  return left.scope === right.scope && left.kind === right.kind && left.path === right.path;
}

function reachableShas(
  rootShas: ReadonlySet<string>,
  rowsBySha: ReadonlyMap<string, CommitGraphRow>
): Set<string> {
  const reachable = new Set<string>();
  const pending = [...rootShas];

  while (pending.length > 0) {
    const sha = pending.pop();

    if (!sha || reachable.has(sha)) {
      continue;
    }

    const row = rowsBySha.get(sha);
    if (!row) {
      continue;
    }

    reachable.add(sha);
    pending.push(...row.parentShas);
  }

  return reachable;
}

function rowToGraphInput(
  row: CommitGraphRow,
  visibleBranchRefs: ReadonlySet<string>
): GraphCommitInput {
  return {
    sha: row.sha,
    parentShas: row.parentShas,
    subject: row.subject,
    body: row.body,
    authorName: row.author.name,
    authorEmail: row.author.email,
    authorAvatarUrl: row.author.avatarUrl,
    authorAvatarFallbackUrl: row.author.fallbackAvatarUrl,
    authoredAt: row.authoredAt,
    committedAt: row.committedAt,
    dateLabel: row.dateLabel,
    kind: row.node.kind,
    refs: row.refs?.filter(
      (ref) =>
        (ref.kind !== 'branch' && ref.kind !== 'remote') ||
        visibleBranchRefs.has(refKey(ref.kind === 'branch' ? 'local' : 'remote', ref.label))
    ),
    worktree: row.worktree,
    colorOverride: row.colorOverride,
    files: row.files
  };
}
