import { describeWipWorktree } from '@renderer/components/graph/worktreePresentation';
import type { CommitGraphRow, GraphFile, GraphFileStatus, GraphRefChip } from '@shared/types';

export const GRAPH_FILE_STATUS_ORDER = ['modified', 'added', 'deleted'] as const;

export type GraphFileStatusCounts = Record<GraphFileStatus, number>;

export function countGraphFileStatuses(files: readonly GraphFile[]): GraphFileStatusCounts {
  const counts: GraphFileStatusCounts = { modified: 0, added: 0, deleted: 0 };

  for (const file of files) {
    counts[file.status] += 1;
  }

  return counts;
}

export function graphFileStatusCountLabel(status: GraphFileStatus, count: number): string {
  return `${count} ${status} file${count === 1 ? '' : 's'}`;
}

export function isGraphBranchCheckedOut(
  ref: Pick<GraphRefChip, 'current' | 'kind' | 'label'>,
  linkedWorktreeBranches: ReadonlySet<string>
): boolean {
  return ref.kind === 'branch' && (Boolean(ref.current) || linkedWorktreeBranches.has(ref.label));
}

export function graphRowAriaLabel(row: CommitGraphRow): string {
  if (row.node.kind === 'wip') {
    const identity = row.worktree
      ? describeWipWorktree(row.worktree).identity
      : 'working directory';
    const counts = countGraphFileStatuses(row.files);
    const statusSummary = GRAPH_FILE_STATUS_ORDER.flatMap((status) =>
      counts[status] > 0 ? graphFileStatusCountLabel(status, counts[status]) : []
    );

    return [identity, ...statusSummary].join(', ');
  }

  const refs = row.refs?.map((ref) => ref.label).join(', ');
  return [row.subject, row.author.name, row.dateLabel, row.sha.slice(0, 7), refs]
    .filter(Boolean)
    .join(', ');
}
