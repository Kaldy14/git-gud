import type { MouseEvent, ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Cloud, Copy, GitBranch, GitCommit, GitMerge, Loader2, Pencil, RefreshCw, Tag, Workflow } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { laneColor } from '@shared/graph';
import type { CommitGraphRow, GraphRailSegment, RefChipKind } from '@shared/types';

const ROW_HEIGHT = 32;
const LANE_X0 = 14;
const LANE_GAP = 18;
const MIN_GRAPH_CELL_WIDTH = 96;

type GraphViewProps = {
  rows: CommitGraphRow[];
  selectedSha?: string;
  isLoading: boolean;
  isFetching: boolean;
  errorMessage?: string;
  hasMore: boolean;
  onSelectRow: (sha: string) => void;
  onLoadMore: () => void;
};

type ContextMenuState = {
  row: CommitGraphRow;
  x: number;
  y: number;
};

export function GraphView({
  rows,
  selectedSha,
  isLoading,
  isFetching,
  errorMessage,
  hasMore,
  onSelectRow,
  onLoadMore
}: GraphViewProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>();
  const graphWidth = useMemo(() => graphCellWidth(rows), [rows]);
  const gridTemplateColumns = `178px ${graphWidth}px minmax(0, 1fr)`;
  // TanStack Virtual is the row windowing layer for M2; the virtualizer stays local to this component.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 24
  });

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setContextMenu(undefined);
      }
    }

    function handleClick(): void {
      setContextMenu(undefined);
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('click', handleClick);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('click', handleClick);
    };
  }, [contextMenu]);

  function handleContextMenu(event: MouseEvent<HTMLDivElement>, row: CommitGraphRow): void {
    event.preventDefault();
    onSelectRow(row.sha);
    setContextMenu({
      row,
      x: event.clientX,
      y: event.clientY
    });
  }

  return (
    <section className="relative flex min-w-0 flex-col overflow-hidden bg-[var(--bg-graph)]">
      <div
        className="grid h-8 shrink-0 items-center border-b border-[var(--border)] bg-[var(--bg-graph-header)] pr-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-3)]"
        style={{ gridTemplateColumns }}
      >
        <span className="pl-3">Branch / Tag</span>
        <span className="pl-1">Graph</span>
        <span className="flex items-center justify-between">
          <span>Commit message</span>
          <span className="flex items-center gap-2">
            {isFetching && rows.length > 0 ? <Loader2 size={13} className="animate-spin text-[var(--text-3)]" /> : null}
            <Workflow size={13} className="text-[var(--text-3)]" />
          </span>
        </span>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && rows.length === 0 ? (
          <GraphMessage icon={<Loader2 size={15} className="animate-spin" />} label="Loading commit graph..." />
        ) : errorMessage ? (
          <GraphMessage icon={<RefreshCw size={15} />} label={errorMessage} />
        ) : rows.length === 0 ? (
          <GraphMessage icon={<GitCommit size={15} />} label="No commits found." />
        ) : (
          <>
            <div className="relative" style={{ height: rowVirtualizer.getTotalSize() }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index];

                if (!row) {
                  return null;
                }

                return (
                  <div
                    key={row.sha}
                    className="absolute left-0 top-0 w-full"
                    style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <GraphRowView
                      row={row}
                      graphWidth={graphWidth}
                      gridTemplateColumns={gridTemplateColumns}
                      isSelected={row.sha === selectedSha}
                      onSelect={() => onSelectRow(row.sha)}
                      onContextMenu={(event) => handleContextMenu(event, row)}
                    />
                  </div>
                );
              })}
            </div>
            {hasMore ? (
              <div className="flex justify-center border-t border-[var(--border)] px-3 py-3">
                <button className="btn-accent h-8 text-xs" type="button" onClick={onLoadMore} disabled={isFetching}>
                  {isFetching ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  <span>Load more</span>
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {contextMenu ? <GraphContextMenu state={contextMenu} onClose={() => setContextMenu(undefined)} /> : null}
    </section>
  );
}

type GraphRowViewProps = {
  row: CommitGraphRow;
  graphWidth: number;
  gridTemplateColumns: string;
  isSelected: boolean;
  onSelect: () => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
};

function GraphRowView({
  row,
  graphWidth,
  gridTemplateColumns,
  isSelected,
  onSelect,
  onContextMenu
}: GraphRowViewProps): ReactElement {
  const nodeColor = row.colorOverride ?? laneColor(row.node.lane);
  const isWip = row.node.kind === 'wip';

  return (
    <div
      className="group relative grid cursor-pointer items-center"
      style={{
        height: ROW_HEIGHT,
        gridTemplateColumns,
        background: isSelected ? 'var(--select-bg)' : `${nodeColor}0d`,
        boxShadow: isSelected ? 'inset 0 0 0 1px var(--select-border)' : undefined
      }}
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      {!isSelected ? (
        <div
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
          style={{ background: 'rgba(255,255,255,0.03)' }}
        />
      ) : null}

      <div className="flex min-w-0 items-center justify-end gap-1 pl-2 pr-1.5">
        {row.refs?.map((ref) => <RefChipView key={`${ref.kind}:${ref.label}`} label={ref.label} kind={ref.kind} color={nodeColor} />)}
      </div>

      <RailCell row={row} nodeColor={nodeColor} graphWidth={graphWidth} />

      <div className="relative flex min-w-0 items-center gap-2.5 pr-3">
        <span
          className="h-4 w-[2.5px] shrink-0 rounded-full"
          style={{ background: nodeColor, opacity: isWip ? 0.4 : 0.9 }}
        />
        <span
          className={
            isWip
              ? 'min-w-0 truncate text-[12.5px] italic text-[var(--text-3)]'
              : row.node.kind === 'merge'
                ? 'min-w-0 truncate text-[12.5px] text-[var(--text-2)]'
                : 'min-w-0 truncate text-[12.5px] text-[var(--text-1)]'
          }
        >
          {row.subject}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-[var(--text-3)]">{row.dateLabel}</span>
        {row.dateMarker ? (
          <span className="pointer-events-none absolute -top-2 right-3 z-10 rounded border border-[var(--border)] bg-[var(--bg-graph)] px-1.5 py-px text-[10px] leading-4 text-[var(--text-3)]">
            {row.dateMarker}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function RefChipView({ label, kind, color }: { label: string; kind: RefChipKind; color: string }): ReactElement {
  const icon =
    kind === 'branch' ? (
      <GitBranch size={10} />
    ) : kind === 'remote' ? (
      <Cloud size={10} />
    ) : kind === 'tag' ? (
      <Tag size={10} />
    ) : kind === 'stash' ? (
      <Archive size={10} />
    ) : (
      <Pencil size={10} />
    );

  return (
    <span
      className="ref-chip"
      style={{ background: `${color}24`, borderColor: `${color}59`, color }}
      title={label}
    >
      {icon}
      <span>{label}</span>
    </span>
  );
}

function RailCell({
  row,
  nodeColor,
  graphWidth
}: {
  row: CommitGraphRow;
  nodeColor: string;
  graphWidth: number;
}): ReactElement {
  const h = ROW_HEIGHT;
  const mid = h / 2;

  return (
    <svg
      width={graphWidth}
      height={h}
      viewBox={`0 0 ${graphWidth} ${h}`}
      className="shrink-0"
      aria-hidden="true"
    >
      {row.rails.map((segment, index) => (
        <RailSegmentPath key={index} segment={segment} row={row} height={h} />
      ))}
      <GraphNode
        kind={row.node.kind}
        cx={laneX(row.node.lane)}
        cy={mid}
        color={nodeColor}
        authorColor={row.author.color}
        initials={row.author.initials}
      />
    </svg>
  );
}

function laneX(lane: number): number {
  return LANE_X0 + lane * LANE_GAP;
}

function RailSegmentPath({ segment, row, height }: { segment: GraphRailSegment; row: CommitGraphRow; height: number }): ReactElement {
  const mid = height / 2;
  const isNodeSegment =
    (segment.type === 'stopTop' || segment.type === 'startBottom') && segment.lane === row.node.lane;
  const overrideColor = isNodeSegment ? row.colorOverride : undefined;
  const dashed = Boolean(overrideColor) || (segment.type === 'curveOut' && Boolean(row.colorOverride));

  let d: string;
  let color: string;

  switch (segment.type) {
    case 'through': {
      const x = laneX(segment.lane);
      d = `M ${x} 0 V ${height}`;
      color = laneColor(segment.lane);
      break;
    }
    case 'stopTop': {
      const x = laneX(segment.lane);
      d = `M ${x} 0 V ${mid}`;
      color = overrideColor ?? laneColor(segment.lane);
      break;
    }
    case 'startBottom': {
      const x = laneX(segment.lane);
      d = `M ${x} ${mid} V ${height}`;
      color = overrideColor ?? laneColor(segment.lane);
      break;
    }
    case 'curveIn': {
      const xf = laneX(segment.from);
      const xt = laneX(segment.to);
      d = `M ${xf} 0 C ${xf} ${mid / 2} ${xt} ${mid / 2} ${xt} ${mid}`;
      color = laneColor(segment.from);
      break;
    }
    case 'curveOut': {
      const xf = laneX(segment.from);
      const xt = laneX(segment.to);
      d = `M ${xf} ${mid} C ${xf} ${mid + mid / 2} ${xt} ${mid + mid / 2} ${xt} ${height}`;
      color = row.colorOverride ?? laneColor(segment.to);
      break;
    }
  }

  return <path d={d} fill="none" stroke={color} strokeWidth={2} strokeDasharray={dashed ? '3 3' : undefined} />;
}

type GraphNodeProps = {
  kind: CommitGraphRow['node']['kind'];
  cx: number;
  cy: number;
  color: string;
  authorColor: string;
  initials: string;
};

function GraphNode({ kind, cx, cy, color, authorColor, initials }: GraphNodeProps): ReactElement {
  if (kind === 'merge') {
    return (
      <g>
        <circle cx={cx} cy={cy} r={6} fill="var(--bg-graph)" />
        <circle cx={cx} cy={cy} r={4.5} fill={color} />
      </g>
    );
  }

  if (kind === 'stash') {
    return (
      <g>
        <rect x={cx - 7} y={cy - 7} width={14} height={14} rx={3.5} fill="var(--bg-graph)" stroke={color} strokeWidth={1.8} />
        <path d={`M ${cx - 4} ${cy - 1.5} H ${cx + 4}`} stroke={color} strokeWidth={1.6} strokeLinecap="round" />
        <path d={`M ${cx - 2.5} ${cy + 2.5} H ${cx + 2.5}`} stroke={color} strokeWidth={1.6} strokeLinecap="round" />
      </g>
    );
  }

  if (kind === 'wip') {
    return (
      <g>
        <circle cx={cx} cy={cy} r={8} fill="var(--bg-graph)" stroke={color} strokeWidth={1.8} strokeDasharray="2.5 2.5" />
        <circle cx={cx} cy={cy} r={2} fill={color} />
      </g>
    );
  }

  return (
    <g>
      <circle cx={cx} cy={cy} r={9.5} fill="var(--bg-graph)" />
      <circle cx={cx} cy={cy} r={8} fill={authorColor} stroke={color} strokeWidth={2} />
      <text
        x={cx}
        y={cy + 2.5}
        textAnchor="middle"
        fontSize={8}
        fontWeight={700}
        fill="var(--bg-field)"
        style={{ fontFamily: 'inherit' }}
      >
        {initials}
      </text>
    </g>
  );
}

function GraphMessage({ icon, label }: { icon: ReactElement; label: string }): ReactElement {
  return (
    <div className="grid h-full min-h-[240px] place-items-center text-xs text-[var(--text-3)]">
      <div className="flex items-center gap-2">
        {icon}
        <span>{label}</span>
      </div>
    </div>
  );
}

function GraphContextMenu({ state, onClose }: { state: ContextMenuState; onClose: () => void }): ReactElement {
  const isWip = state.row.node.kind === 'wip';
  const isStash = state.row.node.kind === 'stash';

  async function copySha(): Promise<void> {
    await navigator.clipboard.writeText(state.row.sha);
    onClose();
  }

  return (
    <div
      className="fixed z-50 w-60 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-popover)] p-1.5 shadow-2xl shadow-black/60"
      style={{ left: state.x, top: state.y }}
      onClick={(event) => event.stopPropagation()}
    >
      {!isWip ? (
        <button className="menu-row" type="button" onClick={() => void copySha()}>
          <Copy size={14} />
          <span>Copy SHA</span>
        </button>
      ) : null}
      {isWip ? (
        <>
          <button className="menu-row" type="button" disabled title="File staging lands in M3">
            <Pencil size={14} />
            <span>Stage all files</span>
          </button>
          <button className="menu-row" type="button" disabled title="Committing lands in M3">
            <GitCommit size={14} />
            <span>Commit changes</span>
          </button>
        </>
      ) : isStash ? (
        <>
          <button className="menu-row" type="button" disabled title="Stash apply lands in M4">
            <Archive size={14} />
            <span>Apply stash</span>
          </button>
          <button className="menu-row" type="button" disabled title="Stash pop lands in M4">
            <Archive size={14} />
            <span>Pop stash</span>
          </button>
        </>
      ) : (
        <>
          <button className="menu-row" type="button" disabled title="Checkout lands in M4">
            <GitBranch size={14} />
            <span>Checkout commit</span>
          </button>
          <button className="menu-row" type="button" disabled title="Merge lands in M4">
            <GitMerge size={14} />
            <span>Merge into current</span>
          </button>
          <button className="menu-row" type="button" disabled title="Interactive rebase lands in M5">
            <Workflow size={14} />
            <span>Interactive rebase from here</span>
          </button>
        </>
      )}
    </div>
  );
}

function graphCellWidth(rows: CommitGraphRow[]): number {
  let maxLane = 0;

  for (const row of rows) {
    maxLane = Math.max(maxLane, row.node.lane);

    for (const rail of row.rails) {
      if ('lane' in rail) {
        maxLane = Math.max(maxLane, rail.lane);
      } else {
        maxLane = Math.max(maxLane, rail.from, rail.to);
      }
    }
  }

  return Math.max(MIN_GRAPH_CELL_WIDTH, LANE_X0 + maxLane * LANE_GAP + 24);
}
