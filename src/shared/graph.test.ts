import { describe, expect, it } from 'vitest';

import { buildCommitGraphRows } from './graph';
import type { GraphCommitInput } from './graph';

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
    expect(rows[3]?.rails).toContainEqual({ type: 'curveIn', from: 1, to: 0 });
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
