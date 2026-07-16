import { describe, expect, it } from 'vitest';

import type { GitFileDiff } from '@shared/types';

import { buildReviewPlan, type ReviewPatchInput } from './reviewPlan';
import {
  analyzeReviewStructure,
  type ReviewPatchSyntax,
  type ReviewStructureProvider
} from './reviewStructure';

const request = {
  filePath: 'src/shared.input.ts',
  patch: '@@ -2 +2 @@\n-  title!: string;\n+  title!: LocalizedStringInput;\n',
  context: {
    oldContents: 'export class SharedInput {\n  title!: string;\n}',
    newContents: 'export class SharedInput {\n  title!: LocalizedStringInput;\n}'
  }
};

describe('review structure provider boundary', () => {
  it('lets review grouping consume provider-neutral structure facts', async () => {
    const syntax = structureFacts();
    const provider: ReviewStructureProvider = { analyze: async () => syntax };
    const definition = patch(request.filePath, request.patch);
    definition.fileContext = request.context;
    definition.syntax = await analyzeReviewStructure(provider, request);
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'provider-boundary' }, [
      definition,
      patch('src/consumer.ts', '@@ -1 +1 @@\n+consume(SharedInput);\n')
    ]);

    expect(plan.units.find((unit) => unit.symbol === 'SharedInput')?.chunks.map((chunk) => chunk.path)).toEqual([
      'src/shared.input.ts',
      'src/consumer.ts'
    ]);
  });

  it('treats a missing or failing optional provider as no structural facts', async () => {
    const failingProvider: ReviewStructureProvider = {
      analyze: async () => {
        throw new Error('grammar unavailable');
      }
    };

    await expect(analyzeReviewStructure(undefined, request)).resolves.toBeUndefined();
    await expect(analyzeReviewStructure(failingProvider, request)).resolves.toBeUndefined();
  });

  it('keeps generating a generic review plan when the parser provider fails', async () => {
    const failingProvider: ReviewStructureProvider = {
      analyze: async () => {
        throw new Error('failed to load grammar');
      }
    };
    const definition = patch(
      'src/shared.input.ts',
      '@@ -1,3 +1,3 @@\n export class SharedInput {\n-  title!: string;\n+  title!: LocalizedStringInput;\n }\n'
    );
    definition.fileContext = request.context;
    definition.syntax = await analyzeReviewStructure(failingProvider, request);
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'provider-failure' }, [
      definition,
      patch('src/consumer.ts', '@@ -1 +1 @@\n+consume(SharedInput);\n')
    ]);

    expect(definition.syntax).toBeUndefined();
    expect(plan.units.find((unit) => unit.symbol === 'SharedInput')?.chunks.map((chunk) => chunk.path)).toEqual([
      'src/shared.input.ts',
      'src/consumer.ts'
    ]);
  });
});

function structureFacts(): ReviewPatchSyntax {
  const owner = {
    kind: 'class' as const,
    name: 'SharedInput',
    qualifiedName: 'SharedInput',
    startLine: 1,
    endLine: 3
  };

  return {
    language: 'typescript',
    hunks: [{
      hasErrors: false,
      oldOwners: [owner],
      newOwners: [owner],
      oldIdentifiers: [{
        name: 'title',
        role: 'member',
        scope: 'SharedInput.title',
        qualifiedName: 'SharedInput.title'
      }],
      newIdentifiers: [{
        name: 'title',
        role: 'member',
        scope: 'SharedInput.title',
        qualifiedName: 'SharedInput.title'
      }],
      structuralFingerprints: ['member-type:scalar:string->named:localized:string:input']
    }],
    oldNodes: [{ kind: 'declaration', startLine: 1, endLine: 3 }],
    newNodes: [{ kind: 'declaration', startLine: 1, endLine: 3 }],
    hasErrors: false
  };
}

function patch(path: string, hunk: string): ReviewPatchInput {
  return {
    path,
    status: 'modified',
    source: 'commit',
    diff: diff(path, `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${hunk}`)
  };
}

function diff(path: string, patchText: string): GitFileDiff {
  return {
    repoPath: '/repo',
    path,
    mode: 'commit',
    patch: patchText,
    isBinary: false,
    loadedAt: '2026-07-15T00:00:00.000Z'
  };
}
