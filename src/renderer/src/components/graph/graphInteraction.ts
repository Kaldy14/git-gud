import type { CommitGraphRow } from '@shared/types';

export function findSelectedContextMenuRow(
  rows: CommitGraphRow[],
  selectedSha: string | undefined
): CommitGraphRow | undefined {
  if (!selectedSha) {
    return undefined;
  }

  return rows.find((row) => row.sha === selectedSha);
}
