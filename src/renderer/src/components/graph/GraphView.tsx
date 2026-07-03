import type { ReactElement } from 'react';
import { Archive, Cloud, GitBranch, Pencil, SlidersHorizontal, Tag } from 'lucide-react';

import type { GraphRow, RailSegment, RefChipKind } from './sampleGraph';
import { laneColor } from './sampleGraph';

const ROW_HEIGHT = 32;
const LANE_X0 = 14;
const LANE_GAP = 18;
const GRAPH_CELL_WIDTH = 96;

type GraphViewProps = {
  rows: GraphRow[];
  selectedSha?: string;
  onSelectRow: (sha: string) => void;
};

export function GraphView({ rows, selectedSha, onSelectRow }: GraphViewProps): ReactElement {
  return (
    <section className="flex min-w-0 flex-col overflow-hidden bg-[var(--bg-graph)]">
      <div className="grid h-8 shrink-0 grid-cols-[178px_96px_minmax(0,1fr)] items-center border-b border-[var(--border)] bg-[var(--bg-graph-header)] pr-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-3)]">
        <span className="pl-3">Branch / Tag</span>
        <span className="pl-1">Graph</span>
        <span className="flex items-center justify-between">
          <span>Commit message</span>
          <span className="flex items-center gap-2">
            <span
              className="rounded-full border border-[#f0a13f4d] bg-[#f0a13f1a] px-2 py-0.5 font-semibold tracking-[0.08em] text-[#f0b35f]"
              title="Sample history for UI review - real graph rendering lands in M2"
            >
              Preview graph
            </span>
            <SlidersHorizontal size={13} className="text-[var(--text-3)]" />
          </span>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="pb-6">
          {rows.map((row) => (
            <GraphRowView
              key={row.sha}
              row={row}
              isSelected={row.sha === selectedSha}
              onSelect={() => onSelectRow(row.sha)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

type GraphRowViewProps = {
  row: GraphRow;
  isSelected: boolean;
  onSelect: () => void;
};

function GraphRowView({ row, isSelected, onSelect }: GraphRowViewProps): ReactElement {
  const nodeColor = row.colorOverride ?? laneColor(row.node.lane);
  const isWip = row.node.kind === 'wip';

  return (
    <div
      className="group relative grid cursor-pointer grid-cols-[178px_96px_minmax(0,1fr)] items-center"
      style={{
        height: ROW_HEIGHT,
        background: isSelected ? 'var(--select-bg)' : `${nodeColor}0d`,
        boxShadow: isSelected ? 'inset 0 0 0 1px var(--select-border)' : undefined
      }}
      onClick={onSelect}
    >
      {!isSelected ? (
        <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100" style={{ background: 'rgba(255,255,255,0.03)' }} />
      ) : null}

      <div className="flex min-w-0 items-center justify-end gap-1 pl-2 pr-1.5">
        {row.refs?.map((ref) => <RefChipView key={ref.label} label={ref.label} kind={ref.kind} color={nodeColor} />)}
      </div>

      <RailCell row={row} nodeColor={nodeColor} />

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

function RailCell({ row, nodeColor }: { row: GraphRow; nodeColor: string }): ReactElement {
  const h = ROW_HEIGHT;
  const mid = h / 2;

  return (
    <svg
      width={GRAPH_CELL_WIDTH}
      height={h}
      viewBox={`0 0 ${GRAPH_CELL_WIDTH} ${h}`}
      className="shrink-0"
      aria-hidden="true"
    >
      {row.rails.map((segment, index) => (
        <RailSegmentPath key={index} segment={segment} row={row} height={h} />
      ))}
      <GraphNode kind={row.node.kind} cx={laneX(row.node.lane)} cy={mid} color={nodeColor} authorColor={row.author.color} initials={row.author.initials} />
    </svg>
  );
}

function laneX(lane: number): number {
  return LANE_X0 + lane * LANE_GAP;
}

function RailSegmentPath({ segment, row, height }: { segment: RailSegment; row: GraphRow; height: number }): ReactElement {
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
  kind: GraphRow['node']['kind'];
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
        fill="#0b0f14"
        style={{ fontFamily: 'inherit' }}
      >
        {initials}
      </text>
    </g>
  );
}
