import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent, ReactElement } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Cherry,
  Check,
  Cloud,
  Copy,
  GitBranch,
  GitBranchPlus,
  GitCommit,
  GitMerge,
  LaptopMinimal,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Tag,
  Trash2,
  Undo2,
  Workflow
} from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { FILE_STATUS_COLORS, laneColor } from '@shared/graph';
import type { CommitGraphRow, GraphFile, GraphFileStatus, GraphRailSegment, GraphRefChip } from '@shared/types';

const ROW_HEIGHT = 32;
const LANE_X0 = 14;
const LANE_GAP = 18;
const MIN_REF_CELL_WIDTH = 178;
const MAX_REF_CELL_WIDTH = 320;
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
  onStageAllWip?: () => Promise<void> | void;
  onOpenWipCommitComposer?: () => void;
  onStashPush?: () => Promise<void> | void;
  onStashApply?: (selector: string) => Promise<void> | void;
  onStashPop?: (selector: string) => Promise<void> | void;
  onStashDrop?: (selector: string) => Promise<void> | void;
  onCheckoutCommit?: (sha: string) => Promise<void> | void;
  onCreateBranchAtCommit?: (sha: string) => Promise<void> | void;
  onCreateTagAtCommit?: (sha: string) => Promise<void> | void;
  onMergeCommit?: (sha: string) => Promise<void> | void;
  onRebaseOntoCommit?: (sha: string) => Promise<void> | void;
  onInteractiveRebaseFromCommit?: (sha: string) => Promise<void> | void;
  onCherryPickCommit?: (sha: string) => Promise<void> | void;
  onRevertCommit?: (sha: string) => Promise<void> | void;
  onResetToCommit?: (sha: string) => Promise<void> | void;
  isOperationBusy?: boolean;
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
  onLoadMore,
  onStageAllWip,
  onOpenWipCommitComposer,
  onStashPush,
  onStashApply,
  onStashPop,
  onStashDrop,
  onCheckoutCommit,
  onCreateBranchAtCommit,
  onCreateTagAtCommit,
  onMergeCommit,
  onRebaseOntoCommit,
  onInteractiveRebaseFromCommit,
  onCherryPickCommit,
  onRevertCommit,
  onResetToCommit,
  isOperationBusy = false
}: GraphViewProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>();
  const graphWidth = useMemo(() => graphCellWidth(rows), [rows]);
  const refCellWidth = useMemo(() => refCellWidthForRows(rows), [rows]);
  const gridTemplateColumns = `${refCellWidth}px ${graphWidth}px minmax(0, 1fr)`;
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

  function handleListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }

    event.preventDefault();

    if (rows.length === 0) {
      return;
    }

    const currentIndex = rows.findIndex((row) => row.sha === selectedSha);
    const nextIndex =
      event.key === 'ArrowDown'
        ? Math.min(rows.length - 1, currentIndex + 1)
        : Math.max(0, (currentIndex === -1 ? rows.length : currentIndex) - 1);
    const nextRow = rows[nextIndex];

    if (nextRow) {
      onSelectRow(nextRow.sha);
      rowVirtualizer.scrollToIndex(nextIndex, { align: 'auto' });
    }
  }

  return (
    <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-graph)]">
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

      <div
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={handleListKeyDown}
        className="min-h-0 flex-1 overflow-y-auto outline-none"
      >
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
              <div className="flex items-center justify-center gap-3 border-t border-[var(--border)] px-3 py-3">
                <button className="btn-accent h-8 text-xs" type="button" onClick={onLoadMore} disabled={isFetching}>
                  {isFetching ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  <span>Load more</span>
                </button>
                <span className="text-[11px] text-[var(--text-3)]">{rows.length.toLocaleString()} rows loaded</span>
              </div>
            ) : null}
          </>
        )}
      </div>

      {contextMenu ? (
        <GraphContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(undefined)}
          onStageAllWip={onStageAllWip}
          onOpenWipCommitComposer={onOpenWipCommitComposer}
          onStashPush={onStashPush}
          onStashApply={onStashApply}
          onStashPop={onStashPop}
          onStashDrop={onStashDrop}
          onCheckoutCommit={onCheckoutCommit}
          onCreateBranchAtCommit={onCreateBranchAtCommit}
          onCreateTagAtCommit={onCreateTagAtCommit}
          onMergeCommit={onMergeCommit}
          onRebaseOntoCommit={onRebaseOntoCommit}
          onInteractiveRebaseFromCommit={onInteractiveRebaseFromCommit}
          onCherryPickCommit={onCherryPickCommit}
          onRevertCommit={onRevertCommit}
          onResetToCommit={onResetToCommit}
          isOperationBusy={isOperationBusy}
        />
      ) : null}
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
        background: isSelected ? 'var(--select-bg)' : undefined,
        boxShadow: isSelected
          ? 'inset 0 0 0 1px var(--select-border)'
          : row.dateMarker
            ? 'inset 0 1px 0 0 var(--border-strong)'
            : undefined
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

      <div className="ref-cell pl-2 pr-1.5">
        <RefChipStack refs={row.refs ?? []} color={nodeColor} />
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
        {isWip && row.files.length > 0 ? <WipStatusCounts files={row.files} /> : null}
        <span className="ml-auto hidden shrink-0 text-[11px] text-[var(--text-3)] xl:inline">{row.dateLabel}</span>
        {row.dateMarker ? (
          <span className="pointer-events-none absolute -top-2 right-3 z-10 rounded border border-[var(--border-strong)] bg-[var(--bg-graph)] px-1.5 py-px text-[10px] leading-4 text-[var(--text-3)]">
            {row.dateMarker}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function WipStatusCounts({ files }: { files: GraphFile[] }): ReactElement {
  const counts: Record<GraphFileStatus, number> = { added: 0, modified: 0, deleted: 0 };

  for (const file of files) {
    counts[file.status] += 1;
  }

  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[10.5px] font-semibold tabular-nums">
      {counts.added > 0 ? <span style={{ color: FILE_STATUS_COLORS.added }}>+{counts.added}</span> : null}
      {counts.modified > 0 ? <span style={{ color: FILE_STATUS_COLORS.modified }}>~{counts.modified}</span> : null}
      {counts.deleted > 0 ? <span style={{ color: FILE_STATUS_COLORS.deleted }}>−{counts.deleted}</span> : null}
    </span>
  );
}

type RefChipDisplay = GraphRefChip & {
  remotePeerLabels?: string[];
};

function RefChipStack({ refs, color }: { refs: GraphRefChip[]; color: string }): ReactElement | null {
  if (refs.length === 0) {
    return null;
  }

  const displayRefs = coalesceRemotePeers(refs);
  const [primaryRef, ...overflowRefs] = displayRefs;

  if (!primaryRef) {
    return null;
  }

  const title = displayRefs.flatMap(refChipTitleLines).join('\n');

  return (
    <div className="ref-stack" data-has-overflow={overflowRefs.length > 0}>
      <div className="ref-stack-summary">
        <RefChipView chip={primaryRef} color={color} />
        {overflowRefs.length > 0 ? (
          <span
            className="ref-overflow"
            style={{ background: `${color}24`, borderColor: `${color}59`, color }}
            title={title}
          >
            +{overflowRefs.length}
          </span>
        ) : null}
      </div>
      {overflowRefs.length > 0 ? (
        <div className="ref-stack-expanded">
          {displayRefs.map((chip) => (
            <RefChipView key={`${chip.kind}:${chip.label}`} chip={chip} color={color} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RefChipView({ chip, color }: { chip: RefChipDisplay; color: string }): ReactElement {
  const { current, kind, label, remotePeerLabels } = chip;
  const hasRemotePeer = (remotePeerLabels?.length ?? 0) > 0;
  const title = refChipTitle(chip);
  const ariaLabel = `${label}${current ? ', checked out' : ''}${hasRemotePeer ? `, tracks ${remotePeerLabels?.join(', ')}` : ''}`;
  const icon =
    current ? (
      <Check size={12} />
    ) : kind === 'branch' ? (
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
      style={
        current
          ? { background: color, borderColor: color, color: 'var(--bg-field)' }
          : { background: `${color}24`, borderColor: `${color}59`, color }
      }
      title={title}
      aria-label={ariaLabel}
    >
      {icon}
      <span className="ref-chip-label">{label}</span>
      {kind === 'branch' ? <LaptopMinimal size={13} className="ref-chip-extra-icon" aria-hidden="true" /> : null}
      {hasRemotePeer ? <Cloud size={12} className="ref-chip-extra-icon" aria-hidden="true" /> : null}
    </span>
  );
}

function coalesceRemotePeers(refs: GraphRefChip[]): RefChipDisplay[] {
  const localBranchLabels = new Set(refs.filter((ref) => ref.kind === 'branch').map((ref) => ref.label));
  const remotePeersByLocalBranch = new Map<string, string[]>();

  for (const ref of refs) {
    if (ref.kind !== 'remote') {
      continue;
    }

    const localBranchName = localBranchNameForRemoteRef(ref.label);

    if (!localBranchLabels.has(localBranchName)) {
      continue;
    }

    const remotePeers = remotePeersByLocalBranch.get(localBranchName) ?? [];
    remotePeers.push(ref.label);
    remotePeersByLocalBranch.set(localBranchName, remotePeers);
  }

  return refs.flatMap((ref) => {
    if (ref.kind === 'remote' && localBranchLabels.has(localBranchNameForRemoteRef(ref.label))) {
      return [];
    }

    if (ref.kind !== 'branch') {
      return [{ ...ref }];
    }

    const remotePeerLabels = remotePeersByLocalBranch.get(ref.label);

    return [{ ...ref, ...(remotePeerLabels?.length ? { remotePeerLabels } : {}) }];
  });
}

function localBranchNameForRemoteRef(label: string): string {
  const slashIndex = label.indexOf('/');
  return slashIndex === -1 ? label : label.slice(slashIndex + 1);
}

function refChipTitle(chip: RefChipDisplay): string {
  const peerLabels = chip.remotePeerLabels ?? [];

  if (chip.current && peerLabels.length > 0) {
    return `${chip.label} (checked out, tracks ${peerLabels.join(', ')})`;
  }

  if (chip.current) {
    return `${chip.label} (checked out)`;
  }

  if (peerLabels.length > 0) {
    return `${chip.label} (tracks ${peerLabels.join(', ')})`;
  }

  return chip.label;
}

function refChipTitleLines(chip: RefChipDisplay): string[] {
  return chip.remotePeerLabels?.length ? [chip.label, ...chip.remotePeerLabels] : [chip.label];
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
  const nodeTitle = row.node.kind === 'wip' ? 'Uncommitted changes' : `${row.author.name} · ${row.sha.slice(0, 7)}`;

  return (
    <svg
      width={graphWidth}
      height={h}
      viewBox={`0 0 ${graphWidth} ${h}`}
      className="shrink-0"
      aria-hidden="true"
    >
      {row.rails.map((segment, index) => (
        <RailSegmentPath key={index} segment={segment} height={h} />
      ))}
      <GraphNode
        kind={row.node.kind}
        cx={laneX(row.node.lane)}
        cy={mid}
        color={nodeColor}
        authorColor={row.author.color}
        initials={row.author.initials}
        title={nodeTitle}
      />
    </svg>
  );
}

function laneX(lane: number): number {
  return LANE_X0 + lane * LANE_GAP;
}

function RailSegmentPath({ segment, height }: { segment: GraphRailSegment; height: number }): ReactElement {
  const mid = height / 2;

  let d: string;
  let fallbackColor: string;

  switch (segment.type) {
    case 'through': {
      const x = laneX(segment.lane);
      d = `M ${x} 0 V ${height}`;
      fallbackColor = laneColor(segment.lane);
      break;
    }
    case 'stopTop': {
      const x = laneX(segment.lane);
      d = `M ${x} 0 V ${mid}`;
      fallbackColor = laneColor(segment.lane);
      break;
    }
    case 'startBottom': {
      const x = laneX(segment.lane);
      d = `M ${x} ${mid} V ${height}`;
      fallbackColor = laneColor(segment.lane);
      break;
    }
    case 'curveIn': {
      const xf = laneX(segment.from);
      const xt = laneX(segment.to);
      d = `M ${xf} 0 C ${xf} ${mid / 2} ${xt} ${mid / 2} ${xt} ${mid}`;
      fallbackColor = laneColor(segment.from);
      break;
    }
    case 'curveOut': {
      const xf = laneX(segment.from);
      const xt = laneX(segment.to);
      d = `M ${xf} ${mid} C ${xf} ${mid + mid / 2} ${xt} ${mid + mid / 2} ${xt} ${height}`;
      fallbackColor = laneColor(segment.to);
      break;
    }
  }

  return (
    <path
      d={d}
      fill="none"
      stroke={segment.color ?? fallbackColor}
      strokeWidth={2}
      strokeDasharray={segment.dashed ? '3 3' : undefined}
    />
  );
}

type GraphNodeProps = {
  kind: CommitGraphRow['node']['kind'];
  cx: number;
  cy: number;
  color: string;
  authorColor: string;
  initials: string;
  title: string;
};

function GraphNode({ kind, cx, cy, color, authorColor, initials, title }: GraphNodeProps): ReactElement {
  if (kind === 'merge') {
    return (
      <g>
        <title>{title}</title>
        <circle cx={cx} cy={cy} r={6} fill="var(--bg-graph)" />
        <circle cx={cx} cy={cy} r={4.5} fill={color} />
      </g>
    );
  }

  if (kind === 'stash') {
    return (
      <g>
        <title>{title}</title>
        <rect x={cx - 7} y={cy - 7} width={14} height={14} rx={3.5} fill="var(--bg-graph)" stroke={color} strokeWidth={1.8} />
        <path d={`M ${cx - 4} ${cy - 1.5} H ${cx + 4}`} stroke={color} strokeWidth={1.6} strokeLinecap="round" />
        <path d={`M ${cx - 2.5} ${cy + 2.5} H ${cx + 2.5}`} stroke={color} strokeWidth={1.6} strokeLinecap="round" />
      </g>
    );
  }

  if (kind === 'wip') {
    return (
      <g>
        <title>{title}</title>
        <circle cx={cx} cy={cy} r={8} fill="var(--bg-graph)" stroke={color} strokeWidth={1.8} strokeDasharray="2.5 2.5" />
        <circle cx={cx} cy={cy} r={2} fill={color} />
      </g>
    );
  }

  return (
    <g>
      <title>{title}</title>
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

function MenuSeparator(): ReactElement {
  return <div className="mx-1.5 my-1 h-px bg-[var(--border)]" />;
}

function GraphContextMenu({
  state,
  onClose,
  onStageAllWip,
  onOpenWipCommitComposer,
  onStashPush,
  onStashApply,
  onStashPop,
  onStashDrop,
  onCheckoutCommit,
  onCreateBranchAtCommit,
  onCreateTagAtCommit,
  onMergeCommit,
  onRebaseOntoCommit,
  onInteractiveRebaseFromCommit,
  onCherryPickCommit,
  onRevertCommit,
  onResetToCommit,
  isOperationBusy
}: {
  state: ContextMenuState;
  onClose: () => void;
  onStageAllWip?: () => Promise<void> | void;
  onOpenWipCommitComposer?: () => void;
  onStashPush?: () => Promise<void> | void;
  onStashApply?: (selector: string) => Promise<void> | void;
  onStashPop?: (selector: string) => Promise<void> | void;
  onStashDrop?: (selector: string) => Promise<void> | void;
  onCheckoutCommit?: (sha: string) => Promise<void> | void;
  onCreateBranchAtCommit?: (sha: string) => Promise<void> | void;
  onCreateTagAtCommit?: (sha: string) => Promise<void> | void;
  onMergeCommit?: (sha: string) => Promise<void> | void;
  onRebaseOntoCommit?: (sha: string) => Promise<void> | void;
  onInteractiveRebaseFromCommit?: (sha: string) => Promise<void> | void;
  onCherryPickCommit?: (sha: string) => Promise<void> | void;
  onRevertCommit?: (sha: string) => Promise<void> | void;
  onResetToCommit?: (sha: string) => Promise<void> | void;
  isOperationBusy: boolean;
}): ReactElement {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: state.x, top: state.y });
  const isWip = state.row.node.kind === 'wip';
  const isStash = state.row.node.kind === 'stash';
  const stashSelector = stashSelectorForRow(state.row);

  useLayoutEffect(() => {
    const menu = menuRef.current;

    if (!menu) {
      return;
    }

    const rect = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(state.x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(state.y, window.innerHeight - rect.height - 8))
    });
  }, [state]);

  async function copySha(): Promise<void> {
    await navigator.clipboard.writeText(state.row.sha);
    onClose();
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-60 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-popover)] p-1.5 shadow-2xl shadow-black/60"
      style={{ left: position.left, top: position.top }}
      onClick={(event) => event.stopPropagation()}
    >
      {isWip ? (
        <>
          <button
            className="menu-row"
            type="button"
            disabled={!onStageAllWip}
            title={onStageAllWip ? 'Stage all WIP files' : 'Open WIP detail panel to stage files'}
            onClick={() => {
              void onStageAllWip?.();
              onClose();
            }}
          >
            <Pencil size={14} />
            <span>Stage all files</span>
          </button>
          <button
            className="menu-row"
            type="button"
            disabled={!onOpenWipCommitComposer}
            title={onOpenWipCommitComposer ? 'Focus the WIP commit form' : 'Select the WIP row to commit changes'}
            onClick={() => {
              onOpenWipCommitComposer?.();
              onClose();
            }}
          >
            <GitCommit size={14} />
            <span>Commit changes</span>
          </button>
          <button
            className="menu-row"
            type="button"
            disabled={!onStashPush || isOperationBusy}
            onClick={() => {
              void onStashPush?.();
              onClose();
            }}
          >
            <Archive size={14} />
            <span>Stash all changes</span>
          </button>
        </>
      ) : isStash ? (
        <>
          <button
            className="menu-row"
            type="button"
            disabled={!onStashApply || !stashSelector || isOperationBusy}
            onClick={() => {
              if (stashSelector) {
                void onStashApply?.(stashSelector);
              }

              onClose();
            }}
          >
            <Archive size={14} />
            <span>Apply stash</span>
          </button>
          <button
            className="menu-row"
            type="button"
            disabled={!onStashPop || !stashSelector || isOperationBusy}
            onClick={() => {
              if (stashSelector) {
                void onStashPop?.(stashSelector);
              }

              onClose();
            }}
          >
            <Archive size={14} />
            <span>Pop stash</span>
          </button>
          <button
            className="menu-row"
            type="button"
            disabled={!onStashDrop || !stashSelector || isOperationBusy}
            onClick={() => {
              if (stashSelector) {
                void onStashDrop?.(stashSelector);
              }

              onClose();
            }}
          >
            <Trash2 size={14} />
            <span>Drop stash</span>
          </button>
          <MenuSeparator />
          <button className="menu-row" type="button" onClick={() => void copySha()}>
            <Copy size={14} />
            <span>Copy SHA</span>
          </button>
        </>
      ) : (
        <>
          <button
            className="menu-row"
            type="button"
            disabled={!onCheckoutCommit || isOperationBusy}
            onClick={() => {
              void onCheckoutCommit?.(state.row.sha);
              onClose();
            }}
          >
            <GitBranch size={14} />
            <span>Checkout commit</span>
          </button>
          <button
            className="menu-row"
            type="button"
            disabled={!onCreateBranchAtCommit || isOperationBusy}
            onClick={() => {
              void onCreateBranchAtCommit?.(state.row.sha);
              onClose();
            }}
          >
            <GitBranchPlus size={14} />
            <span>Create branch here</span>
          </button>
          <button
            className="menu-row"
            type="button"
            disabled={!onCreateTagAtCommit || isOperationBusy}
            onClick={() => {
              void onCreateTagAtCommit?.(state.row.sha);
              onClose();
            }}
          >
            <Tag size={14} />
            <span>Tag this commit</span>
          </button>
          <MenuSeparator />
          <button
            className="menu-row"
            type="button"
            disabled={!onMergeCommit || isOperationBusy}
            onClick={() => {
              void onMergeCommit?.(state.row.sha);
              onClose();
            }}
          >
            <GitMerge size={14} />
            <span>Merge into current</span>
          </button>
          <button
            className="menu-row"
            type="button"
            disabled={!onRebaseOntoCommit || isOperationBusy}
            onClick={() => {
              void onRebaseOntoCommit?.(state.row.sha);
              onClose();
            }}
          >
            <RefreshCw size={14} />
            <span>Rebase current onto here</span>
          </button>
          <button
            className="menu-row"
            type="button"
            disabled={!onInteractiveRebaseFromCommit || isOperationBusy}
            onClick={() => {
              void onInteractiveRebaseFromCommit?.(state.row.sha);
              onClose();
            }}
          >
            <Workflow size={14} />
            <span>Interactive rebase from here</span>
          </button>
          <MenuSeparator />
          <button
            className="menu-row"
            type="button"
            disabled={!onCherryPickCommit || isOperationBusy}
            onClick={() => {
              void onCherryPickCommit?.(state.row.sha);
              onClose();
            }}
          >
            <Cherry size={14} />
            <span>Cherry-pick commit</span>
          </button>
          <button
            className="menu-row"
            type="button"
            disabled={!onRevertCommit || isOperationBusy}
            onClick={() => {
              void onRevertCommit?.(state.row.sha);
              onClose();
            }}
          >
            <Undo2 size={14} />
            <span>Revert commit</span>
          </button>
          <button
            className="menu-row"
            type="button"
            disabled={!onResetToCommit || isOperationBusy}
            onClick={() => {
              void onResetToCommit?.(state.row.sha);
              onClose();
            }}
          >
            <RotateCcw size={14} />
            <span>Reset current branch here</span>
          </button>
          <MenuSeparator />
          <button className="menu-row" type="button" onClick={() => void copySha()}>
            <Copy size={14} />
            <span>Copy SHA</span>
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

function refCellWidthForRows(rows: CommitGraphRow[]): number {
  let width = MIN_REF_CELL_WIDTH;

  for (const row of rows) {
    const refs = row.refs ?? [];

    if (refs.length === 0) {
      continue;
    }

    const displayRefs = coalesceRemotePeers(refs);
    const primaryRef = displayRefs[0];

    if (!primaryRef) {
      continue;
    }

    const overflowWidth = displayRefs.length > 1 ? 36 : 0;
    width = Math.max(width, refChipWidth(primaryRef) + overflowWidth + 20);
  }

  return Math.min(MAX_REF_CELL_WIDTH, width);
}

function refChipWidth(ref: RefChipDisplay): number {
  const trailingIconWidth = ref.kind === 'branch' ? 18 : 0;
  const remotePeerIconWidth = (ref.remotePeerLabels?.length ?? 0) > 0 ? 18 : 0;
  return 31 + trailingIconWidth + remotePeerIconWidth + ref.label.length * 6.2;
}

function stashSelectorForRow(row: CommitGraphRow): string | undefined {
  return row.refs?.find((ref) => ref.kind === 'stash')?.label;
}
