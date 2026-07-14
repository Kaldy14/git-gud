import { describe, expect, it } from 'vitest';

import type { CommitGraphRow } from '@shared/types';

import {
  findCurrentBranchName,
  findSelectedContextMenuRow,
  orderSelectedCommitsForCherryPick,
  preferredBranchName,
  registerRefClick,
  resolveBulkSquashSelection,
  selectCommitRange,
  toggleSelectedCommit
} from './graphInteraction';

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

describe('graph bulk commit selection', () => {
  it('toggles commits without disturbing the existing selection order', () => {
    expect(toggleSelectedCommit(['newest'], 'older')).toEqual(['newest', 'older']);
    expect(toggleSelectedCommit(['newest', 'older'], 'newest')).toEqual(['older']);
  });

  it('selects an ancestry range without including interleaved branch commits', () => {
    const rows = [
      commitRow('newest', ['middle']),
      commitRow('side-newer', ['side-older']),
      commitRow('middle', ['oldest']),
      commitRow('side-older', ['base']),
      commitRow('oldest', ['base'])
    ];

    expect(selectCommitRange(rows, 'newest', 'oldest')).toEqual(['newest', 'middle', 'oldest']);
    expect(selectCommitRange(rows, 'oldest', 'newest')).toEqual(['newest', 'middle', 'oldest']);
  });

  it('falls back to the visible graph range for commits on separate branches', () => {
    const rows = [
      commitRow('left', ['base']),
      commitRow('middle', ['base']),
      commitRow('right', ['base'])
    ];

    expect(selectCommitRange(rows, 'left', 'right')).toEqual(['left', 'middle', 'right']);
  });

  it('orders cherry-picks oldest to newest regardless of click order', () => {
    const rows = [commitRow('newest', ['middle']), commitRow('middle', ['oldest']), commitRow('oldest', ['base'])];

    expect(orderSelectedCommitsForCherryPick(rows, ['newest', 'oldest', 'middle'])).toEqual([
      'oldest',
      'middle',
      'newest'
    ]);
  });

  it('builds a squash plan for contiguous commits on the checked-out branch', () => {
    const rows = [
      commitRow('head', ['newer'], true),
      commitRow('newer', ['older']),
      commitRow('older', ['base']),
      commitRow('base', [])
    ];

    expect(resolveBulkSquashSelection(rows, ['newer', 'older'])).toEqual({
      canSquash: true,
      baseSha: 'base',
      squashShas: ['newer']
    });
  });

  it('rejects non-contiguous or off-branch squash selections', () => {
    const rows = [
      commitRow('head', ['middle'], true),
      commitRow('middle', ['oldest']),
      commitRow('oldest', ['base']),
      commitRow('side', ['base'])
    ];

    expect(resolveBulkSquashSelection(rows, ['head', 'oldest'])).toMatchObject({
      canSquash: false,
      reason: 'Selected commits must be contiguous.'
    });
    expect(resolveBulkSquashSelection(rows, ['head', 'side'])).toMatchObject({
      canSquash: false,
      reason: 'Selected commits must be on the checked-out branch.'
    });
  });
});

describe('commit branch name copy target', () => {
  it('prefers the checked-out local branch and falls back to a display remote branch name', () => {
    expect(
      preferredBranchName({
        ...commitRow('head', []),
        refs: [
          { kind: 'branch', label: 'feature/secondary' },
          { kind: 'branch', label: 'main', current: true },
          { kind: 'remote', label: 'origin/main' }
        ]
      })
    ).toBe('main');
    expect(
      preferredBranchName({
        ...commitRow('remote', []),
        refs: [{ kind: 'remote', label: 'upstream/feature/deep-path' }]
      })
    ).toBe('feature/deep-path');
  });

  it('returns undefined when the commit has no branch ref', () => {
    expect(preferredBranchName(commitRow('detached', []))).toBeUndefined();
  });
});

function commitRow(sha: string, parentShas: string[], current = false): CommitGraphRow {
  return {
    sha,
    parentShas,
    subject: sha,
    author: { name: 'Test', initials: 'T', color: '#ffffff' },
    dateLabel: 'now',
    node: { lane: 0, kind: 'commit' },
    rails: [],
    refs: current ? [{ kind: 'branch', label: 'main', current: true }] : [],
    files: []
  };
}
