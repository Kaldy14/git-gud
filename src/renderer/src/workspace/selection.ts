import { laneColor } from '@shared/graph';
import type { CommitGraphRow, GitStatusCode, GitStatusSummary, GraphFileStatus } from '@shared/types';

export function syncWipGraphRow(
  rows: CommitGraphRow[],
  status: GitStatusSummary | undefined
): CommitGraphRow[] {
  if (!status || !rows.some((row) => row.node.kind === 'wip')) {
    return rows;
  }

  return rows.map((row) =>
    row.node.kind === 'wip'
      ? {
          ...row,
          parentShas: status.branch.oid ? [status.branch.oid] : [],
          files: status.files
            .filter((file) => file.status !== 'ignored')
            .map((file) => ({ path: file.path, status: graphFileStatus(file.status) }))
        }
      : row
  );
}

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

function graphFileStatus(status: GitStatusCode): GraphFileStatus {
  if (status === 'added' || status === 'untracked' || status === 'copied') {
    return 'added';
  }

  return status === 'deleted' ? 'deleted' : 'modified';
}
