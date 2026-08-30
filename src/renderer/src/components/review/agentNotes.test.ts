import { describe, expect, it } from 'vitest';

import type { GitAgentNote, GitReviewFileContext } from '@shared/types';

import {
  loadHiddenAgentNoteIds,
  resolveAgentNotes,
  saveHiddenAgentNoteIds
} from './agentNotes';

const note: GitAgentNote = {
  id: 'contract-note',
  path: 'src/example.ts',
  line: 2,
  anchor: 'return value;',
  summary: 'Keep this return inside the transaction.',
  author: 'Codex',
  createdAt: '2026-08-30T10:00:00.000Z'
};

const context: GitReviewFileContext = {
  id: 'file-context',
  path: 'src/example.ts',
  source: 'unstaged',
  oldContents: '',
  newContents: ['export function example() {', '  return value;', '}'].join('\n')
};

describe('Agent Notes review matching', () => {
  it('keeps a note on its requested line when the anchor matches', () => {
    expect(resolveAgentNotes([note], [context])).toEqual([note]);
  });

  it('relocates a note when its anchor moved to one unique line', () => {
    const movedContext = {
      ...context,
      newContents: ['const value = 1;', '', ...context.newContents.split('\n')].join('\n')
    };

    expect(resolveAgentNotes([note], [movedContext])).toEqual([{ ...note, line: 4 }]);
  });

  it('drops stale or ambiguous notes instead of attaching them to the wrong code', () => {
    const ambiguousContext = {
      ...context,
      newContents: ['return value;', 'return value;'].join('\n')
    };

    expect(resolveAgentNotes([{ ...note, line: 3 }], [ambiguousContext])).toEqual([]);
    expect(resolveAgentNotes([{ ...note, anchor: 'missing();' }], [context])).toEqual([]);
  });
});

describe('hidden Agent Notes', () => {
  it('persists hidden note ids per repository', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    };

    saveHiddenAgentNoteIds(storage, '/repo', new Set(['one', 'two']));

    expect(loadHiddenAgentNoteIds(storage, '/repo')).toEqual(new Set(['one', 'two']));
    expect(loadHiddenAgentNoteIds(storage, '/other-repo')).toEqual(new Set());
  });
});
