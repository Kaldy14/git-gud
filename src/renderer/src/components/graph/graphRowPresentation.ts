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

/** The main process tags working-copy rows with an error red. Uncommitted work is not an error. */
const WORKING_COPY_TAG_COLOR = '#bc271b';
const WORKING_COPY_COLOR = '#aeb4bf';
const DARK_TEXT = '#101317';
const LIGHT_TEXT = '#ffffff';

export function graphOverrideColor(color: string | undefined): string | undefined {
  return color === WORKING_COPY_TAG_COLOR ? WORKING_COPY_COLOR : color;
}

/** Picks whichever of the dark or light text colors contrasts more with a hex background. */
export function readableTextOn(background: string): string {
  const luminance = relativeLuminance(background);

  if (luminance === undefined) {
    return LIGHT_TEXT;
  }

  const onDark = (relativeLuminance(LIGHT_TEXT)! + 0.05) / (luminance + 0.05);
  const onLight = (luminance + 0.05) / (relativeLuminance(DARK_TEXT)! + 0.05);

  return onLight > onDark ? DARK_TEXT : LIGHT_TEXT;
}

function relativeLuminance(hex: string): number | undefined {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim());

  if (!match) {
    return undefined;
  }

  const [red, green, blue] = match.slice(1).map((channel) => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export type GraphBranchCheckoutLocation = 'current' | 'linked-worktree';

export function graphBranchCheckoutLocation(
  ref: Pick<GraphRefChip, 'current' | 'kind' | 'label'>,
  linkedWorktreeBranches: ReadonlySet<string>
): GraphBranchCheckoutLocation | undefined {
  if (ref.kind !== 'branch') {
    return undefined;
  }

  if (ref.current) {
    return 'current';
  }

  return linkedWorktreeBranches.has(ref.label) ? 'linked-worktree' : undefined;
}

export function graphRowAriaLabel(row: CommitGraphRow): string {
  if (row.node.kind === 'wip') {
    const identity = row.machineWip
      ? `${row.machineWip.name} working directory, read-only${row.machineWip.stale ? ', unreachable' : ''}`
      : row.worktree
        ? describeWipWorktree(row.worktree).identity
        : 'working directory';
    const counts = countGraphFileStatuses(row.files);
    const statusSummary = GRAPH_FILE_STATUS_ORDER.flatMap((status) =>
      counts[status] > 0 ? graphFileStatusCountLabel(status, counts[status]) : []
    );

    return [identity, ...statusSummary].join(', ');
  }

  const refs = row.refs?.map((ref) => ref.machine ? `${ref.label} on ${ref.machine.name}` : ref.label).join(', ');
  const unpushed = row.unpushedOn ? `only on ${row.unpushedOn.map((machine) => machine.name).join(', ')}` : undefined;
  return [row.subject, row.author.name, row.dateLabel, row.sha.slice(0, 7), refs, unpushed]
    .filter(Boolean)
    .join(', ');
}
