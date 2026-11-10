/**
 * Geometry for the workflow dependency graph.
 *
 * Cards stay where a plain column stack puts them: packed from the top, in workflow
 * order. Drawing every dependency over that order is a tangle however it is routed, so
 * only a few lines are drawn at a time:
 *   - pinned lines (the flow around a failed job) are always there. They get vertical
 *     tracks of their own and decide how wide each gutter is;
 *   - traced lines (the chain of the job under the pointer) come and go. They fit into
 *     the room that is left, so tracing never moves a card or a pinned line.
 * A dependency that skips columns passes through the gap between two cards, never
 * behind one.
 */

export type WorkflowGraphEdge = { source: string; target: string };

export type WorkflowGraphMetrics = {
  /** Widest a column gets; a column of short names is narrower (see `columnWidths`). */
  columnWidth: number;
  minColumnWidth: number;
  /** Vertical gap between two cards. A line skipping the column runs through it. */
  nodeGap: number;
  /** Horizontal distance between a column edge and the first vertical track. */
  gutterPadding: number;
  /** Horizontal distance between two vertical tracks. */
  trackGap: number;
  /** Vertical tracks every gutter has room for. */
  minTracks: number;
  /** Tracks kept free beside the pinned lines, for a traced chain. */
  spareTracks: number;
  cornerRadius: number;
  /** Used until a card has been measured. */
  estimatedNodeHeight: number;
};

export const WORKFLOW_GRAPH_METRICS: WorkflowGraphMetrics = {
  columnWidth: 216,
  minColumnWidth: 120,
  nodeGap: 6,
  gutterPadding: 7,
  trackGap: 6,
  minTracks: 4,
  spareTracks: 2,
  cornerRadius: 5,
  estimatedNodeHeight: 30
};

export type WorkflowGraphGeometryInput = {
  /** Node keys per dependency column, in the order they are shown. */
  columns: string[][];
  heights: ReadonlyMap<string, number>;
  /** Measured width each column needs to keep its names on one line, where known. */
  columnWidths?: readonly (number | undefined)[];
  /** Dependencies that are always drawn. */
  pinnedEdges: WorkflowGraphEdge[];
  /** Dependencies drawn for now; one that is also pinned keeps its pinned route. */
  tracedEdges?: WorkflowGraphEdge[];
  metrics?: WorkflowGraphMetrics;
};

export type WorkflowGraphRect = { x: number; y: number; width: number; height: number };

export type WorkflowGraphGeometry = {
  width: number;
  height: number;
  nodes: Map<string, WorkflowGraphRect>;
  /** Route of every drawn dependency, by `workflowGraphEdgeKey`. */
  paths: Map<string, string>;
};

export function workflowGraphEdgeKey(edge: WorkflowGraphEdge): string {
  return `${edge.source}>${edge.target}`;
}

type Point = { x: number; y: number };

/** The lanes one group of long dependencies shares, one per column it passes. */
type LaneBundle = { firstColumn: number; lanes: string[] };

type Segment = { left: string; right: string; leftY: number; rightY: number };

type GutterNet = {
  centre: string;
  centreSide: 'left' | 'right';
  centreY: number;
  leaves: { key: string; y: number }[];
  top: number;
  bottom: number;
  track: number;
  pinned: boolean;
};

const ALIGNED = 0.5;
/** Two trunks closer than this would read as one line, so they cannot share a track. */
const TRACK_CLEARANCE = 8;
/** Track order is searched for fewer crossings up to this many trunks in a gutter. */
const TRACK_SEARCH_LIMIT = 16;
/** A bend costs as much as this many pixels of detour. */
const BEND_DETOUR = 500;
/** A step this small reads as a kink, so it costs more than a clean bend. */
const KINK = 12;
/** Two lines in one gap are a last resort. */
const SHARED_LANE = 50;

export function computeWorkflowGraphGeometry({
  columns,
  heights,
  columnWidths,
  pinnedEdges,
  tracedEdges = [],
  metrics = WORKFLOW_GRAPH_METRICS
}: WorkflowGraphGeometryInput): WorkflowGraphGeometry {
  const widthOf = (column: number): number =>
    Math.min(
      metrics.columnWidth,
      Math.max(metrics.minColumnWidth, columnWidths?.[column] ?? metrics.columnWidth)
    );

  // Cards: packed from the top, whatever is drawn between them.
  const columnOf = new Map<string, number>();
  const tops = new Map<string, number>();
  const centres = new Map<string, number>();
  const gaps: number[][] = [];
  const bottoms: number[] = [];
  let height = 0;
  columns.forEach((column, index) => {
    const between: number[] = [];
    let cursor = 0;
    column.forEach((key, at) => {
      if (at > 0) {
        between.push(cursor + metrics.nodeGap / 2);
        cursor += metrics.nodeGap;
      }
      const nodeHeight = heights.get(key) ?? metrics.estimatedNodeHeight;
      columnOf.set(key, index);
      tops.set(key, cursor);
      centres.set(key, cursor + nodeHeight / 2);
      cursor += nodeHeight;
    });
    gaps.push(between);
    bottoms.push(cursor);
    height = Math.max(height, cursor);
  });

  const laneColumn = new Map<string, number>();
  const laneY = new Map<string, number>();
  const takenLanes: number[][] = columns.map(() => []);
  const placedNets: GutterNet[][] = columns.slice(0, -1).map(() => []);
  const trackOf = new Map<string, number>();
  const chainOf = new Map<string, string[]>();
  const yOf = (key: string): number => centres.get(key) ?? laneY.get(key) ?? 0;
  const columnOfAny = (key: string): number => columnOf.get(key) ?? laneColumn.get(key) ?? 0;

  const route = (edges: WorkflowGraphEdge[], pinned: boolean, capacity?: number[]): void => {
    const routable = edges.filter((edge) => {
      const source = columnOf.get(edge.source);
      const target = columnOf.get(edge.target);
      const key = workflowGraphEdgeKey(edge);
      if (source === undefined || target === undefined || source >= target || chainOf.has(key)) {
        return false;
      }
      chainOf.set(key, []);
      return true;
    });
    const { chains, bundles } = bundleLongEdges(
      routable,
      columnOf,
      pinned ? 'lane:pinned' : 'lane:traced',
      laneColumn
    );
    routable.forEach((edge, index) => chainOf.set(workflowGraphEdgeKey(edge), chains[index]));

    const hops: { left: string; right: string }[] = [];
    const seenHops = new Set<string>();
    for (const chain of chains) {
      for (let index = 0; index < chain.length - 1; index += 1) {
        const hopKey = `${chain[index]}>${chain[index + 1]}`;
        if (!seenHops.has(hopKey)) {
          seenHops.add(hopKey);
          hops.push({ left: chain[index], right: chain[index + 1] });
        }
      }
    }

    placeLanes(bundles, hops, centres, gaps, bottoms, takenLanes, metrics.nodeGap, laneY);

    for (let gutter = 0; gutter < columns.length - 1; gutter += 1) {
      const segments = hops
        .filter((hop) => columnOfAny(hop.left) === gutter)
        .map((hop) => ({ ...hop, leftY: yOf(hop.left), rightY: yOf(hop.right) }));
      const nets = orderTracks(buildNets(segments, pinned));
      assignTracks(nets, placedNets[gutter], capacity?.[gutter]);
      for (const net of nets) {
        for (const leaf of net.leaves) {
          trackOf.set(
            net.centreSide === 'left' ? `${net.centre}>${leaf.key}` : `${leaf.key}>${net.centre}`,
            net.track
          );
        }
      }
    }
  };

  route(pinnedEdges, true);
  // Each gutter is as wide as its pinned lines need, plus room to trace a chain.
  const capacity = placedNets.map((nets) =>
    Math.max(
      metrics.minTracks,
      nets.reduce((count, net) => Math.max(count, net.track + 1), 0) + metrics.spareTracks
    )
  );
  route(tracedEdges, false, capacity);

  const columnX: number[] = [];
  const gutterX: number[] = [];
  let cursor = 0;
  for (let column = 0; column < columns.length; column += 1) {
    columnX.push(cursor);
    cursor += widthOf(column);
    if (column < columns.length - 1) {
      gutterX.push(cursor);
      cursor += metrics.gutterPadding * 2 + (capacity[column] - 1) * metrics.trackGap;
    }
  }

  const nodes = new Map<string, WorkflowGraphRect>();
  for (const [key, column] of columnOf) {
    const top = tops.get(key) ?? 0;
    nodes.set(key, {
      x: columnX[column],
      y: top,
      width: widthOf(column),
      height: ((centres.get(key) ?? top) - top) * 2
    });
  }
  for (const y of laneY.values()) {
    height = Math.max(height, y + metrics.nodeGap / 2);
  }

  const paths = new Map<string, string>();
  for (const [edgeKey, chain] of chainOf) {
    const sourceColumn = columnOfAny(chain[0]);
    const points: Point[] = [
      { x: columnX[sourceColumn] + widthOf(sourceColumn), y: yOf(chain[0]) }
    ];
    for (let hop = 0; hop < chain.length - 1; hop += 1) {
      const next = chain[hop + 1];
      const nextColumn = columnOfAny(next);
      const nextY = yOf(next);
      const track = trackOf.get(`${chain[hop]}>${next}`);
      if (track !== undefined) {
        const trackX = gutterX[nextColumn - 1] + metrics.gutterPadding + track * metrics.trackGap;
        points.push({ x: trackX, y: points[points.length - 1].y }, { x: trackX, y: nextY });
      }
      points.push({ x: columnX[nextColumn], y: nextY });
      if (hop + 1 < chain.length - 1) {
        // A lane crosses its column in the gap between two cards.
        points.push({ x: columnX[nextColumn] + widthOf(nextColumn), y: nextY });
      }
    }
    paths.set(edgeKey, roundedPath(points, metrics.cornerRadius));
  }

  return { width: cursor, height, nodes, paths };
}

/**
 * Gives every dependency that skips a column a chain of lane nodes in the columns
 * between. Dependencies sharing a job share its lanes; the jobs are picked greedily
 * so the fewest lanes cover all of them.
 */
function bundleLongEdges(
  edges: WorkflowGraphEdge[],
  columnOf: ReadonlyMap<string, number>,
  prefix: string,
  laneColumn: Map<string, number>
): { chains: string[][]; bundles: LaneBundle[] } {
  const chains = edges.map((edge) => [edge.source, edge.target]);
  const bundles: LaneBundle[] = [];
  const remaining = new Set<number>();
  edges.forEach((edge, index) => {
    if (columnOf.get(edge.target)! - columnOf.get(edge.source)! > 1) {
      remaining.add(index);
    }
  });

  let bundle = 0;
  while (remaining.size > 0) {
    const bySharedNode = new Map<string, number[]>();
    for (const index of remaining) {
      pushTo(bySharedNode, `T ${edges[index].target}`, index);
      pushTo(bySharedNode, `S ${edges[index].source}`, index);
    }
    let best: number[] = [];
    let bestKey = '';
    for (const [key, members] of bySharedNode) {
      if (members.length > best.length) {
        best = members;
        bestKey = key;
      }
    }

    const sharesTarget = bestKey.startsWith('T ');
    const centreColumn = columnOf.get(bestKey.slice(2))!;
    const first = sharesTarget
      ? Math.min(...best.map((index) => columnOf.get(edges[index].source)!)) + 1
      : centreColumn + 1;
    const last = sharesTarget
      ? centreColumn - 1
      : Math.max(...best.map((index) => columnOf.get(edges[index].target)!)) - 1;

    const laneAt = new Map<number, string>();
    for (let column = first; column <= last; column += 1) {
      const key = `${prefix}:${bundle}:${column}`;
      laneAt.set(column, key);
      laneColumn.set(key, column);
    }
    bundles.push({ firstColumn: first, lanes: [...laneAt.values()] });
    for (const index of best) {
      const edge = edges[index];
      const chain = [edge.source];
      for (
        let column = columnOf.get(edge.source)! + 1;
        column < columnOf.get(edge.target)!;
        column += 1
      ) {
        chain.push(laneAt.get(column)!);
      }
      chain.push(edge.target);
      chains[index] = chain;
      remaining.delete(index);
    }
    bundle += 1;
  }

  return { chains, bundles };
}

/**
 * Picks the row each lane takes through its column: the gap between two cards, or any
 * row below the last card. A bundle's rows are chosen together for the fewest bends
 * from its first job to its last, then the least detour. Rows used by earlier lanes
 * stay theirs.
 */
function placeLanes(
  bundles: LaneBundle[],
  hops: { left: string; right: string }[],
  centres: ReadonlyMap<string, number>,
  gaps: number[][],
  bottoms: number[],
  taken: number[][],
  nodeGap: number,
  laneY: Map<string, number>
): void {
  const anchor = (keys: string[]): number | undefined => {
    const ys = keys
      .map((key) => centres.get(key))
      .filter((y): y is number => y !== undefined)
      .sort((a, b) => a - b);
    return ys.length === 0 ? undefined : ys[Math.floor((ys.length - 1) / 2)];
  };
  const step = (from: number | undefined, to: number | undefined): number => {
    if (from === undefined || to === undefined) {
      return 0;
    }
    const distance = Math.abs(from - to);
    return distance < ALIGNED ? 0 : (distance < KINK ? 1.5 : 1) + distance / BEND_DETOUR;
  };

  for (const bundle of bundles) {
    const { lanes } = bundle;
    const start = anchor(hops.filter((hop) => hop.right === lanes[0]).map((hop) => hop.left));
    const end = anchor(
      hops.filter((hop) => hop.left === lanes[lanes.length - 1]).map((hop) => hop.right)
    );

    // Below a column any row is free, so a line can pass level with a job or with the
    // gap it took in another column.
    const rows = new Set<number>();
    for (const y of [start, end]) {
      if (y !== undefined) {
        rows.add(y);
      }
    }
    lanes.forEach((_, index) => {
      const column = bundle.firstColumn + index;
      gaps[column].forEach((y) => rows.add(y));
      rows.add(bottoms[column] + nodeGap / 2);
    });
    const sortedRows = [...rows].sort((a, b) => a - b);
    const candidates = lanes.map((_, index) => {
      const column = bundle.firstColumn + index;
      const penalty = (y: number): number =>
        taken[column].some((other) => Math.abs(other - y) < nodeGap - ALIGNED) ? SHARED_LANE : 0;
      return [
        ...gaps[column],
        ...sortedRows.filter((y) => y >= bottoms[column] + nodeGap / 2 - ALIGNED)
      ].map((y) => ({ y, penalty: penalty(y) }));
    });

    let costs = candidates[0].map((candidate) => candidate.penalty + step(start, candidate.y));
    const cameFrom: number[][] = [];
    for (let index = 1; index < candidates.length; index += 1) {
      const from: number[] = [];
      const next = candidates[index].map((candidate) => {
        let best = Number.POSITIVE_INFINITY;
        let bestAt = 0;
        candidates[index - 1].forEach((previous, at) => {
          const cost = costs[at] + step(previous.y, candidate.y);
          if (cost < best) {
            best = cost;
            bestAt = at;
          }
        });
        from.push(bestAt);
        return best + candidate.penalty;
      });
      cameFrom.push(from);
      costs = next;
    }

    let at = 0;
    let best = Number.POSITIVE_INFINITY;
    candidates[candidates.length - 1].forEach((candidate, index) => {
      const cost = costs[index] + step(candidate.y, end);
      if (cost < best) {
        best = cost;
        at = index;
      }
    });
    for (let index = lanes.length - 1; index >= 0; index -= 1) {
      const { y } = candidates[index][at];
      laneY.set(lanes[index], y);
      taken[bundle.firstColumn + index].push(y);
      if (index > 0) {
        at = cameFrom[index - 1][at];
      }
    }
  }
}

/** Groups the bent lines between two columns into nets that share a job. */
function buildNets(segments: Segment[], pinned: boolean): GutterNet[] {
  const remaining = segments.filter(
    (segment) => Math.abs(segment.leftY - segment.rightY) >= ALIGNED
  );
  const nets: GutterNet[] = [];

  while (remaining.length > 0) {
    const byPort = new Map<string, Segment[]>();
    for (const segment of remaining) {
      pushTo(byPort, `L ${segment.left}`, segment);
      pushTo(byPort, `R ${segment.right}`, segment);
    }
    let best: Segment[] = [];
    let bestKey = '';
    for (const [key, members] of byPort) {
      if (members.length > best.length) {
        best = members;
        bestKey = key;
      }
    }
    const centreSide = bestKey.startsWith('L ') ? 'left' : 'right';
    const centreY = centreSide === 'left' ? best[0].leftY : best[0].rightY;
    const leaves = best.map((segment) =>
      centreSide === 'left'
        ? { key: segment.right, y: segment.rightY }
        : { key: segment.left, y: segment.leftY }
    );
    const ys = [centreY, ...leaves.map((leaf) => leaf.y)];
    nets.push({
      centre: bestKey.slice(2),
      centreSide,
      centreY,
      leaves,
      top: Math.min(...ys),
      bottom: Math.max(...ys),
      track: 0,
      pinned
    });
    for (const segment of best) {
      remaining.splice(remaining.indexOf(segment), 1);
    }
  }

  return nets;
}

function overlaps(a: GutterNet, b: GutterNet): boolean {
  return a.top - TRACK_CLEARANCE < b.bottom && b.top - TRACK_CLEARANCE < a.bottom;
}

/**
 * Gives each net a vertical track, left to right in the searched order, clear of the
 * nets already in the gutter. With a `capacity` the gutter cannot grow: a net that
 * finds no free track shares one, with its own batch before a line placed earlier.
 */
function assignTracks(order: GutterNet[], placed: GutterNet[], capacity: number | undefined): void {
  const mine: GutterNet[] = [];
  for (const net of order) {
    let track = 0;
    for (const other of mine) {
      if (overlaps(net, other)) {
        track = Math.max(track, other.track + 1);
      }
    }
    const blocked = (candidate: number): boolean =>
      placed.some((other) => other.track === candidate && overlaps(net, other));
    while (blocked(track)) {
      track += 1;
    }
    if (capacity !== undefined && track >= capacity) {
      let bestCost = Number.POSITIVE_INFINITY;
      for (let candidate = 0; candidate < capacity; candidate += 1) {
        let cost = 0;
        for (const other of [...placed, ...mine]) {
          if (other.track === candidate && overlaps(net, other)) {
            cost += placed.includes(other) ? 100 : 1;
          }
        }
        if (cost < bestCost) {
          bestCost = cost;
          track = candidate;
        }
      }
    }
    net.track = track;
    mine.push(net);
  }
  placed.push(...mine);
}

type Stub = { key: string; y: number };

function leftStubs(net: GutterNet): Stub[] {
  return net.centreSide === 'left' ? [{ key: net.centre, y: net.centreY }] : net.leaves;
}

function rightStubs(net: GutterNet): Stub[] {
  return net.centreSide === 'right' ? [{ key: net.centre, y: net.centreY }] : net.leaves;
}

/** Cost of drawing `inner` on a track left of `outer`. */
function trackPairCost(inner: GutterNet, outer: GutterNet): number {
  let cost = 0;
  // Lines leaving the inner trunk for the right column pass the outer trunk.
  for (const stub of rightStubs(inner)) {
    if (stub.y > outer.top + ALIGNED && stub.y < outer.bottom - ALIGNED) {
      cost += rightStubs(outer).some((other) => other.key === stub.key) ? 0 : 1;
    }
    // A line arriving from the left on the same row would look like one straight link.
    for (const other of leftStubs(outer)) {
      if (Math.abs(other.y - stub.y) < 3) {
        cost += 40;
      }
    }
  }
  // Lines reaching the outer trunk from the left column pass the inner trunk.
  for (const stub of leftStubs(outer)) {
    if (stub.y > inner.top + ALIGNED && stub.y < inner.bottom - ALIGNED) {
      cost += leftStubs(inner).some((other) => other.key === stub.key) ? 0 : 1;
    }
  }
  return cost;
}

/** Orders nets left to right so the fewest lines cross a trunk. */
function orderTracks(nets: GutterNet[]): GutterNet[] {
  const cost = (order: GutterNet[]): number => {
    let total = 0;
    for (let inner = 0; inner < order.length; inner += 1) {
      for (let outer = inner + 1; outer < order.length; outer += 1) {
        total += trackPairCost(order[inner], order[outer]);
      }
    }
    return total;
  };

  // Top-down start keeps the result stable; then move single nets while it helps.
  let order = [...nets].sort((a, b) => a.top - b.top || a.bottom - b.bottom);
  if (order.length > TRACK_SEARCH_LIMIT) {
    return order;
  }
  let best = cost(order);
  for (let round = 0; round < 8 && best > 0; round += 1) {
    let improved = false;
    for (let from = 0; from < order.length; from += 1) {
      for (let to = 0; to < order.length; to += 1) {
        if (to === from) {
          continue;
        }
        const candidate = [...order];
        const [moved] = candidate.splice(from, 1);
        candidate.splice(to, 0, moved);
        const candidateCost = cost(candidate);
        if (candidateCost < best) {
          best = candidateCost;
          order = candidate;
          improved = true;
        }
      }
    }
    if (!improved) {
      break;
    }
  }
  return order;
}

/** An orthogonal polyline with rounded bends. */
export function roundedPath(points: Point[], radius: number): string {
  const corners: Point[] = [];
  for (const point of points) {
    const previous = corners[corners.length - 1];
    if (previous && previous.x === point.x && previous.y === point.y) {
      continue;
    }
    const beforePrevious = corners[corners.length - 2];
    if (
      beforePrevious &&
      ((beforePrevious.x === previous.x && previous.x === point.x) ||
        (beforePrevious.y === previous.y && previous.y === point.y))
    ) {
      corners.pop();
    }
    corners.push(point);
  }
  if (corners.length === 0) {
    return '';
  }

  const parts = [`M ${format(corners[0].x)} ${format(corners[0].y)}`];
  for (let index = 1; index < corners.length; index += 1) {
    const point = corners[index];
    const previous = corners[index - 1];
    const next = corners[index + 1];
    if (!next) {
      parts.push(`L ${format(point.x)} ${format(point.y)}`);
      continue;
    }
    const before = Math.hypot(point.x - previous.x, point.y - previous.y);
    const after = Math.hypot(next.x - point.x, next.y - point.y);
    const bend = Math.min(radius, before / 2, after / 2);
    const entry = {
      x: point.x - ((point.x - previous.x) / before) * bend,
      y: point.y - ((point.y - previous.y) / before) * bend
    };
    const exit = {
      x: point.x + ((next.x - point.x) / after) * bend,
      y: point.y + ((next.y - point.y) / after) * bend
    };
    parts.push(
      `L ${format(entry.x)} ${format(entry.y)}`,
      `Q ${format(point.x)} ${format(point.y)} ${format(exit.x)} ${format(exit.y)}`
    );
  }
  return parts.join(' ');
}

function format(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function pushTo<Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value): void {
  const list = map.get(key);
  if (list) {
    list.push(value);
  } else {
    map.set(key, [value]);
  }
}
