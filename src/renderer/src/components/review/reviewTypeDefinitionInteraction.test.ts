import { describe, expect, it } from 'vitest';

import {
  createReviewTypeDefinitionInput,
  isReviewTypeDefinitionGesture,
  isTypeScriptReviewContext
} from './reviewTypeDefinitionInteraction';

describe('review type definition interaction', () => {
  it('accepts an unmodified primary Cmd-click and Ctrl-click', () => {
    expect(isReviewTypeDefinitionGesture(pointerGesture({ metaKey: true }))).toBe(true);
    expect(isReviewTypeDefinitionGesture(pointerGesture({ ctrlKey: true }))).toBe(true);
  });

  it('ignores ordinary clicks, secondary clicks, and competing modifiers', () => {
    expect(isReviewTypeDefinitionGesture(pointerGesture())).toBe(false);
    expect(isReviewTypeDefinitionGesture(pointerGesture({ button: 1, metaKey: true }))).toBe(false);
    expect(isReviewTypeDefinitionGesture(pointerGesture({ altKey: true, metaKey: true }))).toBe(false);
    expect(isReviewTypeDefinitionGesture(pointerGesture({ metaKey: true, shiftKey: true }))).toBe(false);
  });

  it('enables semantic navigation only for TypeScript review contexts', () => {
    expect(isTypeScriptReviewContext({ path: 'src/model.ts', language: 'typescript' })).toBe(true);
    expect(isTypeScriptReviewContext({ path: 'src/view.tsx', language: 'tsx' })).toBe(true);
    expect(isTypeScriptReviewContext({ path: 'src/model.ts', language: 'javascript' })).toBe(false);
    expect(isTypeScriptReviewContext({ path: 'src/model.ts' })).toBe(false);
  });

  it('builds a side-specific snapshot and prioritizes the clicked file', () => {
    const input = createReviewTypeDefinitionInput(
      'src/renamed.ts',
      'old',
      8,
      4,
      { kind: 'wip', scope: 'all' },
      'a'.repeat(64),
      [
        {
          id: 'dependency',
          path: 'src/dependency.ts',
          source: 'commit',
          oldContents: 'export type Dependency = string;',
          newContents: 'export type Dependency = number;',
          syntax: { language: 'typescript', oldNodes: [], newNodes: [], hasErrors: false }
        },
        {
          id: 'clicked',
          path: 'src/renamed.ts',
          originalPath: 'src/original.ts',
          source: 'commit',
          oldContents: 'const value: Dependency = "old";',
          newContents: 'const value: Dependency = 1;',
          syntax: { language: 'typescript', oldNodes: [], newNodes: [], hasErrors: false }
        }
      ]
    );

    expect(input).toMatchObject({
      filePath: 'src/original.ts',
      side: 'old',
      line: 8,
      character: 4,
      target: { kind: 'wip', scope: 'all' },
      sourceFingerprint: 'a'.repeat(64)
    });
  });
});

function pointerGesture(
  overrides: Partial<Pick<MouseEvent, 'altKey' | 'button' | 'ctrlKey' | 'metaKey' | 'shiftKey'>> = {}
): Pick<MouseEvent, 'altKey' | 'button' | 'ctrlKey' | 'metaKey' | 'shiftKey'> {
  return {
    altKey: false,
    button: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides
  };
}
