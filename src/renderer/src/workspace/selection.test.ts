import { describe, expect, it } from 'vitest';

import type { CommitGraphRow } from '@shared/types';

import { resolveSelectedGraphRow } from './selection';

const firstRow: CommitGraphRow = {
  sha: 'a'.repeat(40),
  parentShas: [],
  subject: 'First',
  author: { name: 'Author', initials: 'A', color: '#123456' },
  dateLabel: 'Today',
  node: { lane: 0, kind: 'commit' },
  rails: [],
  files: []
};

describe('selected graph row resolution', () => {
  it('keeps an explicitly selected commit even when it is older than the loaded graph page', () => {
    const oldSha = 'b'.repeat(40);
    const selected = resolveSelectedGraphRow([firstRow], oldSha);

    expect(selected?.sha).toBe(oldSha);
    expect(selected?.subject).toBe('Loading selected commit...');
  });

  it('uses the first graph row when no explicit selection exists', () => {
    expect(resolveSelectedGraphRow([firstRow], undefined)).toBe(firstRow);
  });
});
