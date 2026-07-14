import type { CommitGraphRow, GraphRefChip } from '@shared/types';

import { branchNameFromRemoteRef } from './refPresentation';

export type RefClickState = {
  key: string;
  clickedAt: number;
};

export type RefClickResult = {
  activate: boolean;
  nextState?: RefClickState;
};

const REF_DOUBLE_CLICK_WINDOW_MS = 500;

export type BulkSquashSelection =
  | {
      canSquash: true;
      baseSha: string;
      squashShas: string[];
    }
  | {
      canSquash: false;
      reason: string;
    };

export function findCurrentBranchName(rows: CommitGraphRow[]): string | undefined {
  for (const row of rows) {
    const currentBranch = row.refs?.find((ref) => ref.kind === 'branch' && ref.current);

    if (currentBranch) {
      return currentBranch.label;
    }
  }

  return undefined;
}

export function findSelectedContextMenuRow(
  rows: CommitGraphRow[],
  selectedSha: string | undefined
): CommitGraphRow | undefined {
  if (!selectedSha) {
    return undefined;
  }

  return rows.find((row) => row.sha === selectedSha);
}

export function registerRefClick(
  previous: RefClickState | undefined,
  ref: Pick<GraphRefChip, 'kind' | 'label'>,
  clickedAt: number
): RefClickResult {
  const key = `${ref.kind}:${ref.label}`;

  if (previous?.key === key && clickedAt - previous.clickedAt <= REF_DOUBLE_CLICK_WINDOW_MS) {
    return { activate: true };
  }

  return { activate: false, nextState: { key, clickedAt } };
}

export function toggleSelectedCommit(selectedShas: readonly string[], sha: string): string[] {
  return selectedShas.includes(sha)
    ? selectedShas.filter((selectedSha) => selectedSha !== sha)
    : [...selectedShas, sha];
}

export function orderSelectedCommitsForCherryPick(
  rows: CommitGraphRow[],
  selectedShas: readonly string[]
): string[] {
  const selection = new Set(selectedShas);
  return rows
    .filter((row) => selection.has(row.sha) && isCommit(row))
    .map((row) => row.sha)
    .reverse();
}

export function resolveBulkSquashSelection(
  rows: CommitGraphRow[],
  selectedShas: readonly string[]
): BulkSquashSelection {
  const selection = new Set(selectedShas);

  if (selection.size < 2) {
    return { canSquash: false, reason: 'Select at least two commits to squash.' };
  }

  const selectedRows = rows.filter((row) => selection.has(row.sha) && isCommit(row));

  if (selectedRows.length !== selection.size) {
    return { canSquash: false, reason: 'Only commits can be squashed.' };
  }

  const currentBranchTip = rows.find((row) =>
    row.refs?.some((ref) => ref.kind === 'branch' && ref.current)
  );

  if (!currentBranchTip) {
    return { canSquash: false, reason: 'Squash requires a checked-out branch.' };
  }

  const rowsBySha = new Map(rows.map((row) => [row.sha, row]));
  const firstParentChain: CommitGraphRow[] = [];
  const visited = new Set<string>();
  let currentRow: CommitGraphRow | undefined = currentBranchTip;

  while (currentRow && !visited.has(currentRow.sha)) {
    firstParentChain.push(currentRow);
    visited.add(currentRow.sha);
    currentRow = rowsBySha.get(currentRow.parentShas[0] ?? '');
  }

  const selectedIndices = selectedRows.map((row) => firstParentChain.findIndex((candidate) => candidate.sha === row.sha));

  if (selectedIndices.some((index) => index === -1)) {
    return { canSquash: false, reason: 'Selected commits must be on the checked-out branch.' };
  }

  const newestIndex = Math.min(...selectedIndices);
  const oldestIndex = Math.max(...selectedIndices);

  if (oldestIndex - newestIndex + 1 !== selectedIndices.length) {
    return { canSquash: false, reason: 'Selected commits must be contiguous.' };
  }

  if (firstParentChain.slice(0, oldestIndex + 1).some((row) => row.parentShas.length > 1)) {
    return { canSquash: false, reason: 'Squash is only available on linear history.' };
  }

  const oldestSelectedRow = firstParentChain[oldestIndex];
  const baseSha = oldestSelectedRow?.parentShas[0];

  if (!baseSha) {
    return { canSquash: false, reason: 'The root commit cannot be included in this squash.' };
  }

  const selectedOldestToNewest = selectedIndices
    .slice()
    .sort((left, right) => right - left)
    .map((index) => firstParentChain[index]?.sha)
    .filter((sha): sha is string => Boolean(sha));

  return {
    canSquash: true,
    baseSha,
    squashShas: selectedOldestToNewest.slice(1)
  };
}

export function preferredBranchName(row: CommitGraphRow): string | undefined {
  const refs = row.refs ?? [];
  const localBranch =
    refs.find((ref) => ref.kind === 'branch' && ref.current) ??
    refs.find((ref) => ref.kind === 'branch');

  if (localBranch) {
    return localBranch.label;
  }

  const remoteBranch = refs.find((ref) => ref.kind === 'remote');
  return remoteBranch ? branchNameFromRemoteRef(remoteBranch.label) : undefined;
}

function isCommit(row: CommitGraphRow): boolean {
  return row.node.kind !== 'wip' && row.node.kind !== 'stash';
}
