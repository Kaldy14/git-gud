import { describe, expect, it } from 'vitest';

import type { CommitGraphRow } from '@shared/types';

import { findCurrentBranchName, findSelectedContextMenuRow } from './graphInteraction';

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
