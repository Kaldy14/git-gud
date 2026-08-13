import { describe, expect, it } from 'vitest';

import { resolveReviewTypeDefinition, type ReviewTypeDefinitionFileContext } from './reviewTypeDefinition';

describe('review TypeScript definition resolution', () => {
  it.each([
    ['interface', 'interface ReviewTarget {\n  enabled: boolean;\n}\n\nconst value: ReviewTarget = { enabled: true };'],
    ['type', 'type ReviewTarget = {\n  enabled: boolean;\n};\n\nconst value: ReviewTarget = { enabled: true };']
  ])('returns the full same-file %s declaration', async (declarationKind, contents) => {
    const result = resolve('src/review.ts', contents, contents, 5, 13);

    expect(result).toMatchObject({
      name: 'ReviewTarget',
      path: 'src/review.ts',
      kind: 'definition',
      declarationKind,
      startLine: 1,
      startCharacter: 0
    });
    expect(result?.snippet).toContain('ReviewTarget');
    expect(result?.snippet).toContain('enabled: boolean');
  });

  it('resolves an imported declaration from another review context', async () => {
    const files: ReviewTypeDefinitionFileContext[] = [
      {
        path: 'src/model.ts',
        oldContents: 'export interface User { id: string; }',
        newContents: 'export interface User { id: string; name: string; }'
      },
      {
        path: 'src/view.ts',
        oldContents: "import type { User } from './model';\nexport const render = (user: User) => user.id;",
        newContents: "import type { User } from './model';\nexport const render = (user: User) => user.name;"
      }
    ];

    const result = resolveReviewTypeDefinition({
      filePath: 'src/view.ts',
      side: 'new',
      line: 2,
      character: 29,
      files
    });

    expect(result).toMatchObject({
      name: 'User',
      path: 'src/model.ts',
      declarationKind: 'interface',
      startLine: 1
    });
    expect(result?.snippet).toBe('export interface User { id: string; name: string; }');
  });

  it('uses contents from the requested review side', async () => {
    const oldContents = 'interface OldShape { oldValue: string; }\nconst value: OldShape = { oldValue: "" };';
    const newContents = 'interface NewShape { newValue: string; }\nconst value: NewShape = { newValue: "" };';
    const files = [{ path: 'src/value.ts', oldContents, newContents }];

    const oldResult = resolveReviewTypeDefinition({
      filePath: 'src/value.ts',
      side: 'old',
      line: 2,
      character: 13,
      files
    });
    const newResult = resolveReviewTypeDefinition({
      filePath: 'src/value.ts',
      side: 'new',
      line: 2,
      character: 13,
      files
    });

    expect(oldResult?.name).toBe('OldShape');
    expect(oldResult?.snippet).toContain('oldValue');
    expect(newResult?.name).toBe('NewShape');
    expect(newResult?.snippet).toContain('newValue');
  });

  it('returns undefined for an unresolved token', async () => {
    const contents = 'const value = missingSymbol;';

    expect(resolve('src/value.ts', contents, contents, 1, 15)).toBeUndefined();
  });

  it('rejects paths outside the authorized review snapshot', () => {
    const contents = 'interface Outside { value: string }\nconst item: Outside = { value: "" };';

    expect(resolve('../outside.ts', contents, contents, 2, 12)).toBeUndefined();
  });

  it('resolves context-only GitHub review snapshots without a local checkout', () => {
    const contents = 'interface RemoteShape { value: string; }\nconst item: RemoteShape = { value: "" };';

    const result = resolveReviewTypeDefinition({
      filePath: 'src/remote.ts',
      side: 'new',
      line: 2,
      character: 12,
      files: [{ path: 'src/remote.ts', oldContents: contents, newContents: contents }]
    });

    expect(result).toMatchObject({
      name: 'RemoteShape',
      path: 'src/remote.ts',
      declarationKind: 'interface'
    });
  });
});

function resolve(
  filePath: string,
  oldContents: string,
  newContents: string,
  line: number,
  character: number
) {
  return resolveReviewTypeDefinition({
    filePath,
    side: 'new',
    line,
    character,
    files: [{ path: filePath, oldContents, newContents }]
  });
}
