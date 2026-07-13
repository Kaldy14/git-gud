import type { CommitGraphRow, GraphRefChip } from '@shared/types';

export type RefClickState = {
  key: string;
  clickedAt: number;
};

export type RefClickResult = {
  activate: boolean;
  nextState?: RefClickState;
};

const REF_DOUBLE_CLICK_WINDOW_MS = 500;

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
