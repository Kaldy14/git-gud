import type { CommitGraphRow } from '@shared/types';

export const LANE_X0 = 22;
export const LANE_GAP = 22;
const GRAPH_CONTENT_RIGHT_PADDING = 20;
const MIN_MESSAGE_CELL_WIDTH = 260;
const AUTHOR_CELL_WIDTH = 132;
const DATE_CELL_WIDTH = 92;
const SHA_CELL_WIDTH = 78;
const AUTO_GRAPH_MIN_WIDTH = 72;
const AUTO_GRAPH_MAX_WIDTH = 240;

export const GRAPH_METADATA_CELL_WIDTHS = {
  author: AUTHOR_CELL_WIDTH,
  date: DATE_CELL_WIDTH,
  sha: SHA_CELL_WIDTH
} as const;

export type ResizableGraphColumn = 'refs' | 'graph';
export type GraphColumnWidths = Record<ResizableGraphColumn, number>;
/** The widths the user chose. A missing column follows its automatic width. */
export type GraphColumnPreferences = Partial<GraphColumnWidths>;
export type GraphColumnVisibility = Record<keyof typeof GRAPH_METADATA_CELL_WIDTHS, boolean>;

type GraphColumnLimit = { min: number; max: number };

export const GRAPH_COLUMN_LIMITS: Record<ResizableGraphColumn, GraphColumnLimit> = {
  refs: { min: 124, max: 360 },
  graph: { min: 64, max: 520 }
};
const DEFAULT_REF_CELL_WIDTH = 133;

export type GraphColumnFit = {
  /** Width of the widest lane layout, from `graphLanesWidth`. */
  lanesWidth: number;
  containerWidth: number | undefined;
  metadataWidth: number;
};

export function graphLanesWidth(rows: readonly CommitGraphRow[]): number {
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

  return LANE_X0 + maxLane * LANE_GAP + GRAPH_CONTENT_RIGHT_PADDING;
}

/**
 * Derives the drawn widths from the preferences on every layout, and never writes back.
 * Narrowing the window therefore cannot erode a preference: widening restores it.
 * Lanes that no longer fit stay reachable through the graph's horizontal scroller.
 */
export function fitGraphColumnWidths(
  preferences: GraphColumnPreferences,
  { lanesWidth, containerWidth, metadataWidth }: GraphColumnFit
): GraphColumnWidths {
  const refs = preferences.refs ?? DEFAULT_REF_CELL_WIDTH;
  const graph = preferences.graph ?? clamp(lanesWidth, AUTO_GRAPH_MIN_WIDTH, AUTO_GRAPH_MAX_WIDTH);

  if (!containerWidth) {
    return { refs, graph };
  }

  const budget = containerWidth - metadataWidth - MIN_MESSAGE_CELL_WIDTH;
  const overflow = refs + graph - budget;

  if (overflow <= 0) {
    return { refs, graph };
  }

  const fittedRefs = Math.max(GRAPH_COLUMN_LIMITS.refs.min, refs - overflow);

  return {
    refs: fittedRefs,
    graph: Math.min(graph, Math.max(GRAPH_COLUMN_LIMITS.graph.min, budget - fittedRefs))
  };
}

/** Records a width the user asked for, limited to what the message column can give up right now. */
export function resizeGraphColumnPreference(
  preferences: GraphColumnPreferences,
  column: ResizableGraphColumn,
  width: number,
  otherColumnWidth: number,
  { containerWidth, metadataWidth }: Pick<GraphColumnFit, 'containerWidth' | 'metadataWidth'>
): GraphColumnPreferences {
  const { min, max } = GRAPH_COLUMN_LIMITS[column];
  const available = containerWidth
    ? containerWidth - otherColumnWidth - MIN_MESSAGE_CELL_WIDTH - metadataWidth
    : max;
  const nextWidth = Math.round(clamp(width, min, Math.max(min, Math.min(max, available))));

  return preferences[column] === nextWidth ? preferences : { ...preferences, [column]: nextWidth };
}

export function resetGraphColumnPreference(
  preferences: GraphColumnPreferences,
  column: ResizableGraphColumn
): GraphColumnPreferences {
  const remaining = { ...preferences };
  delete remaining[column];
  return remaining;
}

export function parseGraphColumnPreferences(value: unknown): GraphColumnPreferences {
  if (typeof value !== 'object' || value === null) {
    return {};
  }

  const stored = value as Record<string, unknown>;
  const preferences: GraphColumnPreferences = {};

  for (const column of ['refs', 'graph'] as const) {
    const width = stored[column];

    if (typeof width === 'number' && Number.isFinite(width)) {
      preferences[column] = Math.round(clamp(width, GRAPH_COLUMN_LIMITS[column].min, GRAPH_COLUMN_LIMITS[column].max));
    }
  }

  return preferences;
}

export function fitGraphColumnVisibility(
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

export function graphMetadataWidth(columns: GraphColumnVisibility): number {
  return (columns.author ? AUTHOR_CELL_WIDTH : 0) + (columns.date ? DATE_CELL_WIDTH : 0) + (columns.sha ? SHA_CELL_WIDTH : 0);
}

export function graphGridTemplate(refs: number, graph: number, columns: GraphColumnVisibility): string {
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
