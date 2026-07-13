import { describe, expect, it } from 'vitest';

import type { CommitGraphRow } from '@shared/types';

import { findCurrentBranchName, findSelectedContextMenuRow, registerRefClick } from './graphInteraction';

const newestRow = { sha: 'newest' } as CommitGraphRow;

describe('graph keyboard context menu targeting', () => {
  it('does not substitute the newest row for a selected commit outside the loaded page', () => {
    expect(findSelectedContextMenuRow([newestRow], 'older-not-loaded')).toBeUndefined();
  });

  it('returns the exact loaded selection', () => {
    expect(findSelectedContextMenuRow([newestRow], 'newest')).toBe(newestRow);
  });
});

describe('graph branch targeting', () => {
  it('finds the checked-out local branch from graph refs', () => {
    const rows = [
      {
        sha: 'feature',
        refs: [{ kind: 'branch', label: 'feature/one' }]
      },
      {
        sha: 'main',
        refs: [{ kind: 'branch', label: 'main', current: true }]
      }
    ] as CommitGraphRow[];

    expect(findCurrentBranchName(rows)).toBe('main');
  });

  it('returns undefined for detached HEAD graph data', () => {
    expect(findCurrentBranchName([{ ...newestRow, sha: 'detached', refs: [] }])).toBeUndefined();
  });
});

describe('graph ref double-click targeting', () => {
  it('activates the same ref across separate chip elements', () => {
    const first = registerRefClick(undefined, { kind: 'branch', label: 'feature/one' }, 1000);
    const second = registerRefClick(first.nextState, { kind: 'branch', label: 'feature/one' }, 1250);

    expect(second).toEqual({ activate: true });
  });

  it('does not combine clicks on different refs or slow clicks', () => {
    const first = registerRefClick(undefined, { kind: 'remote', label: 'origin/main' }, 1000);

    expect(registerRefClick(first.nextState, { kind: 'branch', label: 'main' }, 1200).activate).toBe(false);
    expect(registerRefClick(first.nextState, { kind: 'remote', label: 'origin/main' }, 1600).activate).toBe(false);
  });
});
