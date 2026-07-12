import { laneColor } from '@shared/graph';
import type { CommitGraphRow } from '@shared/types';

export function resolveSelectedGraphRow(
  rows: CommitGraphRow[],
  selectedSha: string | undefined
): CommitGraphRow | undefined {
  const selectedRow = selectedSha ? rows.find((row) => row.sha === selectedSha) : undefined;

  if (selectedRow) {
    return selectedRow;
  }

  if (!selectedSha || selectedSha === 'wip') {
    return rows[0];
  }

  const color = laneColor(0);
  return {
    sha: selectedSha,
    parentShas: [],
    subject: 'Loading selected commit...',
    author: {
      name: 'Unknown author',
      initials: '?',
      color
    },
    dateLabel: '',
    node: {
      lane: 0,
      kind: 'commit'
    },
    rails: [],
    files: []
  };
}
