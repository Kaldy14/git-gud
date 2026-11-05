import { describe, expect, it } from 'vitest';

import type { CommitGraphRow } from '@shared/types';

import {
  fitGraphColumnWidths,
  graphLanesWidth,
  GRAPH_COLUMN_LIMITS,
  LANE_GAP,
  parseGraphColumnPreferences,
  resetGraphColumnPreference,
  resizeGraphColumnPreference
} from './graphColumnLayout';

const fit = (lanesWidth: number, containerWidth?: number, metadataWidth = 0) => ({ lanesWidth, containerWidth, metadataWidth });

describe('graph column fitting', () => {
  it('sizes an unset graph column to its lanes, within the automatic range', () => {
    const linear = graphLanesWidth([row({ lane: 0 })]);
    const threeLanes = graphLanesWidth([row({ lane: 2 })]);
    const manyLanes = graphLanesWidth([row({ lane: 30 })]);

    expect(fitGraphColumnWidths({}, fit(linear, 1200)).graph).toBe(72);
    expect(fitGraphColumnWidths({}, fit(threeLanes, 1200)).graph).toBe(threeLanes);
    expect(fitGraphColumnWidths({}, fit(manyLanes, 1200)).graph).toBe(240);
    expect(manyLanes).toBeGreaterThan(240);
  });

  it('spends surplus width on ref names while retaining a readable subject column', () => {
    const wide = fitGraphColumnWidths({}, fit(86, 836));
    const compact = fitGraphColumnWidths({}, fit(86, 594));
    expect(wide.refs).toBe(220);
    expect(836 - wide.refs - wide.graph).toBeGreaterThanOrEqual(480);
    expect(compact.refs).toBe(133);
  });

  it('counts rails that run wider than the node lanes', () => {
    const merge = row({ lane: 0, rails: [{ type: 'curveOut', from: 0, to: 3 }] });

    expect(graphLanesWidth([merge]) - graphLanesWidth([row({ lane: 0 })])).toBe(3 * LANE_GAP);
  });

  it('restores a preferred width after the window narrows and widens', () => {
    const preferences = { refs: 200, graph: 300 };
    const narrow = fitGraphColumnWidths(preferences, fit(42, 600));

    expect(narrow.refs).toBeLessThan(200);
    expect(narrow.graph).toBeLessThan(300);
    expect(preferences).toEqual({ refs: 200, graph: 300 });
    expect(fitGraphColumnWidths(preferences, fit(42, 1400))).toEqual({ refs: 200, graph: 300 });
  });

  it('gives up branch width before graph width, then keeps both usable', () => {
    const preferences = { refs: 200, graph: 120 };

    expect(fitGraphColumnWidths(preferences, fit(42, 540))).toEqual({ refs: 160, graph: 120 });
    expect(fitGraphColumnWidths(preferences, fit(42, 300))).toEqual({
      refs: GRAPH_COLUMN_LIMITS.refs.min,
      graph: GRAPH_COLUMN_LIMITS.graph.min
    });
  });

  it('accounts for visible metadata columns', () => {
    const withoutMetadata = fitGraphColumnWidths({ graph: 200 }, fit(42, 600));
    const withMetadata = fitGraphColumnWidths({ graph: 200 }, fit(42, 600, 132));

    expect(withMetadata.refs + withMetadata.graph).toBeLessThan(withoutMetadata.refs + withoutMetadata.graph);
  });

  it('uses preferences as they are until the container has been measured', () => {
    expect(fitGraphColumnWidths({ refs: 300, graph: 400 }, fit(42))).toEqual({ refs: 300, graph: 400 });
  });
});

describe('graph column preferences', () => {
  const layout = { containerWidth: 1000, metadataWidth: 0 };

  it('stores a resize against the current room and leaves the other column automatic', () => {
    expect(resizeGraphColumnPreference({}, 'graph', 180, 133, layout)).toEqual({ graph: 180 });
    expect(resizeGraphColumnPreference({}, 'graph', 900, 133, layout)).toEqual({ graph: 520 });
    expect(resizeGraphColumnPreference({}, 'graph', 900, 133, { containerWidth: 600, metadataWidth: 0 })).toEqual({ graph: 207 });
    expect(resizeGraphColumnPreference({}, 'refs', 10, 72, layout)).toEqual({ refs: GRAPH_COLUMN_LIMITS.refs.min });
  });

  it('keeps the same object when a resize changes nothing', () => {
    const preferences = { graph: 180 };

    expect(resizeGraphColumnPreference(preferences, 'graph', 180, 133, layout)).toBe(preferences);
  });

  it('returns a reset column to its automatic width', () => {
    expect(resetGraphColumnPreference({ refs: 200, graph: 300 }, 'graph')).toEqual({ refs: 200 });
  });

  it('ignores malformed stored values and clamps out-of-range ones', () => {
    expect(parseGraphColumnPreferences(null)).toEqual({});
    expect(parseGraphColumnPreferences({ refs: 'wide', graph: Number.NaN })).toEqual({});
    expect(parseGraphColumnPreferences({ refs: 9000, graph: 1 })).toEqual({ refs: 360, graph: 64 });
  });
});

function row({ lane, rails = [] }: { lane: number; rails?: CommitGraphRow['rails'] }): CommitGraphRow {
  return {
    sha: `sha-${lane}`,
    parentShas: [],
    subject: 'Subject',
    author: { name: 'Author', initials: 'A', color: '#123456' },
    dateLabel: 'Today',
    node: { lane, kind: 'commit' },
    rails,
    files: []
  };
}
