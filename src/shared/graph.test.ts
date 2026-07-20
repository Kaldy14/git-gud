import { describe, expect, it } from 'vitest';

import { buildCommitGraphRows, laneBandColor, laneColor, laneRefColor } from './graph';
import type { GraphCommitInput } from './graph';
import type { CommitGraphRow, GraphRailSegment } from './types';

const AUTHOR = {
  authorName: 'Graph Tester',
  authorEmail: 'graph@example.test',
  authoredAt: '2026-07-03T10:00:00.000Z',
  committedAt: '2026-07-03T10:00:00.000Z'
};

describe('buildCommitGraphRows', () => {
  it('keeps linear history on one lane', () => {
    const rows = buildCommitGraphRows([commit('c3', ['c2']), commit('c2', ['c1']), commit('c1')]);

    expect(rows.map((row) => row.node.lane)).toEqual([0, 0, 0]);
    expect(rows[0]?.rails).toContainEqual({ type: 'startBottom', lane: 0 });
    expect(rows[1]?.rails).toEqual(
      expect.arrayContaining([
        { type: 'stopTop', lane: 0 },
        { type: 'startBottom', lane: 0 }
      ])
    );
    expect(rows[2]?.rails).toContainEqual({ type: 'stopTop', lane: 0 });
  });

  it('allocates a branch tip and collapses it at the shared parent', () => {
    const rows = buildCommitGraphRows([commit('main-tip', ['base']), commit('feature-tip', ['base']), commit('base')]);

    expect(rows.map((row) => row.node.lane)).toEqual([0, 1, 0]);
    expect(rows[2]?.rails).toEqual(
      expect.arrayContaining([
        { type: 'stopTop', lane: 0 },
        { type: 'curveIn', from: 1, to: 0 }
      ])
    );
  });

  it('groups and labels rows by committer date', () => {
    const rows = buildCommitGraphRows([
      commit('c2', ['c1'], {
        authoredAt: '2026-07-10T10:00:00.000Z',
        committedAt: '2026-07-14T10:00:00.000Z'
      }),
      commit('c1', [], {
        authoredAt: '2026-07-09T10:00:00.000Z',
        committedAt: '2026-07-14T09:00:00.000Z'
      })
    ]);

    expect(rows[0]?.dateMarker).toBe('Jul 14, 2026');
    expect(rows[0]?.dateLabel).toContain('Jul 14, 2026');
    expect(rows[1]?.dateMarker).toBeUndefined();
  });

  it('creates an outgoing lane for merge parents', () => {
    const rows = buildCommitGraphRows([
      commit('merge', ['left', 'right']),
      commit('left', ['base']),
      commit('right', ['base']),
      commit('base')
    ]);

    expect(rows[0]?.node).toEqual({ lane: 0, kind: 'merge' });
    expect(rows[0]?.rails).toContainEqual({ type: 'curveOut', from: 0, to: 1 });
    expect(rows[2]?.node.lane).toBe(1);
    expect(rows[3]?.rails).toContainEqual({ type: 'curveIn', from: 1, to: 0 });
  });

  it('fans out and collapses octopus merge parents', () => {
    const rows = buildCommitGraphRows([
      commit('octopus', ['main-parent', 'feature-parent', 'release-parent']),
      commit('main-parent', ['base']),
      commit('feature-parent', ['base']),
      commit('release-parent', ['base']),
      commit('base')
    ]);

    expectValidGraphRows(rows);
    expect(rows[0]?.node).toEqual({ lane: 0, kind: 'merge' });
    expect(rows[0]?.rails).toEqual(
      expect.arrayContaining([
        { type: 'curveOut', from: 0, to: 1 },
        { type: 'curveOut', from: 0, to: 2 }
      ])
    );
    expect(rows[4]?.rails).toEqual(
      expect.arrayContaining([
        { type: 'curveIn', from: 1, to: 0 },
        { type: 'curveIn', from: 2, to: 0 }
      ])
    );
  });

  it('keeps criss-cross merges structurally valid until shared parents collapse', () => {
    const rows = buildCommitGraphRows([
      commit('merge-b', ['b2', 'a1']),
      commit('merge-a', ['a2', 'b1']),
      commit('b2', ['b1']),
      commit('a2', ['a1']),
      commit('b1', ['base']),
      commit('a1', ['base']),
      commit('base')
    ]);

    expectValidGraphRows(rows);
    expect(rows.map((row) => row.sha)).toEqual(['merge-b', 'merge-a', 'b2', 'a2', 'b1', 'a1', 'base']);
    expect(rows[4]?.rails).toContainEqual({ type: 'curveIn', from: 3, to: 0 });
    expect(rows[5]?.rails).toContainEqual({ type: 'curveIn', from: 2, to: 1 });
    expect(rows[6]?.rails).toContainEqual({ type: 'curveIn', from: 1, to: 0 });
  });

  it('preserves remote-only refs and tags on graph rows', () => {
    const rows = buildCommitGraphRows([
      commit('remote-tip', [], {
        refs: [
          { label: 'origin/feature', kind: 'remote' },
          { label: 'v1.0.0', kind: 'tag' }
        ]
      })
    ]);

    expect(rows[0]?.refs).toEqual([
      { label: 'origin/feature', kind: 'remote' },
      { label: 'v1.0.0', kind: 'tag' }
    ]);
  });

  it('renders synthetic WIP and stash tips against their base commits', () => {
    const rows = buildCommitGraphRows([
      commit('wip', ['head'], { kind: 'wip', refs: [{ label: 'WIP', kind: 'wip' }] }),
      commit('stash', ['base'], { kind: 'stash', refs: [{ label: 'stash@{0}', kind: 'stash' }] }),
      commit('head', ['base']),
      commit('base')
    ]);

    expect(rows[0]?.node.kind).toBe('wip');
    expect(rows[0]?.refs?.[0]).toEqual({ label: 'WIP', kind: 'wip' });
    expect(rows[1]?.node.kind).toBe('stash');
    expect(rows[1]?.node.lane).toBe(1);
    expect(rows[3]?.rails).toContainEqual(expect.objectContaining({ type: 'curveIn', from: 1, to: 0, dashed: true }));
  });

  it('keeps synthetic tip rails dashed and colored down to their base commit', () => {
    const rows = buildCommitGraphRows([
      commit('wip', ['c1'], { kind: 'wip', colorOverride: '#8b95a5' }),
      commit('c2', ['c1']),
      commit('c1')
    ]);

    expect(rows[0]?.rails).toContainEqual({ type: 'startBottom', lane: 0, color: '#8b95a5', dashed: true });
    expect(rows[1]?.rails).toContainEqual({ type: 'through', lane: 0, color: '#8b95a5', dashed: true });
    expect(rows[2]?.rails).toContainEqual({ type: 'stopTop', lane: 0, color: '#8b95a5', dashed: true });
    expect(rows[2]?.rails).toContainEqual({ type: 'curveIn', from: 1, to: 0 });
  });

  it('collapses multiple stash tips that share the same base commit', () => {
    const rows = buildCommitGraphRows([
      commit('stash-0', ['base'], { kind: 'stash', refs: [{ label: 'stash@{0}', kind: 'stash' }] }),
      commit('stash-1', ['base'], { kind: 'stash', refs: [{ label: 'stash@{1}', kind: 'stash' }] }),
      commit('head', ['base']),
      commit('base')
    ]);

    expectValidGraphRows(rows);
    expect(rows.map((row) => row.node.kind)).toEqual(['stash', 'stash', 'commit', 'commit']);
    expect(rows[3]?.rails).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'curveIn', from: 1, to: 0, dashed: true }),
        { type: 'curveIn', from: 2, to: 0 }
      ])
    );
  });
});

describe('measured graph palette', () => {
  it('uses the reference rail, band, and ref colors in lane order', () => {
    expect(Array.from({ length: 7 }, (_, lane) => laneColor(lane))).toEqual([
      '#4a9ebc',
      '#2d68ee',
      '#8218bb',
      '#b52eb1',
      '#c72a70',
      '#bc271b',
      '#eccc54'
    ]);
    expect(Array.from({ length: 7 }, (_, lane) => laneBandColor(lane))).toEqual([
      '#212b33',
      '#1e2638',
      '#261d33',
      '#2c2031',
      '#2d1f2b',
      '#2c1f22',
      '#313028'
    ]);
    expect(Array.from({ length: 7 }, (_, lane) => laneRefColor(lane))).toEqual([
      '#243e49',
      '#1d3155',
      '#351949',
      '#411e46',
      '#451a36',
      '#421a1c',
      '#514a2c'
    ]);
    expect(laneRefColor(0, true)).toBe('#2f5e6f');
    expect(laneColor(7)).toBe('#4a9ebc');
  });
});

function commit(
  sha: string,
  parentShas: string[] = [],
  overrides: Partial<GraphCommitInput> = {}
): GraphCommitInput {
  return {
    ...AUTHOR,
    sha,
    parentShas,
    subject: sha,
    ...overrides
  };
}

function expectValidGraphRows(rows: CommitGraphRow[]): void {
  expect(new Set(rows.map((row) => row.sha)).size).toBe(rows.length);

  for (const row of rows) {
    expect(row.node.lane).toBeGreaterThanOrEqual(0);

    for (const lane of railLanes(row.rails)) {
      expect(lane).toBeGreaterThanOrEqual(0);
    }
  }
}

function railLanes(rails: GraphRailSegment[]): number[] {
  return rails.flatMap((rail) => {
    if ('lane' in rail) {
      return [rail.lane];
    }

    return [rail.from, rail.to];
  });
}
