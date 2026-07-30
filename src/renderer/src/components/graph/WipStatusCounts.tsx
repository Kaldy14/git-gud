import type { ReactElement } from 'react';
import { Minus, Pencil, Plus } from 'lucide-react';

import {
  countGraphFileStatuses,
  graphFileStatusCountLabel,
  GRAPH_FILE_STATUS_ORDER
} from '@renderer/components/graph/graphRowPresentation';
import { FILE_STATUS_COLORS } from '@shared/graph';
import type { GraphFile, GraphFileStatus } from '@shared/types';

export function WipStatusCounts({ files }: { files: readonly GraphFile[] }): ReactElement {
  const counts = countGraphFileStatuses(files);

  return (
    <span className="flex shrink-0 items-center gap-2.5 text-[13px] font-semibold leading-none tabular-nums">
      {GRAPH_FILE_STATUS_ORDER.map((status) => (
        <WipStatusCount key={status} status={status} count={counts[status]} />
      ))}
    </span>
  );
}

function WipStatusCount({
  status,
  count
}: {
  status: GraphFileStatus;
  count: number;
}): ReactElement | null {
  if (count === 0) {
    return null;
  }

  const label = graphFileStatusCountLabel(status, count);
  const Icon = status === 'modified' ? Pencil : status === 'added' ? Plus : Minus;

  return (
    <span className="flex items-center gap-1" aria-label={label} title={label}>
      <Icon size={12} aria-hidden="true" style={{ color: FILE_STATUS_COLORS[status] }} />
      <span className="text-[var(--text-1)]">{count}</span>
    </span>
  );
}
