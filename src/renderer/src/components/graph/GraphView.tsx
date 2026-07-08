import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  UIEvent as ReactUIEvent
} from 'react';
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
  Settings,
  Tag,
  Trash2,
  Undo2,
  Workflow
} from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { FILE_STATUS_COLORS, laneColor } from '@shared/graph';
import type { CommitGraphRow, GraphFile, GraphRailSegment, GraphRefChip } from '@shared/types';

const ROW_HEIGHT = 34;
const LANE_X0 = 48;
const LANE_GAP = 28;
const GRAPH_NODE_EDGE_INSET = 18;
const DEFAULT_REF_CELL_WIDTH = 166;
const DEFAULT_GRAPH_VIEWPORT_WIDTH = 188;
const MIN_MESSAGE_CELL_WIDTH = 220;
const GRAPH_COLUMN_WIDTH_STORAGE_KEY = 'git-gud:graph-column-widths';

type ResizableGraphColumn = 'refs' | 'graph';

type GraphColumnWidths = Record<ResizableGraphColumn, number>;

type ColumnResizeState = {
  column: ResizableGraphColumn;
  startX: number;
  startWidth: number;
};

type GraphViewport = {
  width: number;
  scrollLeft: number;
};

type GraphColumnLimit = {
  min: number;
  max: number;
  defaultValue: number;
};

const GRAPH_COLUMN_LIMITS: Record<ResizableGraphColumn, GraphColumnLimit> = {
  refs: {
    min: 124,
    max: 360,
    defaultValue: DEFAULT_REF_CELL_WIDTH
  },
  graph: {
    min: 96,
    max: 520,
    defaultValue: DEFAULT_GRAPH_VIEWPORT_WIDTH
  }
};

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
  largeRepoMode?: boolean;
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
  isOperationBusy = false,
  largeRepoMode = false
}: GraphViewProps): ReactElement {
  const sectionRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const graphScrollerRef = useRef<HTMLDivElement>(null);
  const resizeStateRef = useRef<ColumnResizeState | undefined>(undefined);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>();
  const [columnWidths, setColumnWidths] = useState<GraphColumnWidths>(loadStoredGraphColumnWidths);
  const [graphContainerWidth, setGraphContainerWidth] = useState<number>();
  const [resizingColumn, setResizingColumn] = useState<ResizableGraphColumn>();
  const [graphScrollLeft, setGraphScrollLeft] = useState(0);
  const graphWidth = columnWidths.graph;
  const graphContentWidth = useMemo(() => graphContentWidthForRows(rows, graphWidth), [graphWidth, rows]);
  const refCellWidth = columnWidths.refs;
  const gridTemplateColumns = `${refCellWidth}px ${graphWidth}px minmax(0, 1fr)`;
  // TanStack Virtual is the row windowing layer for M2; the virtualizer stays local to this component.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: largeRepoMode ? 8 : 24
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

  useEffect(() => {
    if (resizingColumn) {
      return;
    }

    saveStoredGraphColumnWidths(columnWidths);
  }, [columnWidths, resizingColumn]);

  useLayoutEffect(() => {
    const element = sectionRef.current;

    if (!element) {
      return;
    }

    const observedElement = element;

    function updateContainerWidth(): void {
      setGraphContainerWidth(Math.round(observedElement.getBoundingClientRect().width));
    }

    updateContainerWidth();

    const observer = new ResizeObserver(updateContainerWidth);
    observer.observe(observedElement);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!graphContainerWidth) {
      return;
    }

    setColumnWidths((current) => fitGraphColumnWidths(current, graphContainerWidth));
  }, [graphContainerWidth]);

  useEffect(() => {
    if (!resizingColumn) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function handlePointerMove(event: PointerEvent): void {
      const state = resizeStateRef.current;

      if (!state) {
        return;
      }

      const nextWidth = state.startWidth + event.clientX - state.startX;
      setColumnWidths((current) => resizeGraphColumn(current, state.column, nextWidth, graphContainerWidth));
    }

    function stopResize(): void {
      resizeStateRef.current = undefined;
      setResizingColumn(undefined);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [graphContainerWidth, resizingColumn]);

  useEffect(() => {
    const maxScrollLeft = Math.max(0, graphContentWidth - graphWidth);

    if (graphScrollLeft <= maxScrollLeft) {
      return;
    }

    setGraphScrollLeft(maxScrollLeft);

    if (graphScrollerRef.current) {
      graphScrollerRef.current.scrollLeft = maxScrollLeft;
    }
  }, [graphContentWidth, graphScrollLeft, graphWidth]);

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

  function handleGraphScroll(event: ReactUIEvent<HTMLDivElement>): void {
    setGraphScrollLeft(event.currentTarget.scrollLeft);
  }

  function handleColumnResizeStart(event: ReactPointerEvent<HTMLDivElement>, column: ResizableGraphColumn): void {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    resizeStateRef.current = {
      column,
      startX: event.clientX,
      startWidth: columnWidths[column]
    };
    setResizingColumn(column);
  }

  function handleColumnResizeNudge(column: ResizableGraphColumn, delta: number): void {
    setColumnWidths((current) => resizeGraphColumn(current, column, current[column] + delta, graphContainerWidth));
  }

  function handleColumnResizeReset(column: ResizableGraphColumn): void {
    setColumnWidths((current) =>
      resizeGraphColumn(current, column, GRAPH_COLUMN_LIMITS[column].defaultValue, graphContainerWidth)
    );
  }

  return (
    <section ref={sectionRef} className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-graph)]">
      <div
        className="grid h-8 shrink-0 items-center border-b border-[var(--border)] bg-[var(--bg-graph-header)] text-[11px] font-semibold uppercase text-[var(--text-3)]"
        style={{ gridTemplateColumns }}
      >
        <div className="graph-column-header flex h-full items-center border-r border-[var(--border)] pl-5 leading-none tracking-[0.02em]">
          <span className="truncate">Branch / Tag</span>
          <GraphColumnResizeHandle
            column="refs"
            label="Branch / Tag"
            value={refCellWidth}
            isActive={resizingColumn === 'refs'}
            onPointerDown={handleColumnResizeStart}
            onNudge={handleColumnResizeNudge}
            onReset={handleColumnResizeReset}
          />
        </div>
        <div className="graph-column-header flex h-full items-center border-r border-[var(--border)] pl-4 leading-none tracking-[0.02em]">
          <span className="truncate">Graph</span>
          <GraphColumnResizeHandle
            column="graph"
            label="Graph"
            value={graphWidth}
            isActive={resizingColumn === 'graph'}
            onPointerDown={handleColumnResizeStart}
            onNudge={handleColumnResizeNudge}
            onReset={handleColumnResizeReset}
          />
        </div>
        <span className="flex h-full items-center justify-between pl-4 pr-3">
          <span className="leading-none tracking-[0.02em]">Commit message</span>
          <span className="flex items-center gap-2">
            {isFetching && rows.length > 0 ? <Loader2 size={13} className="animate-spin text-[var(--text-3)]" /> : null}
            <Settings size={15} className="text-[var(--text-3)]" />
          </span>
        </span>
      </div>

      <div
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={handleListKeyDown}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto outline-none"
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
                      graphContentWidth={graphContentWidth}
                      graphScrollLeft={graphScrollLeft}
                      refCellWidth={refCellWidth}
                      gridTemplateColumns={gridTemplateColumns}
                      isSelected={row.sha === selectedSha}
                      rowIndex={virtualRow.index}
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

      {graphContentWidth > graphWidth ? (
        <div
          className="graph-x-scrollbar"
          style={{ left: refCellWidth, width: graphWidth }}
          ref={graphScrollerRef}
          onScroll={handleGraphScroll}
          aria-hidden="true"
        >
          <div style={{ width: graphContentWidth, height: 1 }} />
        </div>
      ) : null}

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
  graphContentWidth: number;
  graphScrollLeft: number;
  refCellWidth: number;
  gridTemplateColumns: string;
  isSelected: boolean;
  rowIndex: number;
  onSelect: () => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
};

type GraphColumnResizeHandleProps = {
  column: ResizableGraphColumn;
  label: string;
  value: number;
  isActive: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, column: ResizableGraphColumn) => void;
  onNudge: (column: ResizableGraphColumn, delta: number) => void;
  onReset: (column: ResizableGraphColumn) => void;
};

function GraphColumnResizeHandle({
  column,
  label,
  value,
  isActive,
  onPointerDown,
  onNudge,
  onReset
}: GraphColumnResizeHandleProps): ReactElement {
  const limits = GRAPH_COLUMN_LIMITS[column];

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const step = event.shiftKey ? 36 : 12;

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onNudge(column, -step);
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      onNudge(column, step);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      onNudge(column, limits.min - value);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      onNudge(column, limits.max - value);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onReset(column);
    }
  }

  return (
    <div
      className="graph-column-resizer"
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={`Resize ${label} column`}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-valuenow={Math.round(value)}
      data-active={isActive ? 'true' : undefined}
      title="Drag to resize. Double-click to reset."
      onPointerDown={(event) => onPointerDown(event, column)}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onReset(column);
      }}
      onKeyDown={handleKeyDown}
    />
  );
}

function GraphRowView({
  row,
  graphWidth,
  graphContentWidth,
  graphScrollLeft,
  refCellWidth,
  gridTemplateColumns,
  isSelected,
  rowIndex,
  onSelect,
  onContextMenu
}: GraphRowViewProps): ReactElement {
  const nodeColor = row.colorOverride ?? laneColor(row.node.lane);
  const isWip = row.node.kind === 'wip';
  const visibleRefs = isWip ? [] : (row.refs ?? []).filter((ref) => ref.kind !== 'stash');
  const rowBackground = graphRowBackground(row, isSelected, rowIndex);
  const bandBackground = graphRowBandBackground(row, nodeColor, isSelected);

  return (
    <div
      className="group relative grid cursor-pointer items-center"
      style={{
        height: ROW_HEIGHT,
        gridTemplateColumns,
        background: rowBackground,
        boxShadow: isSelected
          ? 'inset 0 0 0 1px rgba(36, 196, 222, 0.72)'
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

      {bandBackground ? (
        <div
          className="pointer-events-none absolute bottom-[2px] top-[2px]"
          style={{
            left: refCellWidth,
            width: graphWidth,
            background: bandBackground,
            boxShadow: `inset 3px 0 0 ${nodeColor}, inset 0 -1px 0 rgba(0, 0, 0, 0.18)`
          }}
        />
      ) : null}

      <div className="ref-cell pl-2 pr-1.5">
        <RefChipStack refs={visibleRefs} color={nodeColor} />
      </div>

      <RailCell
        row={row}
        nodeColor={nodeColor}
        graphWidth={graphWidth}
        graphContentWidth={graphContentWidth}
        graphScrollLeft={graphScrollLeft}
      />

      <div className="relative flex min-w-0 items-center gap-2 pl-4 pr-3">
        {isWip ? (
          <>
            <span className="wip-message-pill">// WIP</span>
            {row.files.length > 0 ? <WipStatusCounts files={row.files} /> : null}
          </>
        ) : (
          <CommitSubjectLine subject={row.subject} isMerge={row.node.kind === 'merge'} />
        )}
      </div>
    </div>
  );
}

function CommitSubjectLine({ subject, isMerge }: { subject: string; isMerge: boolean }): ReactElement {
  const [primary, secondary] = splitCommitSubject(subject);

  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-2 text-[13px] leading-none">
      <span className={isMerge ? 'min-w-0 truncate text-[var(--text-2)]' : 'min-w-0 truncate text-[var(--text-1)]'}>
        {primary}
      </span>
      {secondary ? (
        <span className="hidden min-w-0 shrink-[2] truncate text-[var(--text-3)] xl:inline">
          {secondary}
        </span>
      ) : null}
    </span>
  );
}

function splitCommitSubject(subject: string): [string, string | undefined] {
  const summaryIndex = subject.indexOf(' ## ');

  if (summaryIndex !== -1) {
    return [subject.slice(0, summaryIndex), subject.slice(summaryIndex + 1)];
  }

  const separatorIndex = subject.indexOf(' | ');

  if (separatorIndex !== -1) {
    return [subject.slice(0, separatorIndex), subject.slice(separatorIndex)];
  }

  return [subject, undefined];
}

function WipStatusCounts({ files }: { files: GraphFile[] }): ReactElement {
  const changedCount = files.length;

  return (
    <span className="shrink-0 text-[15px] font-semibold leading-none tabular-nums" style={{ color: FILE_STATUS_COLORS.added }}>
      + {changedCount}
    </span>
  );
}

function graphContentWidthForRows(rows: CommitGraphRow[], graphWidth: number): number {
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

  return Math.max(graphWidth, LANE_X0 + maxLane * LANE_GAP + 76);
}

function resizeGraphColumn(
  widths: GraphColumnWidths,
  column: ResizableGraphColumn,
  width: number,
  containerWidth: number | undefined
): GraphColumnWidths {
  const nextWidth = clampGraphColumnWidth(column, width, widths, containerWidth);

  if (widths[column] === nextWidth) {
    return widths;
  }

  return { ...widths, [column]: nextWidth };
}

function fitGraphColumnWidths(widths: GraphColumnWidths, containerWidth: number): GraphColumnWidths {
  const graph = clampGraphColumnWidth('graph', widths.graph, widths, containerWidth);
  const nextWidths = { ...widths, graph };
  const refs = clampGraphColumnWidth('refs', nextWidths.refs, nextWidths, containerWidth);

  if (widths.refs === refs && widths.graph === graph) {
    return widths;
  }

  return { refs, graph };
}

function clampGraphColumnWidth(
  column: ResizableGraphColumn,
  width: number,
  widths?: GraphColumnWidths,
  containerWidth?: number
): number {
  const limits = GRAPH_COLUMN_LIMITS[column];
  const otherColumn = column === 'refs' ? 'graph' : 'refs';
  const maxWidth =
    widths && containerWidth
      ? Math.min(limits.max, Math.max(limits.min, containerWidth - widths[otherColumn] - MIN_MESSAGE_CELL_WIDTH))
      : limits.max;

  return Math.round(Math.min(maxWidth, Math.max(limits.min, width)));
}

function loadStoredGraphColumnWidths(): GraphColumnWidths {
  const defaults = defaultGraphColumnWidths();

  if (typeof window === 'undefined') {
    return defaults;
  }

  try {
    const rawValue = window.localStorage.getItem(GRAPH_COLUMN_WIDTH_STORAGE_KEY);

    if (!rawValue) {
      return defaults;
    }

    const parsedValue: unknown = JSON.parse(rawValue);

    if (!isRecord(parsedValue)) {
      return defaults;
    }

    return {
      refs: readStoredGraphColumnWidth(parsedValue.refs, 'refs'),
      graph: readStoredGraphColumnWidth(parsedValue.graph, 'graph')
    };
  } catch {
    return defaults;
  }
}

function saveStoredGraphColumnWidths(widths: GraphColumnWidths): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(GRAPH_COLUMN_WIDTH_STORAGE_KEY, JSON.stringify(widths));
  } catch {
    // Ignore storage failures; resizing should still work for the current session.
  }
}

function defaultGraphColumnWidths(): GraphColumnWidths {
  return {
    refs: GRAPH_COLUMN_LIMITS.refs.defaultValue,
    graph: GRAPH_COLUMN_LIMITS.graph.defaultValue
  };
}

function readStoredGraphColumnWidth(value: unknown, column: ResizableGraphColumn): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return GRAPH_COLUMN_LIMITS[column].defaultValue;
  }

  return clampGraphColumnWidth(column, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function graphRowBackground(row: CommitGraphRow, isSelected: boolean, rowIndex: number): string | undefined {
  if (isSelected) {
    return 'linear-gradient(90deg, rgba(34, 77, 145, 0.58), rgba(31, 65, 120, 0.50) 64%, rgba(28, 45, 76, 0.50))';
  }

  if (row.node.kind === 'wip') {
    return 'linear-gradient(90deg, rgba(11, 42, 51, 0.72), rgba(14, 30, 43, 0.72) 64%, rgba(21, 26, 34, 0.82))';
  }

  return rowIndex % 2 === 0 ? 'rgba(255, 255, 255, 0.018)' : undefined;
}

function graphRowBandBackground(row: CommitGraphRow, color: string, isSelected: boolean): string | undefined {
  if (isSelected) {
    return `linear-gradient(90deg, ${hexToRgba(color, 0.30)}, ${hexToRgba(color, 0.15)} 64%, ${hexToRgba(color, 0.03)})`;
  }

  if (row.node.kind === 'wip') {
    return `linear-gradient(90deg, ${hexToRgba(color, 0.34)}, ${hexToRgba(color, 0.16)} 52%, ${hexToRgba(color, 0.04)})`;
  }

  if (row.node.kind === 'stash') {
    return `linear-gradient(90deg, ${hexToRgba(color, 0.20)}, ${hexToRgba(color, 0.10)} 60%, ${hexToRgba(color, 0.03)})`;
  }

  const refs = row.refs ?? [];

  if (refs.length === 0) {
    return undefined;
  }

  const opacity = refs.some((ref) => ref.current) ? 0.32 : 0.22;
  return `linear-gradient(90deg, ${hexToRgba(color, opacity)}, ${hexToRgba(color, opacity * 0.58)} 58%, ${hexToRgba(color, 0.035)})`;
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.trim().replace(/^#/, '');

  if (!/^[\da-f]{6}$/i.test(normalized)) {
    return hex;
  }

  const value = Number.parseInt(normalized, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
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
          ? { background: color, borderColor: color, color: 'var(--text-1)' }
          : { background: `${color}55`, borderColor: `${color}8c`, color: 'var(--text-1)' }
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
  graphWidth,
  graphContentWidth,
  graphScrollLeft
}: {
  row: CommitGraphRow;
  nodeColor: string;
  graphWidth: number;
  graphContentWidth: number;
  graphScrollLeft: number;
}): ReactElement {
  const h = ROW_HEIGHT;
  const mid = h / 2;
  const nodeTitle = row.node.kind === 'wip' ? 'Uncommitted changes' : `${row.author.name} · ${row.sha.slice(0, 7)}`;
  const viewport: GraphViewport = {
    width: graphWidth,
    scrollLeft: graphScrollLeft
  };

  return (
    <div className="graph-cell-viewport" style={{ width: graphWidth, height: h }}>
      <svg
        width={graphContentWidth}
        height={h}
        viewBox={`0 0 ${graphContentWidth} ${h}`}
        className="shrink-0"
        style={{ transform: `translateX(-${graphScrollLeft}px)` }}
        aria-hidden="true"
      >
        {row.rails.map((segment, index) => (
          <RailSegmentPath key={index} segment={segment} height={h} viewport={viewport} />
        ))}
        <GraphNode
          nodeId={row.sha}
          kind={row.node.kind}
          cx={visibleLaneX(row.node.lane, viewport)}
          cy={mid}
          color={nodeColor}
          authorColor={row.author.color}
          avatarUrl={row.author.avatarUrl}
          title={nodeTitle}
        />
      </svg>
    </div>
  );
}

function laneX(lane: number): number {
  return LANE_X0 + lane * LANE_GAP;
}

function visibleLaneX(lane: number, viewport: GraphViewport): number {
  return clampViewportX(laneX(lane), viewport);
}

function clampViewportX(x: number, viewport: GraphViewport): number {
  const minX = viewport.scrollLeft + GRAPH_NODE_EDGE_INSET;
  const maxX = viewport.scrollLeft + Math.max(GRAPH_NODE_EDGE_INSET, viewport.width - GRAPH_NODE_EDGE_INSET);
  return Math.min(maxX, Math.max(minX, x));
}

function RailSegmentPath({
  segment,
  height,
  viewport
}: {
  segment: GraphRailSegment;
  height: number;
  viewport: GraphViewport;
}): ReactElement {
  const mid = height / 2;

  let d: string;
  let fallbackColor: string;

  switch (segment.type) {
    case 'through': {
      const x = visibleLaneX(segment.lane, viewport);
      d = `M ${x} 0 V ${height}`;
      fallbackColor = laneColor(segment.lane);
      break;
    }
    case 'stopTop': {
      const x = visibleLaneX(segment.lane, viewport);
      d = `M ${x} 0 V ${mid}`;
      fallbackColor = laneColor(segment.lane);
      break;
    }
    case 'startBottom': {
      const x = visibleLaneX(segment.lane, viewport);
      d = `M ${x} ${mid} V ${height}`;
      fallbackColor = laneColor(segment.lane);
      break;
    }
    case 'curveIn': {
      const xf = visibleLaneX(segment.from, viewport);
      const xt = visibleLaneX(segment.to, viewport);
      d = `M ${xf} 0 C ${xf} ${mid / 2} ${xt} ${mid / 2} ${xt} ${mid}`;
      fallbackColor = laneColor(segment.from);
      break;
    }
    case 'curveOut': {
      const xf = visibleLaneX(segment.from, viewport);
      const xt = visibleLaneX(segment.to, viewport);
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
      strokeLinecap="round"
      strokeWidth={segment.dashed ? 2.4 : 2.8}
      strokeDasharray={segment.dashed ? '1 5' : undefined}
      strokeOpacity={segment.dashed ? 0.86 : 0.95}
    />
  );
}

type GraphNodeProps = {
  nodeId: string;
  kind: CommitGraphRow['node']['kind'];
  cx: number;
  cy: number;
  color: string;
  authorColor: string;
  avatarUrl?: string;
  title: string;
};

function GraphNode({ nodeId, kind, cx, cy, color, authorColor, avatarUrl, title }: GraphNodeProps): ReactElement {
  if (kind === 'stash') {
    return (
      <g>
        <title>{title}</title>
        <rect
          x={cx - 7}
          y={cy - 7}
          width={14}
          height={14}
          rx={3.5}
          fill="var(--bg-graph)"
          stroke={color}
          strokeDasharray="2 2"
          strokeWidth={2}
        />
        <path d={`M ${cx - 4} ${cy - 1.5} H ${cx + 4}`} stroke={color} strokeWidth={1.6} strokeLinecap="round" />
        <path d={`M ${cx - 2.5} ${cy + 2.5} H ${cx + 2.5}`} stroke={color} strokeWidth={1.6} strokeLinecap="round" />
      </g>
    );
  }

  if (kind === 'wip') {
    return (
      <g>
        <title>{title}</title>
        <circle cx={cx} cy={cy} r={8.8} fill="var(--bg-graph)" stroke={color} strokeWidth={2.3} strokeDasharray="1 4.5" />
        <circle cx={cx} cy={cy} r={2} fill={color} />
      </g>
    );
  }

  const clipId = `graph-avatar-${nodeId.replace(/[^\dA-Za-z_-]/g, '') || 'node'}`;
  const outerRadius = 11.8;
  const ringStrokeWidth = 4.1;
  const matRadius = 8.8;
  const imageRadius = 7.4;
  const imageSize = imageRadius * 2;

  return (
    <g>
      <title>{title}</title>
      <circle
        cx={cx}
        cy={cy}
        r={outerRadius - ringStrokeWidth / 2}
        fill="var(--avatar-card-bg)"
        stroke={color}
        strokeWidth={ringStrokeWidth}
      />
      <circle cx={cx} cy={cy} r={matRadius} fill="var(--avatar-card-bg)" />
      {avatarUrl ? (
        <>
          <clipPath id={clipId}>
            <circle cx={cx} cy={cy} r={imageRadius} />
          </clipPath>
          <image
            href={avatarUrl}
            x={cx - imageRadius}
            y={cy - imageRadius}
            width={imageSize}
            height={imageSize}
            clipPath={`url(#${clipId})`}
            preserveAspectRatio="xMidYMid slice"
          />
        </>
      ) : (
        <>
          <circle cx={cx} cy={cy} r={imageRadius} fill={authorColor} />
          <path
            d={`M ${cx - 5.5} ${cy + 5.8} C ${cx - 4.5} ${cy + 2.5} ${cx - 2.4} ${cy + 1.2} ${cx} ${cy + 1.2} C ${cx + 2.4} ${cy + 1.2} ${cx + 4.5} ${cy + 2.5} ${cx + 5.5} ${cy + 5.8}`}
            fill="rgba(6, 10, 15, 0.44)"
          />
          <circle cx={cx} cy={cy - 2.5} r={2.45} fill="rgba(255, 244, 225, 0.9)" />
          <path
            d={`M ${cx - 5} ${cy - 1.1} C ${cx - 3} ${cy - 5} ${cx + 1.7} ${cy - 5.7} ${cx + 5} ${cy - 2.1}`}
            fill="none"
            stroke="rgba(255, 255, 255, 0.36)"
            strokeLinecap="round"
            strokeWidth={1.4}
          />
        </>
      )}
      <circle cx={cx} cy={cy} r={outerRadius} fill="none" stroke="rgba(4, 7, 10, 0.58)" strokeWidth={0.7} />
      {kind === 'merge' ? (
        <circle cx={cx + 7.4} cy={cy + 7.2} r={2.7} fill="var(--bg-graph)" stroke={color} strokeWidth={1.4} />
      ) : null}
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


function stashSelectorForRow(row: CommitGraphRow): string | undefined {
  return row.refs?.find((ref) => ref.kind === 'stash')?.label;
}
