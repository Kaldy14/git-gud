import { describe, expect, it } from 'vitest';

import {
  WORKFLOW_GRAPH_METRICS,
  computeWorkflowGraphGeometry,
  roundedPath,
  type WorkflowGraphGeometry,
  type WorkflowGraphRect
} from './workflowRunGraphLayout';

const { columnWidth, nodeGap, estimatedNodeHeight, gutterPadding, trackGap, minTracks } =
  WORKFLOW_GRAPH_METRICS;
const gutter = gutterPadding * 2 + (minTracks - 1) * trackGap;

type Link = [string, string];

function layout(
  columns: string[][],
  pinned: Link[],
  options: { heights?: Record<string, number>; columnWidths?: number[]; traced?: Link[] } = {}
): WorkflowGraphGeometry {
  const edges = (links: Link[]): { source: string; target: string }[] =>
    links.map(([source, target]) => ({ source, target }));
  return computeWorkflowGraphGeometry({
    columns,
    pinnedEdges: edges(pinned),
    tracedEdges: edges(options.traced ?? []),
    heights: new Map(Object.entries(options.heights ?? {})),
    columnWidths: options.columnWidths
  });
}

function rect(geometry: WorkflowGraphGeometry, key: string): WorkflowGraphRect {
  const found = geometry.nodes.get(key);
  if (!found) {
    throw new Error(`No node ${key}`);
  }
  return found;
}

function pathOf(geometry: WorkflowGraphGeometry, source: string, target: string): string {
  const path = geometry.paths.get(`${source}>${target}`);
  if (path === undefined) {
    throw new Error(`No edge ${source} -> ${target}`);
  }
  return path;
}

/** Corner and end points of a path, enough to follow an orthogonal line. */
function pointsOf(path: string): { x: number; y: number }[] {
  const numbers = path.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  const points: { x: number; y: number }[] = [];
  for (let index = 0; index < numbers.length; index += 2) {
    points.push({ x: numbers[index], y: numbers[index + 1] });
  }
  return points;
}

/** The x of a line's vertical run: a bend's control point sits on it twice. */
function trackOf(geometry: WorkflowGraphGeometry, source: string, target: string): number {
  const track = pointsOf(pathOf(geometry, source, target))
    .map((point) => point.x)
    .find((x, index, xs) => xs.indexOf(x) !== index);
  if (track === undefined) {
    throw new Error(`${source} -> ${target} has no vertical run`);
  }
  return track;
}

/** The row a line takes through the column of `card`. */
function laneThrough(geometry: WorkflowGraphGeometry, path: string, card: string): number {
  const { x, width } = rect(geometry, card);
  const points = pointsOf(path);
  const run = points.find(
    (point, index) =>
      index > 0 &&
      points[index - 1].y === point.y &&
      Math.min(points[index - 1].x, point.x) <= x &&
      Math.max(points[index - 1].x, point.x) >= x + width
  );
  if (!run) {
    throw new Error(`The line does not cross the column of ${card}`);
  }
  return run.y;
}

describe('computeWorkflowGraphGeometry', () => {
  it('packs every column from the top in the given order, whatever is drawn', () => {
    const columns = [['root'], ['a', 'b', 'c'], ['x', 'y']];
    const heights = { b: 46 };
    const bare = layout(columns, [], { heights });
    const drawn = layout(
      columns,
      [
        ['root', 'c'],
        ['c', 'x']
      ],
      { heights, traced: [['a', 'y']] }
    );

    expect(rect(bare, 'a').y).toBe(0);
    expect(rect(bare, 'b').y).toBe(estimatedNodeHeight + nodeGap);
    expect(rect(bare, 'c').y).toBe(estimatedNodeHeight + nodeGap + 46 + nodeGap);
    expect(rect(bare, 'y').y).toBe(estimatedNodeHeight + nodeGap);
    expect(bare.height).toBe(estimatedNodeHeight * 2 + 46 + nodeGap * 2);
    expect(drawn.nodes).toEqual(bare.nodes);
  });

  it('draws a link between level cards as one straight line', () => {
    const geometry = layout([['a'], ['b']], [['a', 'b']]);

    expect(rect(geometry, 'b').x).toBe(columnWidth + gutter);
    expect(pathOf(geometry, 'a', 'b')).toBe(
      `M ${columnWidth} ${estimatedNodeHeight / 2} L ${columnWidth + gutter} ${estimatedNodeHeight / 2}`
    );
  });

  it('never moves a card, a pinned line or the graph edge when a chain is traced', () => {
    const columns = [['one', 'two', 'three'], ['a', 'b', 'c'], ['end']];
    const pinned: Link[] = [
      ['one', 'b'],
      ['b', 'end']
    ];
    const rest = layout(columns, pinned);
    const tracing = layout(columns, pinned, {
      traced: [
        ['two', 'a'],
        ['three', 'a'],
        ['one', 'c'],
        ['a', 'end']
      ]
    });

    expect(tracing.nodes).toEqual(rest.nodes);
    expect(tracing.width).toBe(rest.width);
    expect(tracing.height).toBe(rest.height);
    for (const [source, target] of pinned) {
      expect(pathOf(tracing, source, target)).toBe(pathOf(rest, source, target));
    }
    expect(tracing.paths.size).toBe(6);
  });

  it('routes a dependency that skips a column between its cards, never behind them', () => {
    const geometry = layout(
      [['build-a', 'build-b', 'build-c'], ['deploy-a', 'deploy-c'], ['verify-b']],
      [['build-b', 'verify-b']]
    );

    const points = pointsOf(pathOf(geometry, 'build-b', 'verify-b'));
    const blockers = ['deploy-a', 'deploy-c'].map((key) => rect(geometry, key));
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      for (const blocker of blockers) {
        const crossesColumn =
          Math.max(from.x, to.x) > blocker.x && Math.min(from.x, to.x) < blocker.x + blocker.width;
        const crossesRows =
          Math.max(from.y, to.y) > blocker.y && Math.min(from.y, to.y) < blocker.y + blocker.height;
        expect(crossesColumn && crossesRows).toBe(false);
      }
    }
    // It passes through the gap between the two cards and ends level with its job.
    expect(laneThrough(geometry, pathOf(geometry, 'build-b', 'verify-b'), 'deploy-a')).toBe(
      estimatedNodeHeight + nodeGap / 2
    );
    expect(points[points.length - 1].y).toBe(estimatedNodeHeight / 2);
  });

  it('gives two lines that skip the same column a gap each', () => {
    const columns = [['a', 'b'], ['m1', 'm2', 'm3'], ['x', 'y']];
    const together = layout(columns, [
      ['a', 'x'],
      ['b', 'y']
    ]);
    const traced = layout(columns, [['a', 'x']], { traced: [['b', 'y']] });

    for (const geometry of [together, traced]) {
      const first = laneThrough(geometry, pathOf(geometry, 'a', 'x'), 'm1');
      const second = laneThrough(geometry, pathOf(geometry, 'b', 'y'), 'm1');
      expect(first).toBe(estimatedNodeHeight + nodeGap / 2);
      expect(second).toBe(estimatedNodeHeight * 2 + nodeGap * 1.5);
    }
  });

  it('merges the lines leaving one job onto a single vertical track', () => {
    const geometry = layout(
      [['root'], ['a', 'b', 'c']],
      [
        ['root', 'a'],
        ['root', 'b'],
        ['root', 'c']
      ]
    );

    // The root is level with the first job, so only the other two lines bend.
    expect(pointsOf(pathOf(geometry, 'root', 'a'))).toHaveLength(2);
    expect(trackOf(geometry, 'root', 'b')).toBe(trackOf(geometry, 'root', 'c'));
  });

  it('gives lines that share no job their own tracks', () => {
    const geometry = layout(
      [['one', 'two'], ['a', 'b']],
      [
        ['one', 'b'],
        ['two', 'a']
      ]
    );

    expect(trackOf(geometry, 'one', 'b')).not.toBe(trackOf(geometry, 'two', 'a'));
  });

  it('widens a gutter for pinned lines only', () => {
    const columns = [['s1', 's2', 's3'], ['t1', 't2', 't3']];
    const crossing: Link[] = [
      ['s1', 't2'],
      ['s2', 't3'],
      ['s3', 't1']
    ];

    // Three pinned tracks plus the spare ones for tracing.
    expect(rect(layout(columns, crossing), 't1').x - columnWidth).toBe(
      gutterPadding * 2 + (3 + WORKFLOW_GRAPH_METRICS.spareTracks - 1) * trackGap
    );
    expect(rect(layout(columns, [], { traced: crossing }), 't1').x - columnWidth).toBe(gutter);
  });

  it('keeps a traced line off the track of a pinned line beside it', () => {
    const geometry = layout([['one', 'two'], ['a', 'b']], [['one', 'b']], {
      traced: [['two', 'a']]
    });

    expect(trackOf(geometry, 'two', 'a')).not.toBe(trackOf(geometry, 'one', 'b'));
  });

  it('shares tracks when a traced chain needs more than the gutter holds', () => {
    const sources = ['s1', 's2', 's3', 's4', 's5', 's6'];
    const targets = ['t1', 't2', 't3', 't4', 't5', 't6'];
    const traced = sources.map<Link>((source, index) => [source, targets[5 - index]]);
    const geometry = layout([sources, targets], [], { traced });

    expect(geometry.width).toBe(columnWidth * 2 + gutter);
    expect(geometry.paths.size).toBe(6);
    for (const [source, target] of traced) {
      const track = trackOf(geometry, source, target);
      expect(track).toBeGreaterThan(columnWidth);
      expect(track).toBeLessThan(columnWidth + gutter);
    }
  });

  it('narrows a column to its measured names within the allowed range', () => {
    const geometry = layout([['a'], ['b'], ['c']], [['a', 'b']], {
      columnWidths: [150, 20, 900]
    });

    expect(rect(geometry, 'a').width).toBe(150);
    expect(rect(geometry, 'b').width).toBe(WORKFLOW_GRAPH_METRICS.minColumnWidth);
    expect(rect(geometry, 'c').width).toBe(columnWidth);
  });

  it('skips dependencies it cannot place and still lays out the rest', () => {
    const geometry = layout([['a'], ['b']], [
      ['a', 'b'],
      ['b', 'a'],
      ['a', 'missing']
    ]);

    expect([...geometry.paths.keys()]).toEqual(['a>b']);
  });

  it('is stable: the same graph always gets the same geometry', () => {
    const columns = [['root'], ['a', 'b', 'c'], ['x', 'y'], ['end']];
    const pinned: Link[] = [
      ['root', 'c'],
      ['c', 'y'],
      ['y', 'end'],
      ['b', 'end']
    ];
    const traced: Link[] = [
      ['root', 'a'],
      ['a', 'x'],
      ['x', 'end']
    ];

    expect(layout(columns, pinned, { traced })).toEqual(layout(columns, pinned, { traced }));
  });
});

describe('roundedPath', () => {
  it('rounds bends and drops points that do not change direction', () => {
    expect(
      roundedPath(
        [
          { x: 0, y: 10 },
          { x: 20, y: 10 },
          { x: 40, y: 10 },
          { x: 40, y: 50 },
          { x: 80, y: 50 }
        ],
        5
      )
    ).toBe('M 0 10 L 35 10 Q 40 10 40 15 L 40 45 Q 40 50 45 50 L 80 50');
  });

  it('shrinks a bend that has no room for the full radius', () => {
    expect(
      roundedPath(
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 4 },
          { x: 30, y: 4 }
        ],
        5
      )
    ).toBe('M 0 0 L 8 0 Q 10 0 10 2 L 10 2 Q 10 4 12 4 L 30 4');
  });
});
