import { describe, expect, it } from 'vitest';

import { parseStageablePatchHunks } from './stageablePatch';

const header = [
  'diff --git a/file.txt b/file.txt',
  'index 1111111..2222222 100644',
  '--- a/file.txt',
  '+++ b/file.txt'
].join('\n');

describe('parseStageablePatchHunks', () => {
  it('preserves ordered hunk patches, counts, and previews', () => {
    const hunks = parseStageablePatchHunks(
      `${header}\n@@ -1 +1 @@\n-old one\n+new one\n@@ -10,2 +10,2 @@\n context\n-old two\n+new two\n`
    );

    expect(hunks).toHaveLength(2);
    expect(
      hunks.map(({ header: hunkHeader, additions, deletions, preview }) => ({
        header: hunkHeader,
        additions,
        deletions,
        preview
      }))
    ).toEqual([
      { header: '@@ -1 +1 @@', additions: 1, deletions: 1, preview: 'old one' },
      { header: '@@ -10,2 +10,2 @@', additions: 1, deletions: 1, preview: 'old two' }
    ]);
    expect(hunks[0]?.patch).toBe(`${header}\n@@ -1 +1 @@\n-old one\n+new one\n`);
    expect(hunks[1]?.patch).toBe(`${header}\n@@ -10,2 +10,2 @@\n context\n-old two\n+new two\n`);
  });

  it('rejects unsupported rename and binary patch headers', () => {
    expect(
      parseStageablePatchHunks(
        `${header}\nrename from old.txt\nrename to file.txt\n@@ -1 +1 @@\n-old\n+new\n`
      )
    ).toEqual([]);
    expect(parseStageablePatchHunks('GIT binary patch\n@@ -1 +1 @@\n-old\n+new\n')).toEqual([]);
  });

  it('returns no hunks for empty or header-only patches', () => {
    expect(parseStageablePatchHunks(undefined)).toEqual([]);
    expect(parseStageablePatchHunks(`${header}\n`)).toEqual([]);
  });
});
