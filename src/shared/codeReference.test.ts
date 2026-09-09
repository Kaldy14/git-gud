import { expect, it } from 'vitest';
import { parseCodeReference } from './codeReference';
it('recognizes relative Markdown anchors and inline file locations', () => {
  expect(parseCodeReference('src/a.ts#L42-L50')).toEqual({ path: 'src/a.ts', line: 42 });
  expect(parseCodeReference('./src/a.ts:42-50')).toEqual({ path: 'src/a.ts', line: 42 });
  expect(parseCodeReference('README.md')).toEqual({ path: 'README.md' });
});
it('does not reinterpret URLs, traversal, or malformed locations as local files', () => {
  for (const input of ['https://example.com/a.ts', 'file:///a.ts', '../a.ts', '%2e%2e/a.ts', '/a.ts', 'C:\\a.ts', 'src/a.ts:0', '#L42', 'words', 'src/a.ts#other', 'src/a.ts:999999999999999999']) {
    expect(parseCodeReference(input), input).toBeUndefined();
  }
});
