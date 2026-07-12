import { describe, expect, it } from 'vitest';

import type { CommitGraphRow } from '@shared/types';

import { findSelectedContextMenuRow } from './graphInteraction';

const newestRow = { sha: 'newest' } as CommitGraphRow;

describe('graph keyboard context menu targeting', () => {
  it('does not substitute the newest row for a selected commit outside the loaded page', () => {
    expect(findSelectedContextMenuRow([newestRow], 'older-not-loaded')).toBeUndefined();
  });

  it('returns the exact loaded selection', () => {
    expect(findSelectedContextMenuRow([newestRow], 'newest')).toBe(newestRow);
  });
});
