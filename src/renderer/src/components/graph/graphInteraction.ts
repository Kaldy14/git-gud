import type { CommitGraphRow } from '@shared/types';

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
