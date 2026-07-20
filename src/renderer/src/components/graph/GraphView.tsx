import type {
  FormEvent,
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
  Tag,
  TreePine,
  Trash2,
  Undo2,
  Workflow,
  X
} from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { handleMenuKeyDown } from '@renderer/components/accessibility/menuKeyboard';
import { CommitSearchBar } from '@renderer/components/graph/CommitSearchBar';
import { buildCommitSearchIndex, findCommitSearchMatches } from '@renderer/components/graph/commitSearch';
import { TagMenuItems } from '@renderer/components/operations/TagMenuItems';
import {
  findCurrentBranchName,
  findSelectedContextMenuRow,
  orderSelectedCommitsForCherryPick,
  preferredBranchName,
  registerRefClick,
  resolveBulkSquashSelection,
  selectCommitRange,
  toggleSelectedCommit,
  type RefClickState
} from '@renderer/components/graph/graphInteraction';
import { branchNameFromRemoteRef } from '@renderer/lib/gitRefs';
import type { CheckoutTransition } from '@renderer/workspace/checkoutTransition';
import { FILE_STATUS_COLORS, laneColor } from '@shared/graph';
import type { CommitGraphRow, GitStashRefInput, GitTagDeleteInput, GraphFile, GraphRailSegment, GraphRefChip } from '@shared/types';

const ROW_HEIGHT = 34;
const LANE_X0 = 48;
const LANE_GAP = 28;
const GRAPH_NODE_EDGE_INSET = 18;
const DEFAULT_REF_CELL_WIDTH = 166;
const DEFAULT_GRAPH_VIEWPORT_WIDTH = 188;
const MIN_MESSAGE_CELL_WIDTH = 220;
const AUTHOR_CELL_WIDTH = 132;
const DATE_CELL_WIDTH = 92;
const SHA_CELL_WIDTH = 78;
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
  linkedWorktreeBranches: ReadonlySet<string>;
  selectedSha?: string;
  bulkSelectedShas: string[];
  isLoading: boolean;
  isFetching: boolean;
  errorMessage?: string;
  hasMore: boolean;
  onSelectRow: (sha: string) => void;
  onBulkSelectionChange: (shas: string[]) => void;
  onLoadMore: () => void;
  onStageAllWip?: () => Promise<void> | void;
  onOpenWipCommitComposer?: () => void;
  onStashPush?: () => Promise<void> | void;
  onStashApply?: (input: GitStashRefInput) => Promise<void> | void;
  onStashPop?: (input: GitStashRefInput) => Promise<void> | void;
  onStashDrop?: (input: GitStashRefInput) => Promise<void> | void;
  onCheckoutBranch?: (name: string) => Promise<void> | void;
  onRenameBranch?: (name: string) => Promise<void> | void;
  onActivateRemoteBranch?: (name: string) => Promise<void> | void;
  onMergeBranch?: (name: string) => Promise<void> | void;
  onRebaseOntoBranch?: (name: string) => Promise<void> | void;
  onInteractiveRebaseOntoBranch?: (name: string) => Promise<void> | void;
  onDeleteBranch?: (name: string) => Promise<void> | void;
  onCheckoutCommit?: (sha: string) => Promise<void> | void;
  onCreateBranchAtCommit?: (sha: string) => Promise<void> | void;
  onCreateTagAtCommit?: (sha: string, name: string) => Promise<boolean>;
  tagPushRemote?: string;
  onPushTag?: (name: string, remote: string) => Promise<void> | void;
  onDeleteTag?: (input: GitTagDeleteInput) => Promise<void> | void;
  onMergeCommit?: (sha: string) => Promise<void> | void;
  onRebaseOntoCommit?: (sha: string) => Promise<void> | void;
  onInteractiveRebaseFromCommit?: (sha: string) => Promise<void> | void;
  onCherryPickCommit?: (sha: string) => Promise<void> | void;
  onCherryPickCommits?: (shas: string[]) => Promise<void> | void;
  onSquashCommits?: (baseSha: string, squashShas: string[]) => Promise<void> | void;
  onRevertCommit?: (sha: string) => Promise<void> | void;
  onResetToCommit?: (sha: string) => Promise<void> | void;
  isOperationBusy?: boolean;
  checkoutTransition?: CheckoutTransition;
  largeRepoMode?: boolean;
  columns?: GraphColumnVisibility;
  remoteAvatars?: boolean;
  isSearchOpen?: boolean;
  searchFocusSignal?: number;
  onCloseSearch?: () => void;
};

type GraphColumnVisibility = {
  author: boolean;
  date: boolean;
  sha: boolean;
};

const DEFAULT_GRAPH_COLUMN_VISIBILITY: GraphColumnVisibility = {
  author: false,
  date: false,
  sha: false
};

type CommitContextMenuState = {
  kind: 'commit';
  row: CommitGraphRow;
  x: number;
  y: number;
};

type BranchContextMenuState = {
  kind: 'branch';
  branchName: string;
  currentBranchName: string;
  targetSha: string;
  x: number;
  y: number;
};

type TagContextMenuState = {
  kind: 'tag';
  tagName: string;
  x: number;
  y: number;
};

type ContextMenuState = CommitContextMenuState | BranchContextMenuState | TagContextMenuState;

export function GraphView({
  rows,
  linkedWorktreeBranches,
  selectedSha,
  bulkSelectedShas,
  isLoading,
  isFetching,
  errorMessage,
  hasMore,
  onSelectRow,
  onBulkSelectionChange,
  onLoadMore,
  onStageAllWip,
  onOpenWipCommitComposer,
  onStashPush,
  onStashApply,
  onStashPop,
  onStashDrop,
  onCheckoutBranch,
  onRenameBranch,
  onActivateRemoteBranch,
  onMergeBranch,
  onRebaseOntoBranch,
  onInteractiveRebaseOntoBranch,
  onDeleteBranch,
  onCheckoutCommit,
  onCreateBranchAtCommit,
  onCreateTagAtCommit,
  tagPushRemote,
  onPushTag,
  onDeleteTag,
  onMergeCommit,
  onRebaseOntoCommit,
  onInteractiveRebaseFromCommit,
  onCherryPickCommit,
  onCherryPickCommits,
  onSquashCommits,
  onRevertCommit,
  onResetToCommit,
  isOperationBusy = false,
  checkoutTransition,
  largeRepoMode = false,
  columns = DEFAULT_GRAPH_COLUMN_VISIBILITY,
  remoteAvatars = false,
  isSearchOpen = false,
  searchFocusSignal = 0,
  onCloseSearch
}: GraphViewProps): ReactElement {
  const sectionRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const graphScrollerRef = useRef<HTMLDivElement>(null);
  const lastRefClickRef = useRef<RefClickState | undefined>(undefined);
  const selectionAnchorShaRef = useRef<string | undefined>(selectedSha);
  const resizeStateRef = useRef<ColumnResizeState | undefined>(undefined);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>();
  const [tagCreationTargetSha, setTagCreationTargetSha] = useState<string>();
  const [columnWidths, setColumnWidths] = useState<GraphColumnWidths>(loadStoredGraphColumnWidths);
  const [graphContainerWidth, setGraphContainerWidth] = useState<number>();
  const [resizingColumn, setResizingColumn] = useState<ResizableGraphColumn>();
  const [graphScrollLeft, setGraphScrollLeft] = useState(0);
  const [firstVisibleRowIndex, setFirstVisibleRowIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearchSha, setActiveSearchSha] = useState<string>();
  const visibleColumns = useMemo(
    () => fitGraphColumnVisibility(columns, graphContainerWidth),
    [columns, graphContainerWidth]
  );
  const metadataWidth = graphMetadataWidth(visibleColumns);
  const graphWidth = columnWidths.graph;
  const graphContentWidth = useMemo(() => graphContentWidthForRows(rows, graphWidth), [graphWidth, rows]);
  const currentBranchName = useMemo(() => findCurrentBranchName(rows), [rows]);
  const dateMarkersByRow = useMemo(() => buildDateMarkers(rows), [rows]);
  const refCellWidth = columnWidths.refs;
  const gridTemplateColumns = graphGridTemplate(refCellWidth, graphWidth, visibleColumns);
  const currentDateMarker = dateMarkersByRow[firstVisibleRowIndex];
  const commitSearchIndex = useMemo(
    () => (isSearchOpen ? buildCommitSearchIndex(rows) : []),
    [isSearchOpen, rows]
  );
  const searchMatches = useMemo(
    () => findCommitSearchMatches(commitSearchIndex, searchQuery),
    [commitSearchIndex, searchQuery]
  );
  const searchMatchShas = useMemo(() => new Set(searchMatches.map((row) => row.sha)), [searchMatches]);
  const activeSearchMatchIndex = searchMatches.findIndex((row) => row.sha === activeSearchSha);
  const isSearchFiltering = isSearchOpen && searchQuery.trim().length > 0;
  const bulkSelection = useMemo(() => new Set(bulkSelectedShas), [bulkSelectedShas]);
  const cherryPickShas = useMemo(
    () => orderSelectedCommitsForCherryPick(rows, bulkSelectedShas),
    [bulkSelectedShas, rows]
  );
  const squashSelection = useMemo(
    () => resolveBulkSquashSelection(rows, bulkSelectedShas),
    [bulkSelectedShas, rows]
  );
  // TanStack Virtual is the row windowing layer for M2; the virtualizer stays local to this component.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: largeRepoMode ? 8 : 24
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const selectedRowIsMounted = virtualRows.some(
    (virtualRow) => rows[virtualRow.index]?.sha === selectedSha
  );

  useEffect(() => {
    const selectableShas = new Set(
      rows
        .filter((row) => row.node.kind !== 'wip' && row.node.kind !== 'stash')
        .map((row) => row.sha)
    );

    const next = bulkSelectedShas.filter((sha) => selectableShas.has(sha));

    if (next.length !== bulkSelectedShas.length) {
      onBulkSelectionChange(next.length > 1 ? next : []);
    }
  }, [bulkSelectedShas, onBulkSelectionChange, rows]);

  useEffect(() => {
    if (!selectedSha) {
      return;
    }

    const selectedIndex = rows.findIndex((row) => row.sha === selectedSha);

    if (selectedIndex >= 0) {
      rowVirtualizer.scrollToIndex(selectedIndex, { align: 'auto' });
    }
  }, [rowVirtualizer, rows, selectedSha]);

  useEffect(() => {
    if (bulkSelectedShas.length < 2) {
      selectionAnchorShaRef.current = selectedSha;
    }
  }, [bulkSelectedShas.length, selectedSha]);

  useEffect(() => {
    if (tagCreationTargetSha && !rows.some((row) => row.sha === tagCreationTargetSha)) {
      setTagCreationTargetSha(undefined);
    }
  }, [rows, tagCreationTargetSha]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setContextMenu(undefined);
        scrollRef.current?.focus({ preventScroll: true });
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

    setColumnWidths((current) => fitGraphColumnWidths(current, graphContainerWidth, metadataWidth));
  }, [graphContainerWidth, metadataWidth]);

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
      setColumnWidths((current) => resizeGraphColumn(current, state.column, nextWidth, graphContainerWidth, metadataWidth));
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
  }, [graphContainerWidth, metadataWidth, resizingColumn]);

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
    setTagCreationTargetSha(undefined);
    selectionAnchorShaRef.current = row.sha;
    onBulkSelectionChange([]);
    onSelectRow(row.sha);
    setContextMenu({
      kind: 'commit',
      row,
      x: event.clientX,
      y: event.clientY
    });
  }

  function handleRowClick(event: MouseEvent<HTMLDivElement>, row: CommitGraphRow): void {
    const isCommit = row.node.kind !== 'wip' && row.node.kind !== 'stash';

    if (event.shiftKey && isCommit) {
      const anchorSha = selectionAnchorShaRef.current ?? selectedSha ?? row.sha;
      const range = selectCommitRange(rows, anchorSha, row.sha);
      const next = event.metaKey || event.ctrlKey
        ? [...new Set([...bulkSelectedShas, ...range])]
        : range;

      onBulkSelectionChange(next.length > 1 ? next : []);
      onSelectRow(row.sha);
      return;
    }

    if ((event.metaKey || event.ctrlKey) && isCommit) {
      const focusedCommit = rows.find((candidate) => candidate.sha === selectedSha && candidate.node.kind !== 'wip' && candidate.node.kind !== 'stash');
      const initialSelection = bulkSelectedShas.length > 1
        ? bulkSelectedShas
        : focusedCommit
          ? [focusedCommit.sha]
          : [];
      const next = toggleSelectedCommit(initialSelection, row.sha);

      if (next.length > 1) {
        onBulkSelectionChange(next);
        onSelectRow(next.includes(row.sha) ? row.sha : (next.at(-1) ?? row.sha));
      } else {
        const remainingSha = next[0] ?? row.sha;
        selectionAnchorShaRef.current = remainingSha;
        onBulkSelectionChange([]);
        onSelectRow(remainingSha);
      }
      return;
    }

    selectionAnchorShaRef.current = row.sha;
    onBulkSelectionChange([]);
    onSelectRow(row.sha);
  }

  function handleBranchContextMenu(event: MouseEvent<HTMLElement>, row: CommitGraphRow, branchName: string): void {
    if (!currentBranchName) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setTagCreationTargetSha(undefined);
    selectionAnchorShaRef.current = row.sha;
    onBulkSelectionChange([]);
    onSelectRow(row.sha);
    setContextMenu({
      kind: 'branch',
      branchName,
      currentBranchName,
      targetSha: row.sha,
      x: event.clientX,
      y: event.clientY
    });
  }

  function handleTagContextMenu(event: MouseEvent<HTMLElement>, row: CommitGraphRow, tagName: string): void {
    event.preventDefault();
    event.stopPropagation();
    setTagCreationTargetSha(undefined);
    selectionAnchorShaRef.current = row.sha;
    onBulkSelectionChange([]);
    onSelectRow(row.sha);
    setContextMenu({
      kind: 'tag',
      tagName,
      x: event.clientX,
      y: event.clientY
    });
  }

  function handleStartTagCreation(sha: string): void {
    setTagCreationTargetSha(sha);
  }

  function handleCancelTagCreation(restoreGraphFocus = false): void {
    setTagCreationTargetSha(undefined);

    if (restoreGraphFocus) {
      window.requestAnimationFrame(() => scrollRef.current?.focus({ preventScroll: true }));
    }
  }

  function handleRefClick(row: CommitGraphRow, ref: GraphRefChip): void {
    selectionAnchorShaRef.current = row.sha;
    onBulkSelectionChange([]);
    onSelectRow(row.sha);

    const result = registerRefClick(lastRefClickRef.current, ref, Date.now());
    lastRefClickRef.current = result.nextState;

    if (!result.activate || isOperationBusy) {
      return;
    }

    if (ref.kind === 'branch' && ref.label !== currentBranchName && onCheckoutBranch) {
      void onCheckoutBranch(ref.label);
    }

    if (ref.kind === 'remote' && onActivateRemoteBranch) {
      void onActivateRemoteBranch(ref.label);
    }
  }

  function handleListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape' && bulkSelectedShas.length > 0) {
      event.preventDefault();
      onBulkSelectionChange([]);
      return;
    }

    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      const row = findSelectedContextMenuRow(rows, selectedSha);

      if (row) {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        setContextMenu({ kind: 'commit', row, x: rect.left + Math.min(rect.width / 2, 420), y: rect.top + 48 });
      }

      return;
    }

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
      selectionAnchorShaRef.current = nextRow.sha;
      onBulkSelectionChange([]);
      onSelectRow(nextRow.sha);
      rowVirtualizer.scrollToIndex(nextIndex, { align: 'auto' });
    }
  }

  function handleGraphScroll(event: ReactUIEvent<HTMLDivElement>): void {
    setGraphScrollLeft(event.currentTarget.scrollLeft);
  }

  function handleListScroll(event: ReactUIEvent<HTMLDivElement>): void {
    setFirstVisibleRowIndex(Math.min(rows.length - 1, Math.max(0, Math.floor(event.currentTarget.scrollTop / ROW_HEIGHT))));
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
    setColumnWidths((current) => resizeGraphColumn(current, column, current[column] + delta, graphContainerWidth, metadataWidth));
  }

  function handleColumnResizeReset(column: ResizableGraphColumn): void {
    setColumnWidths((current) =>
      resizeGraphColumn(current, column, GRAPH_COLUMN_LIMITS[column].defaultValue, graphContainerWidth, metadataWidth)
    );
  }

  function handleSearchQueryChange(query: string): void {
    const matches = findCommitSearchMatches(commitSearchIndex, query);
    const nextMatch = matches.find((row) => row.sha === selectedSha) ?? matches[0];

    setSearchQuery(query);
    setActiveSearchSha(nextMatch?.sha);

    if (nextMatch) {
      selectionAnchorShaRef.current = nextMatch.sha;
      onBulkSelectionChange([]);
      onSelectRow(nextMatch.sha);
    }
  }

  function handleSearchNavigate(direction: 1 | -1): void {
    if (searchMatches.length === 0) {
      return;
    }

    const currentIndex = activeSearchMatchIndex >= 0 ? activeSearchMatchIndex : direction === 1 ? -1 : 0;
    const nextIndex = (currentIndex + direction + searchMatches.length) % searchMatches.length;
    const nextMatch = searchMatches[nextIndex];

    if (nextMatch) {
      setActiveSearchSha(nextMatch.sha);
      selectionAnchorShaRef.current = nextMatch.sha;
      onBulkSelectionChange([]);
      onSelectRow(nextMatch.sha);
    }
  }

  function handleCloseSearch(): void {
    setSearchQuery('');
    setActiveSearchSha(undefined);
    onCloseSearch?.();
    window.requestAnimationFrame(() => scrollRef.current?.focus({ preventScroll: true }));
  }

  return (
    <section ref={sectionRef} className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-graph)]">
      {isSearchOpen ? (
        <CommitSearchBar
          query={searchQuery}
          resultCount={searchMatches.length}
          activeResultIndex={activeSearchMatchIndex}
          focusSignal={searchFocusSignal}
          onQueryChange={handleSearchQueryChange}
          onPrevious={() => handleSearchNavigate(-1)}
          onNext={() => handleSearchNavigate(1)}
          onClose={handleCloseSearch}
        />
      ) : null}
      <div
        className="grid h-7 shrink-0 items-center border-b border-[var(--border)] bg-[var(--bg-graph-header)] text-[11px] font-semibold uppercase text-[var(--text-3)]"
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
        <span className="flex h-full min-w-0 items-center justify-between pl-4 pr-3">
          <span className="leading-none tracking-[0.02em]">Commit message</span>
          <span className="flex items-center gap-2">
            {isFetching && rows.length > 0 ? <Loader2 size={13} className="animate-spin text-[var(--text-3)]" /> : null}
            {currentDateMarker ? <span className="truncate normal-case tracking-normal text-[var(--text-2)]">{currentDateMarker}</span> : null}
          </span>
        </span>
        {visibleColumns.author ? <span className="flex h-full items-center border-l border-[var(--border)] px-3">Author</span> : null}
        {visibleColumns.date ? <span className="flex h-full items-center border-l border-[var(--border)] px-3">Date</span> : null}
        {visibleColumns.sha ? <span className="flex h-full items-center border-l border-[var(--border)] px-3">SHA</span> : null}
      </div>

      <div
        ref={scrollRef}
        tabIndex={0}
        role="listbox"
        aria-label="Commit history"
        aria-multiselectable="true"
        aria-busy={isLoading || isFetching}
        aria-activedescendant={selectedSha && selectedRowIsMounted ? graphRowDomId(selectedSha) : undefined}
        onKeyDown={handleListKeyDown}
        onScroll={handleListScroll}
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
              {virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index];

                if (!row) {
                  return null;
                }

                return (
                  <div
                    key={row.sha}
                    className="graph-row-shell absolute left-0 top-0 w-full"
                    style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <GraphRowView
                      row={row}
                      linkedWorktreeBranches={linkedWorktreeBranches}
                      graphWidth={graphWidth}
                      graphContentWidth={graphContentWidth}
                      graphScrollLeft={graphScrollLeft}
                      refCellWidth={refCellWidth}
                      gridTemplateColumns={gridTemplateColumns}
                      visibleColumns={visibleColumns}
                      remoteAvatars={remoteAvatars}
                      pendingBranchName={checkoutTransition?.targetBranch}
                      isSelected={row.sha === selectedSha}
                      isBulkSelected={bulkSelection.has(row.sha)}
                      isSearchMatch={searchMatchShas.has(row.sha)}
                      isSearchFiltering={isSearchFiltering}
                      isCreatingTag={row.sha === tagCreationTargetSha}
                      rowIndex={virtualRow.index}
                      onSelect={(event) => handleRowClick(event, row)}
                      onContextMenu={(event) => handleContextMenu(event, row)}
                      onRefClick={(ref) => handleRefClick(row, ref)}
                      onBranchContextMenu={(event, branchName) => handleBranchContextMenu(event, row, branchName)}
                      onTagContextMenu={(event, tagName) => handleTagContextMenu(event, row, tagName)}
                      onCreateTag={
                        onCreateTagAtCommit
                          ? (name) => onCreateTagAtCommit(row.sha, name)
                          : undefined
                      }
                      onCancelTagCreation={handleCancelTagCreation}
                    />
                  </div>
                );
              })}
            </div>
            {hasMore ? (
              <div className="flex items-center justify-center gap-3 border-t border-[var(--border)] px-3 py-3">
                <button className="btn-primary h-8 text-xs" type="button" onClick={onLoadMore} disabled={isFetching}>
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

      {bulkSelectedShas.length > 1 ? (
        <BulkCommitActions
          count={bulkSelectedShas.length}
          canCherryPick={Boolean(onCherryPickCommits) && cherryPickShas.length > 0}
          squashSelection={squashSelection}
          isOperationBusy={isOperationBusy}
          onCherryPick={() => {
            void onCherryPickCommits?.(cherryPickShas);
          }}
          onSquash={() => {
            if (squashSelection.canSquash) {
              void onSquashCommits?.(squashSelection.baseSha, squashSelection.squashShas);
            }
          }}
          onClear={() => onBulkSelectionChange([])}
          canSquash={Boolean(onSquashCommits)}
        />
      ) : null}

      {contextMenu?.kind === 'branch' ? (
        <GraphBranchContextMenu
          state={contextMenu}
          onClose={() => {
            setContextMenu(undefined);
            scrollRef.current?.focus({ preventScroll: true });
          }}
          onCheckoutBranch={onCheckoutBranch}
          onRenameBranch={onRenameBranch}
          onCreateTagAtCommit={onCreateTagAtCommit ? handleStartTagCreation : undefined}
          onMergeBranch={onMergeBranch}
          onRebaseOntoBranch={onRebaseOntoBranch}
          onInteractiveRebaseOntoBranch={onInteractiveRebaseOntoBranch}
          onDeleteBranch={onDeleteBranch}
          isOperationBusy={isOperationBusy}
        />
      ) : contextMenu?.kind === 'tag' ? (
        <GraphTagContextMenu
          state={contextMenu}
          remoteName={tagPushRemote}
          onClose={() => {
            setContextMenu(undefined);
            scrollRef.current?.focus({ preventScroll: true });
          }}
          onPushTag={onPushTag}
          onDeleteTag={onDeleteTag}
          isOperationBusy={isOperationBusy}
        />
      ) : contextMenu ? (
        <GraphContextMenu
          state={contextMenu}
          onClose={() => {
            setContextMenu(undefined);
            scrollRef.current?.focus({ preventScroll: true });
          }}
          onStageAllWip={onStageAllWip}
          onOpenWipCommitComposer={onOpenWipCommitComposer}
          onStashPush={onStashPush}
          onStashApply={onStashApply}
          onStashPop={onStashPop}
          onStashDrop={onStashDrop}
          onCheckoutCommit={onCheckoutCommit}
          onCreateBranchAtCommit={onCreateBranchAtCommit}
          onCreateTagAtCommit={onCreateTagAtCommit ? handleStartTagCreation : undefined}
          onMergeCommit={onMergeCommit}
          onRebaseOntoCommit={onRebaseOntoCommit}
          onInteractiveRebaseFromCommit={onInteractiveRebaseFromCommit}
          onCherryPickCommit={onCherryPickCommit}
          onRevertCommit={onRevertCommit}
          onResetToCommit={onResetToCommit}
          currentBranchName={currentBranchName}
          isOperationBusy={isOperationBusy}
        />
      ) : null}
    </section>
  );
}

type GraphRowViewProps = {
  row: CommitGraphRow;
  linkedWorktreeBranches: ReadonlySet<string>;
  graphWidth: number;
  graphContentWidth: number;
  graphScrollLeft: number;
  refCellWidth: number;
  gridTemplateColumns: string;
  visibleColumns: GraphColumnVisibility;
  remoteAvatars: boolean;
  pendingBranchName?: string;
  isSelected: boolean;
  isBulkSelected: boolean;
  isSearchMatch: boolean;
  isSearchFiltering: boolean;
  isCreatingTag: boolean;
  rowIndex: number;
  onSelect: (event: MouseEvent<HTMLDivElement>) => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  onRefClick: (ref: GraphRefChip) => void;
  onBranchContextMenu: (event: MouseEvent<HTMLElement>, branchName: string) => void;
  onTagContextMenu: (event: MouseEvent<HTMLElement>, tagName: string) => void;
  onCreateTag?: (name: string) => Promise<boolean>;
  onCancelTagCreation: (restoreGraphFocus?: boolean) => void;
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
  linkedWorktreeBranches,
  graphWidth,
  graphContentWidth,
  graphScrollLeft,
  refCellWidth,
  gridTemplateColumns,
  visibleColumns,
  remoteAvatars,
  pendingBranchName,
  isSelected,
  isBulkSelected,
  isSearchMatch,
  isSearchFiltering,
  isCreatingTag,
  rowIndex,
  onSelect,
  onContextMenu,
  onRefClick,
  onBranchContextMenu,
  onTagContextMenu,
  onCreateTag,
  onCancelTagCreation
}: GraphRowViewProps): ReactElement {
  const nodeColor = row.colorOverride ?? laneColor(row.node.lane);
  const isWip = row.node.kind === 'wip';
  const visibleRefs = isWip ? [] : (row.refs ?? []);
  const rowBackground = graphRowBackground(row, isSelected, rowIndex, isSearchMatch, isBulkSelected);
  const bandBackground = graphRowBandBackground(row, nodeColor, isSelected || isBulkSelected);

  return (
    <div
      id={graphRowDomId(row.sha)}
      className="graph-row group relative grid cursor-pointer items-center"
      role="option"
      aria-selected={isSelected || isBulkSelected}
      aria-label={graphRowAriaLabel(row)}
      data-bulk-selected={isBulkSelected ? 'true' : undefined}
      data-search-match={isSearchFiltering && isSearchMatch ? 'true' : undefined}
      data-search-muted={isSearchFiltering && !isSearchMatch ? 'true' : undefined}
      tabIndex={-1}
      style={{
        height: ROW_HEIGHT,
        gridTemplateColumns,
        background: rowBackground,
        boxShadow: isBulkSelected
          ? `inset 3px 0 0 rgba(36, 196, 222, 0.82), inset 0 0 0 1px rgba(36, 196, 222, ${isSelected ? '0.72' : '0.28'})`
          : isSelected
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
        <RefChipStack
          refs={visibleRefs}
          linkedWorktreeBranches={linkedWorktreeBranches}
          color={nodeColor}
          pendingBranchName={pendingBranchName}
          onRefClick={onRefClick}
          onBranchContextMenu={onBranchContextMenu}
          onTagContextMenu={onTagContextMenu}
        />
      </div>

      <RailCell
        row={row}
        nodeColor={nodeColor}
        graphWidth={graphWidth}
        graphContentWidth={graphContentWidth}
        graphScrollLeft={graphScrollLeft}
        remoteAvatars={remoteAvatars}
      />

      {isCreatingTag && onCreateTag ? (
        <InlineTagEditor
          targetSha={row.sha}
          refCellWidth={refCellWidth}
          onCreate={onCreateTag}
          onCancel={onCancelTagCreation}
        />
      ) : null}

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
      {visibleColumns.author ? (
        <span className="relative min-w-0 truncate border-l border-[var(--border)] px-3 text-[12px] text-[var(--text-2)]" title={row.author.email ?? row.author.name}>
          {isWip ? 'Working directory' : row.author.name || 'Unknown'}
        </span>
      ) : null}
      {visibleColumns.date ? (
        <span className="relative truncate border-l border-[var(--border)] px-3 text-[11px] tabular-nums text-[var(--text-2)]" title={row.authoredAt ?? row.committedAt}>
          {isWip ? 'Now' : row.dateLabel}
        </span>
      ) : null}
      {visibleColumns.sha ? (
        <span className="mono relative truncate border-l border-[var(--border)] px-3 text-[11px] text-[var(--text-3)]">
          {isWip ? '' : row.sha.slice(0, 7)}
        </span>
      ) : null}
    </div>
  );
}

function InlineTagEditor({
  targetSha,
  refCellWidth,
  onCreate,
  onCancel
}: {
  targetSha: string;
  refCellWidth: number;
  onCreate: (name: string) => Promise<boolean>;
  onCancel: (restoreGraphFocus?: boolean) => void;
}): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const editorLeft = 8;
  const editorWidth = Math.max(112, refCellWidth - editorLeft - 6);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const tagName = name.trim();

    if (!tagName || submittingRef.current) {
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    const created = await onCreate(tagName);

    if (created) {
      onCancel();
      return;
    }

    submittingRef.current = false;
    setIsSubmitting(false);
    window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }

  return (
    <form
      className="absolute inset-y-0 z-30 flex cursor-default items-center"
      style={{ left: editorLeft, width: editorWidth }}
      aria-label={`Create tag at ${targetSha.slice(0, 8)}`}
      aria-busy={isSubmitting}
      onSubmit={(event) => void handleSubmit(event)}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onBlur={() => {
        if (!submittingRef.current) {
          onCancel();
        }
      }}
    >
      <input
        ref={inputRef}
        className="h-7 w-full cursor-text rounded-md border-2 border-[var(--select-border)] bg-[var(--bg-field)] px-3 text-[13px] text-[var(--text-1)] shadow-lg shadow-black/30 outline-none placeholder:text-[var(--text-3)] focus:ring-1 focus:ring-[var(--select-border)]"
        type="text"
        value={name}
        placeholder="Enter tag name"
        aria-label="Tag name"
        autoFocus
        disabled={isSubmitting}
        spellCheck={false}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();

          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel(true);
          }
        }}
      />
    </form>
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
  containerWidth: number | undefined,
  metadataWidth = 0
): GraphColumnWidths {
  const nextWidth = clampGraphColumnWidth(column, width, widths, containerWidth, metadataWidth);

  if (widths[column] === nextWidth) {
    return widths;
  }

  return { ...widths, [column]: nextWidth };
}

function fitGraphColumnWidths(widths: GraphColumnWidths, containerWidth: number, metadataWidth = 0): GraphColumnWidths {
  const graph = clampGraphColumnWidth('graph', widths.graph, widths, containerWidth, metadataWidth);
  const nextWidths = { ...widths, graph };
  const refs = clampGraphColumnWidth('refs', nextWidths.refs, nextWidths, containerWidth, metadataWidth);

  if (widths.refs === refs && widths.graph === graph) {
    return widths;
  }

  return { refs, graph };
}

function clampGraphColumnWidth(
  column: ResizableGraphColumn,
  width: number,
  widths?: GraphColumnWidths,
  containerWidth?: number,
  metadataWidth = 0
): number {
  const limits = GRAPH_COLUMN_LIMITS[column];
  const otherColumn = column === 'refs' ? 'graph' : 'refs';
  const maxWidth =
    widths && containerWidth
      ? Math.min(limits.max, Math.max(limits.min, containerWidth - widths[otherColumn] - MIN_MESSAGE_CELL_WIDTH - metadataWidth))
      : limits.max;

  return Math.round(Math.min(maxWidth, Math.max(limits.min, width)));
}

function fitGraphColumnVisibility(
  requested: GraphColumnVisibility,
  containerWidth: number | undefined
): GraphColumnVisibility {
  const visible = { ...requested };

  if (!containerWidth) {
    return visible;
  }

  const baseWidth = GRAPH_COLUMN_LIMITS.refs.min + GRAPH_COLUMN_LIMITS.graph.min + MIN_MESSAGE_CELL_WIDTH;
  const hideOrder: Array<keyof GraphColumnVisibility> = ['sha', 'author', 'date'];

  for (const column of hideOrder) {
    if (baseWidth + graphMetadataWidth(visible) <= containerWidth) {
      break;
    }

    visible[column] = false;
  }

  return visible;
}

function graphMetadataWidth(columns: GraphColumnVisibility): number {
  return (columns.author ? AUTHOR_CELL_WIDTH : 0) + (columns.date ? DATE_CELL_WIDTH : 0) + (columns.sha ? SHA_CELL_WIDTH : 0);
}

function graphGridTemplate(refs: number, graph: number, columns: GraphColumnVisibility): string {
  return [
    `${refs}px`,
    `${graph}px`,
    'minmax(0, 1fr)',
    columns.author ? `${AUTHOR_CELL_WIDTH}px` : undefined,
    columns.date ? `${DATE_CELL_WIDTH}px` : undefined,
    columns.sha ? `${SHA_CELL_WIDTH}px` : undefined
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ');
}

function buildDateMarkers(rows: CommitGraphRow[]): Array<string | undefined> {
  let currentMarker: string | undefined;

  return rows.map((row) => {
    currentMarker = row.dateMarker ?? currentMarker ?? row.dateLabel;
    return currentMarker;
  });
}

function graphRowDomId(sha: string): string {
  return `graph-row-${sha.replace(/[^\dA-Za-z_-]/g, '-')}`;
}

function graphRowAriaLabel(row: CommitGraphRow): string {
  if (row.node.kind === 'wip') {
    return `Working directory, ${row.files.length} changed files`;
  }

  const refs = row.refs?.map((ref) => ref.label).join(', ');
  return [row.subject, row.author.name, row.dateLabel, row.sha.slice(0, 7), refs].filter(Boolean).join(', ');
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

function graphRowBackground(
  row: CommitGraphRow,
  isSelected: boolean,
  rowIndex: number,
  isSearchMatch = false,
  isBulkSelected = false
): string | undefined {
  if (isBulkSelected) {
    return 'linear-gradient(90deg, rgba(20, 91, 111, 0.58), rgba(22, 69, 91, 0.48) 64%, rgba(24, 45, 62, 0.46))';
  }

  if (isSelected) {
    return 'linear-gradient(90deg, rgba(34, 77, 145, 0.58), rgba(31, 65, 120, 0.50) 64%, rgba(28, 45, 76, 0.50))';
  }

  if (isSearchMatch) {
    return 'linear-gradient(90deg, rgba(52, 91, 155, 0.28), rgba(35, 63, 108, 0.18) 68%, rgba(25, 37, 55, 0.12))';
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

function RefChipStack({
  refs,
  linkedWorktreeBranches,
  color,
  pendingBranchName,
  onRefClick,
  onBranchContextMenu,
  onTagContextMenu
}: {
  refs: GraphRefChip[];
  linkedWorktreeBranches: ReadonlySet<string>;
  color: string;
  pendingBranchName?: string;
  onRefClick: (ref: GraphRefChip) => void;
  onBranchContextMenu: (event: MouseEvent<HTMLElement>, branchName: string) => void;
  onTagContextMenu: (event: MouseEvent<HTMLElement>, tagName: string) => void;
}): ReactElement | null {
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
        <RefChipView
          chip={primaryRef}
          linkedWorktreeBranches={linkedWorktreeBranches}
          color={color}
          pendingBranchName={pendingBranchName}
          onRefClick={onRefClick}
          onBranchContextMenu={onBranchContextMenu}
          onTagContextMenu={onTagContextMenu}
        />
        {overflowRefs.length > 0 ? (
          <span
            className="ref-overflow"
            style={{ background: hexToRgba(color, 0.3), color: 'var(--text-1)' }}
            title={title}
          >
            +{overflowRefs.length}
          </span>
        ) : null}
      </div>
      {overflowRefs.length > 0 ? (
        <div className="ref-stack-expanded">
          {displayRefs.map((chip) => (
            <RefChipView
              key={`${chip.kind}:${chip.label}`}
              chip={chip}
              linkedWorktreeBranches={linkedWorktreeBranches}
              color={color}
              pendingBranchName={pendingBranchName}
              onRefClick={onRefClick}
              onBranchContextMenu={onBranchContextMenu}
              onTagContextMenu={onTagContextMenu}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RefChipView({
  chip,
  linkedWorktreeBranches,
  color,
  pendingBranchName,
  onRefClick,
  onBranchContextMenu,
  onTagContextMenu
}: {
  chip: RefChipDisplay;
  linkedWorktreeBranches: ReadonlySet<string>;
  color: string;
  pendingBranchName?: string;
  onRefClick: (ref: GraphRefChip) => void;
  onBranchContextMenu: (event: MouseEvent<HTMLElement>, branchName: string) => void;
  onTagContextMenu: (event: MouseEvent<HTMLElement>, tagName: string) => void;
}): ReactElement {
  const { current, kind, label, remotePeerLabels } = chip;
  const hasRemotePeer = (remotePeerLabels?.length ?? 0) > 0;
  const isLinkedWorktree = kind === 'branch' && linkedWorktreeBranches.has(label);
  const isPending = kind === 'branch' && label === pendingBranchName;
  const displayLabel = kind === 'remote' ? branchNameFromRemoteRef(label) : label;
  const title = refChipTitle(chip);
  const ariaLabel = `${label}${isPending ? ', checkout in progress' : current ? ', checked out' : isLinkedWorktree ? ', checked out in a linked worktree' : ''}${hasRemotePeer ? `, tracks ${remotePeerLabels?.join(', ')}` : ''}`;
  const leadingIcon =
    isPending ? (
      <Loader2 size={12} className="animate-spin" aria-hidden="true" />
    ) : current ? (
      <Check size={12} />
    ) : kind === 'tag' ? (
      <Tag size={10} />
    ) : kind === 'stash' ? (
      <Archive size={10} />
    ) : kind === 'remote' ? null : (
      <Pencil size={10} />
    );

  const style = {
    background: hexToRgba(color, current ? 0.78 : 0.3),
    color: 'var(--text-1)'
  };
  const content = (
    <>
      {leadingIcon}
      <span className="ref-chip-label" title={label}>{displayLabel}</span>
      {kind === 'remote' ? <Cloud size={12} className="ref-chip-extra-icon" aria-hidden="true" /> : null}
      {kind === 'branch' ? (
        isLinkedWorktree ? (
          <TreePine size={13} className="ref-chip-extra-icon" aria-hidden="true" />
        ) : (
          <LaptopMinimal size={13} className="ref-chip-extra-icon" aria-hidden="true" />
        )
      ) : null}
      {hasRemotePeer ? <Cloud size={12} className="ref-chip-extra-icon" aria-hidden="true" /> : null}
    </>
  );

  if (kind === 'stash') {
    return (
      <span className="ref-chip" style={style} title={title} aria-label={ariaLabel}>
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="ref-chip"
      data-pending={isPending ? 'true' : undefined}
      style={style}
      title={
        isPending
          ? `Switching to ${label}…`
          : kind === 'tag'
            ? `${title}\nRight-click for tag actions.`
          : current && kind === 'branch'
          ? `${title}\nRight-click for branch actions.`
          : current
            ? title
            : `${title}\nDouble-click to ${kind === 'remote' ? 'pull or checkout' : 'checkout'}.${kind === 'branch' ? ' Right-click for branch actions.' : ''}`
      }
      aria-label={ariaLabel}
      aria-haspopup={kind === 'tag' ? 'menu' : undefined}
      aria-busy={isPending ? true : undefined}
      onClick={(event) => {
        event.stopPropagation();
        onRefClick(chip);
      }}
      onContextMenu={(event) => {
        if (kind === 'branch') {
          onBranchContextMenu(event, label);
        } else if (kind === 'tag') {
          onTagContextMenu(event, label);
        }
      }}
    >
      {content}
    </button>
  );
}

function coalesceRemotePeers(refs: GraphRefChip[]): RefChipDisplay[] {
  const localBranchLabels = new Set(refs.filter((ref) => ref.kind === 'branch').map((ref) => ref.label));
  const remotePeersByLocalBranch = new Map<string, string[]>();

  for (const ref of refs) {
    if (ref.kind !== 'remote') {
      continue;
    }

    const localBranchName = branchNameFromRemoteRef(ref.label);

    if (!localBranchLabels.has(localBranchName)) {
      continue;
    }

    const remotePeers = remotePeersByLocalBranch.get(localBranchName) ?? [];
    remotePeers.push(ref.label);
    remotePeersByLocalBranch.set(localBranchName, remotePeers);
  }

  return refs.flatMap((ref) => {
    if (ref.kind === 'remote' && localBranchLabels.has(branchNameFromRemoteRef(ref.label))) {
      return [];
    }

    if (ref.kind !== 'branch') {
      return [{ ...ref }];
    }

    const remotePeerLabels = remotePeersByLocalBranch.get(ref.label);

    return [{ ...ref, ...(remotePeerLabels?.length ? { remotePeerLabels } : {}) }];
  });
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
  graphScrollLeft,
  remoteAvatars
}: {
  row: CommitGraphRow;
  nodeColor: string;
  graphWidth: number;
  graphContentWidth: number;
  graphScrollLeft: number;
  remoteAvatars: boolean;
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
          authorInitials={row.author.initials}
          avatarUrl={remoteAvatars ? row.author.avatarUrl : undefined}
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
  authorInitials: string;
  avatarUrl?: string;
  title: string;
};

function GraphNode({ nodeId, kind, cx, cy, color, authorColor, authorInitials, avatarUrl, title }: GraphNodeProps): ReactElement {
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
          <text x={cx} y={cy + 2.2} textAnchor="middle" fontSize="6.3" fontWeight="700" fill="var(--bg-field)">
            {authorInitials.slice(0, 2)}
          </text>
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
    <div className="grid h-full min-h-[240px] place-items-center text-xs text-[var(--text-3)]" role="status">
      <div className="flex items-center gap-2">
        {icon}
        <span>{label}</span>
      </div>
    </div>
  );
}

function BulkCommitActions({
  count,
  canCherryPick,
  canSquash,
  squashSelection,
  isOperationBusy,
  onCherryPick,
  onSquash,
  onClear
}: {
  count: number;
  canCherryPick: boolean;
  canSquash: boolean;
  squashSelection: ReturnType<typeof resolveBulkSquashSelection>;
  isOperationBusy: boolean;
  onCherryPick: () => void;
  onSquash: () => void;
  onClear: () => void;
}): ReactElement {
  const squashTitle = !canSquash
    ? 'Squash is unavailable.'
    : squashSelection.canSquash
      ? `Squash ${count} selected commits`
      : squashSelection.reason;

  return (
    <div
      className="absolute bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1.5 rounded-lg border border-[var(--select-border)] bg-[var(--bg-popover)] p-1.5 shadow-2xl shadow-black/70"
      role="toolbar"
      aria-label="Bulk commit actions"
      data-testid="bulk-commit-actions"
    >
      <span className="flex h-7 items-center gap-2 whitespace-nowrap border-r border-[var(--border)] pl-2 pr-3 text-xs font-semibold text-[var(--text-1)]">
        <span className="grid h-5 min-w-5 place-items-center rounded bg-[var(--accent)] px-1 text-[10px] font-bold text-[var(--bg-field)]">
          {count}
        </span>
        {count === 1 ? 'commit selected' : 'commits selected'}
      </span>
      <button
        className="btn-subtle h-7 whitespace-nowrap text-[11px]"
        type="button"
        disabled={!canCherryPick || isOperationBusy}
        onClick={onCherryPick}
        title={`Cherry-pick ${count} selected ${count === 1 ? 'commit' : 'commits'} oldest to newest`}
      >
        <Cherry size={13} />
        <span>Cherry-pick</span>
      </button>
      <button
        className="btn-subtle h-7 whitespace-nowrap text-[11px]"
        type="button"
        disabled={!canSquash || !squashSelection.canSquash || isOperationBusy}
        onClick={onSquash}
        title={squashTitle}
      >
        <GitMerge size={13} />
        <span>Squash</span>
      </button>
      <button
        className="icon-btn h-7 w-7"
        type="button"
        onClick={onClear}
        aria-label="Clear commit selection"
        title="Clear selection (Esc)"
      >
        <X size={13} />
      </button>
    </div>
  );
}

function MenuSeparator(): ReactElement {
  return <div className="mx-1.5 my-1 h-px bg-[var(--border)]" />;
}

function GraphTagContextMenu({
  state,
  remoteName,
  onClose,
  onPushTag,
  onDeleteTag,
  isOperationBusy
}: {
  state: TagContextMenuState;
  remoteName?: string;
  onClose: () => void;
  onPushTag?: (name: string, remote: string) => Promise<void> | void;
  onDeleteTag?: (input: GitTagDeleteInput) => Promise<void> | void;
  isOperationBusy: boolean;
}): ReactElement {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: state.x, top: state.y });

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
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [state]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-[22rem] rounded-lg border border-[var(--border-strong)] bg-[var(--bg-popover)] p-1.5 shadow-2xl shadow-black/60"
      style={{ left: position.left, top: position.top }}
      role="menu"
      aria-label={`${state.tagName} tag actions`}
      onKeyDown={(event) => handleMenuKeyDown(event, onClose)}
      onClick={(event) => event.stopPropagation()}
    >
      <TagMenuItems
        tagName={state.tagName}
        remoteName={remoteName}
        isOperationBusy={isOperationBusy}
        onPushTag={onPushTag}
        onDeleteTag={onDeleteTag}
        onClose={onClose}
      />
    </div>
  );
}

function GraphBranchContextMenu({
  state,
  onClose,
  onCheckoutBranch,
  onRenameBranch,
  onCreateTagAtCommit,
  onMergeBranch,
  onRebaseOntoBranch,
  onInteractiveRebaseOntoBranch,
  onDeleteBranch,
  isOperationBusy
}: {
  state: BranchContextMenuState;
  onClose: () => void;
  onCheckoutBranch?: (name: string) => Promise<void> | void;
  onRenameBranch?: (name: string) => Promise<void> | void;
  onCreateTagAtCommit?: (sha: string) => Promise<void> | void;
  onMergeBranch?: (name: string) => Promise<void> | void;
  onRebaseOntoBranch?: (name: string) => Promise<void> | void;
  onInteractiveRebaseOntoBranch?: (name: string) => Promise<void> | void;
  onDeleteBranch?: (name: string) => Promise<void> | void;
  isOperationBusy: boolean;
}): ReactElement {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: state.x, top: state.y });
  const isCurrentBranch = state.branchName === state.currentBranchName;

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
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [state]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-80 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-popover)] p-1.5 shadow-2xl shadow-black/60"
      style={{ left: position.left, top: position.top }}
      role="menu"
      aria-label={`${state.branchName} branch actions`}
      onKeyDown={(event) => handleMenuKeyDown(event, onClose)}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        className="menu-row"
        type="button"
        role="menuitem"
        disabled={!onCheckoutBranch || isCurrentBranch || isOperationBusy}
        onClick={() => {
          void onCheckoutBranch?.(state.branchName);
          onClose();
        }}
      >
        <Check size={14} />
        <span>Checkout {state.branchName}</span>
      </button>
      <button
        className="menu-row"
        type="button"
        role="menuitem"
        disabled={!onRenameBranch || isOperationBusy}
        onClick={() => {
          void onRenameBranch?.(state.branchName);
          onClose();
        }}
      >
        <Pencil size={14} />
        <span>Rename branch…</span>
      </button>
      <button
        className="menu-row"
        type="button"
        role="menuitem"
        disabled={!onCreateTagAtCommit || isOperationBusy}
        onClick={() => {
          void onCreateTagAtCommit?.(state.targetSha);
          onClose();
        }}
      >
        <Tag size={14} />
        <span>Create tag here</span>
      </button>
      <MenuSeparator />
      <button
        className="menu-row"
        type="button"
        role="menuitem"
        disabled={!onMergeBranch || isCurrentBranch || isOperationBusy}
        onClick={() => {
          void onMergeBranch?.(state.branchName);
          onClose();
        }}
      >
        <GitMerge size={14} />
        <span>Merge {state.branchName} into {state.currentBranchName}</span>
      </button>
      <button
        className="menu-row"
        type="button"
        role="menuitem"
        disabled={!onRebaseOntoBranch || isCurrentBranch || isOperationBusy}
        onClick={() => {
          void onRebaseOntoBranch?.(state.branchName);
          onClose();
        }}
      >
        <RefreshCw size={14} />
        <span>Rebase {state.currentBranchName} onto {state.branchName}</span>
      </button>
      <button
        className="menu-row"
        type="button"
        role="menuitem"
        disabled={!onInteractiveRebaseOntoBranch || isCurrentBranch || isOperationBusy}
        onClick={() => {
          void onInteractiveRebaseOntoBranch?.(state.branchName);
          onClose();
        }}
      >
        <Workflow size={14} />
        <span>Interactive rebase {state.currentBranchName} onto {state.branchName}</span>
      </button>
      <MenuSeparator />
      <button
        className="menu-row"
        type="button"
        role="menuitem"
        disabled={!onDeleteBranch || isCurrentBranch || isOperationBusy}
        onClick={() => {
          void onDeleteBranch?.(state.branchName);
          onClose();
        }}
      >
        <Trash2 size={14} />
        <span>Delete local or remote branch…</span>
      </button>
    </div>
  );
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
  currentBranchName,
  isOperationBusy
}: {
  state: CommitContextMenuState;
  onClose: () => void;
  onStageAllWip?: () => Promise<void> | void;
  onOpenWipCommitComposer?: () => void;
  onStashPush?: () => Promise<void> | void;
  onStashApply?: (input: GitStashRefInput) => Promise<void> | void;
  onStashPop?: (input: GitStashRefInput) => Promise<void> | void;
  onStashDrop?: (input: GitStashRefInput) => Promise<void> | void;
  onCheckoutCommit?: (sha: string) => Promise<void> | void;
  onCreateBranchAtCommit?: (sha: string) => Promise<void> | void;
  onCreateTagAtCommit?: (sha: string) => Promise<void> | void;
  onMergeCommit?: (sha: string) => Promise<void> | void;
  onRebaseOntoCommit?: (sha: string) => Promise<void> | void;
  onInteractiveRebaseFromCommit?: (sha: string) => Promise<void> | void;
  onCherryPickCommit?: (sha: string) => Promise<void> | void;
  onRevertCommit?: (sha: string) => Promise<void> | void;
  onResetToCommit?: (sha: string) => Promise<void> | void;
  currentBranchName?: string;
  isOperationBusy: boolean;
}): ReactElement {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: state.x, top: state.y });
  const isWip = state.row.node.kind === 'wip';
  const isStash = state.row.node.kind === 'stash';
  const stashSelector = stashSelectorForRow(state.row);
  const branchName = preferredBranchName(state.row);

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
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [state]);

  async function copySha(): Promise<void> {
    await navigator.clipboard.writeText(state.row.sha);
    onClose();
  }

  async function copyBranchName(): Promise<void> {
    if (!branchName) {
      return;
    }

    await navigator.clipboard.writeText(branchName);
    onClose();
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-80 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-popover)] p-1.5 shadow-2xl shadow-black/60"
      style={{ left: position.left, top: position.top }}
      role="menu"
      aria-label="Commit actions"
      onKeyDown={(event) => handleMenuKeyDown(event, onClose)}
      onClick={(event) => event.stopPropagation()}
    >
      {isWip ? (
        <>
          <button
            className="menu-row"
            type="button"
            role="menuitem"
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
            role="menuitem"
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
            role="menuitem"
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
            role="menuitem"
            disabled={!onStashApply || !stashSelector || isOperationBusy}
            onClick={() => {
              if (stashSelector) {
                void onStashApply?.({ selector: stashSelector, expectedSha: state.row.sha });
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
            role="menuitem"
            disabled={!onStashPop || !stashSelector || isOperationBusy}
            onClick={() => {
              if (stashSelector) {
                void onStashPop?.({ selector: stashSelector, expectedSha: state.row.sha });
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
            role="menuitem"
            disabled={!onStashDrop || !stashSelector || isOperationBusy}
            onClick={() => {
              if (stashSelector) {
                void onStashDrop?.({ selector: stashSelector, expectedSha: state.row.sha });
              }

              onClose();
            }}
          >
            <Trash2 size={14} />
            <span>Drop stash</span>
          </button>
          <MenuSeparator />
          <button className="menu-row" type="button" role="menuitem" onClick={() => void copySha()}>
            <Copy size={14} />
            <span>Copy stash SHA</span>
          </button>
        </>
      ) : (
        <>
          <button
            className="menu-row"
            type="button"
            role="menuitem"
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
            role="menuitem"
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
            role="menuitem"
            disabled={!onCreateTagAtCommit || isOperationBusy}
            onClick={() => {
              void onCreateTagAtCommit?.(state.row.sha);
              onClose();
            }}
          >
            <Tag size={14} />
            <span>Create tag here</span>
          </button>
          <MenuSeparator />
          <button
            className="menu-row"
            type="button"
            role="menuitem"
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
            role="menuitem"
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
            role="menuitem"
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
            role="menuitem"
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
            role="menuitem"
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
            role="menuitem"
            disabled={!onResetToCommit || isOperationBusy}
            onClick={() => {
              void onResetToCommit?.(state.row.sha);
              onClose();
            }}
          >
            <RotateCcw size={14} />
            <span>Reset {currentBranchName ?? 'HEAD'} to this commit…</span>
          </button>
          <MenuSeparator />
          <button className="menu-row" type="button" role="menuitem" onClick={() => void copySha()}>
            <Copy size={14} />
            <span>Copy commit SHA</span>
          </button>
          <button
            className="menu-row"
            type="button"
            role="menuitem"
            disabled={!branchName}
            title={branchName ? `Copy ${branchName}` : 'No branch points to this commit'}
            onClick={() => void copyBranchName()}
          >
            <GitBranch size={14} />
            <span>Copy branch name</span>
          </button>
        </>
      )}
    </div>
  );
}


function stashSelectorForRow(row: CommitGraphRow): string | undefined {
  return row.refs?.find((ref) => ref.kind === 'stash')?.label;
}
