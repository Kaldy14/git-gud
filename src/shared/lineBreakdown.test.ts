import { describe, expect, it } from 'vitest';

import { classifyChangedPath, summarizeLineBreakdown } from './lineBreakdown';

describe('classifyChangedPath', () => {
  it.each([
    ['src/main/github.ts', 'code'],
    ['src/renderer/src/styles/main.css', 'code'],
    ['src/shared/lineBreakdown.test.ts', 'tests'],
    ['packages/api/__tests__/client.ts', 'tests'],
    ['web/e2e/login.ts', 'tests'],
    ['src/__snapshots__/view.tsx.snap', 'tests'],
    ['docs/README.md', 'docs'],
    ['CHANGELOG.md', 'docs'],
    ['LICENSE', 'docs'],
    ['package.json', 'config'],
    ['.github/workflows/ci.yml', 'config'],
    ['vitest.config.ts', 'config'],
    ['Dockerfile', 'config'],
    ['pnpm-lock.yaml', 'generated'],
    ['src/gql/__generated__/types.ts', 'generated'],
    ['go.sum', 'generated']
  ])('%s is %s', (path, kind) => {
    expect(classifyChangedPath(path)).toBe(kind);
  });
});

describe('summarizeLineBreakdown', () => {
  it('groups lines by kind in a stable order', () => {
    const rows = summarizeLineBreakdown(
      [
        { path: 'src/a.test.ts', additions: 77, deletions: 1 },
        { path: 'src/a.ts', additions: 40, deletions: 5 },
        { path: 'src/b.ts', additions: 15, deletions: 2 }
      ],
      { additions: 132, deletions: 8, changedFiles: 3 }
    );

    expect(rows).toEqual([
      { kind: 'code', label: 'Code', files: 2, additions: 55, deletions: 7 },
      { kind: 'tests', label: 'Tests', files: 1, additions: 77, deletions: 1 }
    ]);
  });

  it('reports lines beyond the listed files as unlisted', () => {
    const rows = summarizeLineBreakdown(
      [{ path: 'src/a.ts', additions: 10, deletions: 2 }],
      { additions: 25, deletions: 2, changedFiles: 4 }
    );

    expect(rows.at(-1)).toEqual({ kind: 'unlisted', label: 'Unlisted', files: 3, additions: 15, deletions: 0 });
  });
});
