import { describe, expect, it } from 'vitest';

import type { CommitGraphRow } from '@shared/types';

import { laneColor } from '@shared/graph';

import { graphBranchCheckoutLocation, graphOverrideColor, graphRowAriaLabel, readableTextOn } from './graphRowPresentation';

const baseRow: CommitGraphRow = {
  sha: 'a'.repeat(40),
  parentShas: [],
  subject: 'Initial state',
  author: { name: 'WIP Counts Test', initials: 'WC', color: '#123456' },
  dateLabel: 'Today',
  node: { lane: 0, kind: 'commit' },
  rails: [],
  files: []
};

describe('graph ref and node colors', () => {
  it('keeps current-branch text at AA contrast on every lane color', () => {
    for (let lane = 0; lane < 7; lane += 1) {
      const background = laneColor(lane);

      expect(contrast(readableTextOn(background), background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('falls back to light text for a background it cannot parse', () => {
    expect(readableTextOn('var(--accent)')).toBe('#ffffff');
  });

  it('draws the working copy neutrally and keeps other override colors', () => {
    expect(graphOverrideColor('#bc271b')).toBe('#aeb4bf');
    expect(graphOverrideColor('#f0a13f')).toBe('#f0a13f');
    expect(graphOverrideColor(undefined)).toBeUndefined();
  });
});

describe('graph row accessible labels', () => {
  it('includes the non-zero WIP status breakdown', () => {
    expect(
      graphRowAriaLabel({
        ...baseRow,
        sha: 'wip',
        node: { lane: 0, kind: 'wip' },
        worktree: { path: '/repo', branch: 'main', current: true },
        files: [
          { path: 'edited-a.ts', status: 'modified' },
          { path: 'edited-b.ts', status: 'modified' },
          { path: 'added.ts', status: 'added' },
          { path: 'deleted.ts', status: 'deleted' }
        ]
      })
    ).toBe('local changes on main, 2 modified files, 1 added file, 1 deleted file');
  });

  it('preserves commit metadata in non-WIP row labels', () => {
    expect(graphRowAriaLabel(baseRow)).toBe(
      `Initial state, WIP Counts Test, Today, ${'a'.repeat(7)}`
    );
  });
});

describe('graph branch checkout presentation', () => {
  it('distinguishes the current branch from branches owned by linked worktrees', () => {
    const linkedWorktrees = new Set(['feature/linked']);

    expect(
      graphBranchCheckoutLocation({ kind: 'branch', label: 'main', current: true }, linkedWorktrees)
    ).toBe('current');
    expect(
      graphBranchCheckoutLocation({ kind: 'branch', label: 'feature/linked' }, linkedWorktrees)
    ).toBe('linked-worktree');
  });

  it('does not mark ordinary local or non-branch refs as checked out', () => {
    const linkedWorktrees = new Set(['feature/linked']);

    expect(
      graphBranchCheckoutLocation({ kind: 'branch', label: 'feature/local' }, linkedWorktrees)
    ).toBeUndefined();
    expect(
      graphBranchCheckoutLocation({ kind: 'remote', label: 'origin/feature/linked' }, linkedWorktrees)
    ).toBeUndefined();
  });
});

function contrast(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a) as [number, number];

  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
