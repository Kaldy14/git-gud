import { describe, expect, it } from 'vitest';

import {
  buildCommitGraphRows,
  MACHINE_COLOR,
  machineWipSha,
  mergeCommitGraphMachines,
  mergeCommitGraphWorktrees,
  laneBandColor,
  laneColor,
  laneRefColor,
  relativeDateMarkerLabel,
  uniqueRelativeDateMarkerLabels
} from './graph';
import type { GraphCommitInput } from './graph';
import type { CommitGraphMachines, CommitGraphPage, CommitGraphRow, GitStatusSummary, GraphRailSegment } from './types';

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

  it('preserves primary and fallback author avatar sources', () => {
    const rows = buildCommitGraphRows([
      commit('avatar', [], {
        authorAvatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4&s=64',
        authorAvatarFallbackUrl: 'https://www.gravatar.com/avatar/hash?s=64'
      })
    ]);

    expect(rows[0]?.author).toMatchObject({
      avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4&s=64',
      fallbackAvatarUrl: 'https://www.gravatar.com/avatar/hash?s=64'
    });
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
    expect(Array.from({ length: 7 }, (_, lane) => laneRefColor(lane, true))).toEqual(
      Array.from({ length: 7 }, (_, lane) => laneColor(lane))
    );
    expect(laneColor(7)).toBe('#4a9ebc');
  });
});

describe('relativeDateMarkerLabel', () => {
  const now = new Date(2026, 6, 25, 12);

  it.each([
    [new Date(2026, 6, 25, 8), 'today'],
    [new Date(2026, 6, 24, 8), 'yesterday'],
    [new Date(2026, 6, 23, 8), '2 days ago'],
    [new Date(2026, 6, 18, 8), '1 week ago'],
    [new Date(2026, 6, 10, 8), '2 weeks ago'],
    [new Date(2026, 5, 20, 8), '1 month ago'],
    [new Date(2025, 5, 20, 8), '1 year ago']
  ])('formats %s as %s', (value, expected) => {
    expect(relativeDateMarkerLabel(value.toISOString(), now)).toBe(expected);
  });

  it('ignores missing or invalid dates', () => {
    expect(relativeDateMarkerLabel(undefined, now)).toBeUndefined();
    expect(relativeDateMarkerLabel('not-a-date', now)).toBeUndefined();
  });
});

describe('uniqueRelativeDateMarkerLabels', () => {
  const now = new Date(2026, 6, 25, 12);

  it('emits a relative time label only at its first date boundary', () => {
    const values = [
      undefined,
      new Date(2026, 6, 18, 8).toISOString(),
      new Date(2026, 6, 17, 8).toISOString(),
      new Date(2026, 6, 14, 8).toISOString(),
      new Date(2026, 6, 11, 8).toISOString(),
      new Date(2026, 6, 10, 8).toISOString()
    ];

    expect(uniqueRelativeDateMarkerLabels(values, now)).toEqual([
      undefined,
      '1 week ago',
      undefined,
      undefined,
      '2 weeks ago',
      undefined
    ]);
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

describe('linked-worktree graph enrichment', () => {
  const current: GraphCommitInput = {
    ...commit('wip', ['head']), kind: 'wip', dateLabel: 'now',
    worktree: { path: '/repo', current: true }, files: [{ path: 'local.txt', status: 'added' }]
  };
  const linked: GraphCommitInput = {
    ...commit('wip:/linked', ['base']), kind: 'wip', dateLabel: 'now',
    worktree: { path: '/linked', current: false }, files: [{ path: 'linked.txt', status: 'added' }]
  };
  const page: CommitGraphPage = {
    repoPath: '/repo', loadedAt: 'now', limit: 50, loadedCommitCount: 2, hasMore: true, nextLimit: 1500,
    rows: buildCommitGraphRows([current, commit('head', ['base']), { ...commit('stash', ['base']), kind: 'stash' }, commit('base')])
  };

  it('inserts late WIP above its stash and base with connected rails, preserving local changes and paging', () => {
    const enriched = mergeCommitGraphWorktrees(page, { repoPath: '/repo', inputs: [linked] });
    expect(enriched.rows).toEqual(buildCommitGraphRows([
      current, commit('head', ['base']), linked, { ...commit('stash', ['base']), kind: 'stash' }, commit('base')
    ]));
    expect({ ...enriched, rows: [] }).toEqual({ ...page, rows: [] });
    expect(mergeCommitGraphWorktrees(enriched, { repoPath: '/repo', inputs: [] }).rows).toEqual(page.rows);
  });

  it('appends WIP with unloaded parents once and keeps results scoped to their repository', () => {
    const old = { ...linked, parentShas: ['unloaded'] };
    const worktrees = { repoPath: '/repo', inputs: [old] };
    const enriched = mergeCommitGraphWorktrees(page, worktrees);
    expect(enriched.rows.at(-1)?.sha).toBe(linked.sha);
    expect(mergeCommitGraphWorktrees(enriched, worktrees)).toEqual(enriched);
    expect(mergeCommitGraphWorktrees(page, { ...worktrees, repoPath: '/other' })).toBe(page);
    expect(mergeCommitGraphWorktrees(page, undefined)).toBe(page);
  });
});

describe('machine graph enrichment', () => {
  const page: CommitGraphPage = {
    repoPath: '/repo', loadedAt: 'now', limit: 50, loadedCommitCount: 3, hasMore: false, nextLimit: 50,
    rows: buildCommitGraphRows([commit('head', ['base']), commit('base')])
  };
  const status = (oid: string, isDirty: boolean): GitStatusSummary => ({
    branch: { head: 'feature', oid, ahead: 0, behind: 0, isDetached: false },
    files: isDirty
      ? [{ path: 'a.ts', status: 'modified', indexStatus: 'unmodified', worktreeStatus: 'modified', staged: false, unstaged: true, conflicted: false }]
      : [],
    stagedCount: 0, unstagedCount: isDirty ? 1 : 0, untrackedCount: 0, conflictedCount: 0,
    dirtyCount: isDirty ? 1 : 0, isDirty
  });
  const machines = (snapshotStatus: GitStatusSummary, current = true): CommitGraphMachines => ({
    repoPath: '/repo',
    refsChanged: false,
    machines: [{
      machine: { id: 'omarchy', name: 'omarchy', sshHost: 'omarchy' }, remotePath: '~/repo', state: 'online',
      checkedAt: '2026-10-20T10:00:00.000Z', current, status: snapshotStatus, branches: []
    }]
  });

  it('inserts a read-only WIP row directly above its base commit', () => {
    const enriched = mergeCommitGraphMachines(page, machines(status('base', true), false));
    expect(enriched.rows.map((row) => row.sha)).toEqual(['head', machineWipSha('omarchy'), 'base']);
    const wip = enriched.rows[1];
    expect(wip?.node.kind).toBe('wip');
    expect(wip?.colorOverride).toBe(MACHINE_COLOR);
    expect(wip?.worktree).toBeUndefined();
    expect(wip?.machineWip).toEqual({
      id: 'omarchy', name: 'omarchy', branch: 'feature', checkedAt: '2026-10-20T10:00:00.000Z', stale: true
    });
  });

  it('skips clean machines and snapshots for other repositories', () => {
    expect(mergeCommitGraphMachines(page, machines(status('base', false)))).toBe(page);
    expect(mergeCommitGraphMachines(page, { ...machines(status('base', true)), repoPath: '/other' })).toBe(page);
    expect(mergeCommitGraphMachines(page, undefined)).toBe(page);
  });

  it('replaces premerged machine WIP once when a worktree transition seeds the graph cache', () => {
    const first = mergeCommitGraphMachines(page, machines(status('base', true)));
    expect(mergeCommitGraphMachines(first, machines(status('base', true)))).toEqual(first);
    const latest = machines(status('head', true), false);
    const refreshed = mergeCommitGraphMachines(first, latest);
    expect(refreshed.rows.filter((row) => row.machineWip)).toHaveLength(1);
    expect(refreshed).toEqual(mergeCommitGraphMachines(page, latest));
  });

  it('removes cached machine WIP when the new checkout is clean or its machine is removed', () => {
    const enriched = mergeCommitGraphMachines(page, machines(status('base', true)));
    expect(mergeCommitGraphMachines(enriched, machines(status('base', false)))).toEqual(page);
    expect(mergeCommitGraphMachines(enriched, { repoPath: '/repo', refsChanged: false, machines: [] })).toEqual(page);
  });

  it('shows dirty machine checkouts before their first commit', () => {
    const initial = status('base', true);
    delete initial.branch.oid;
    const enriched = mergeCommitGraphMachines({ ...page, rows: [] }, machines(initial));
    expect(enriched.rows).toHaveLength(1);
    expect(enriched.rows[0]).toMatchObject({
      sha: machineWipSha('omarchy'), parentShas: [], machineWip: { id: 'omarchy' },
      files: [{ path: 'a.ts', status: 'modified' }]
    });
  });
});
