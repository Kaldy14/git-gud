import { describe, expect, it } from 'vitest';

import { isWhitespaceOnlyLineChange } from './whitespaceDiff';

describe('whitespace-only diff presentation', () => {
  it('recognizes inserted indentation without treating the line content as replaced', () => {
    expect(isWhitespaceOnlyLineChange(
      '  ${branchEffective.updatedAt},',
      '    ${branchEffective.updatedAt},'
    )).toBe(true);
  });

  it('recognizes whitespace changes inside a line and across tabs', () => {
    expect(isWhitespaceOnlyLineChange('const value=1;', 'const value = 1;')).toBe(true);
    expect(isWhitespaceOnlyLineChange('\treturn value;', '  return value;')).toBe(true);
  });

  it('keeps substantive edits as ordinary delete and add rows', () => {
    expect(isWhitespaceOnlyLineChange('return value;', 'return nextValue;')).toBe(false);
    expect(isWhitespaceOnlyLineChange('return value;', 'return value;')).toBe(false);
  });
});
