import { describe, expect, it } from 'vitest';

import { parseConflictMarkers, resolveConflictMarker } from './conflictMarkers';

describe('conflict marker parsing', () => {
  it('finds multiple conflicts and resolves only the selected block', () => {
    const source = [
      'before\n',
      '<<<<<<< HEAD\n',
      'ours one\n',
      '=======\n',
      'theirs one\n',
      '>>>>>>> feature\n',
      'middle\n',
      '<<<<<<< HEAD\n',
      'ours two\n',
      '=======\n',
      'theirs two\n',
      '>>>>>>> feature\n',
      'after\n'
    ].join('');

    const conflicts = parseConflictMarkers(source);

    expect(conflicts).toHaveLength(2);
    expect(conflicts[0]).toMatchObject({ startLine: 2, endLine: 6, ours: 'ours one\n', theirs: 'theirs one\n' });
    expect(resolveConflictMarker(source, conflicts[1]!, 'theirs')).toContain('theirs two\nafter\n');
    expect(resolveConflictMarker(source, conflicts[1]!, 'theirs')).toContain('<<<<<<< HEAD\nours one');
  });

  it('excludes diff3 base content from the ours side', () => {
    const source = [
      '<<<<<<< HEAD\r\n',
      'ours\r\n',
      '||||||| base\r\n',
      'base\r\n',
      '=======\r\n',
      'theirs\r\n',
      '>>>>>>> incoming\r\n'
    ].join('');

    expect(parseConflictMarkers(source)[0]).toMatchObject({ ours: 'ours\r\n', theirs: 'theirs\r\n' });
  });

  it('ignores incomplete marker blocks', () => {
    expect(parseConflictMarkers('<<<<<<< HEAD\nunfinished\n')).toEqual([]);
  });
});
