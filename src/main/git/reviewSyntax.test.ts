import { describe, expect, it } from 'vitest';

import {
  analyzeReviewPatchSyntax,
  canAnalyzeReviewSyntaxContext,
  resetReviewSyntaxCacheForTests,
  reviewSyntaxCacheStatsForTests,
  reviewSyntaxCacheUsageForTests,
  reviewSyntaxLanguage,
  reviewSyntaxQueryStatsForTests,
  setReviewSyntaxCacheLimitsForTests
} from './reviewSyntax';

describe('review syntax analysis', () => {
  it.each([
    ['typescript', 'src/value.ts', 'export const value: string = "old";', 'export const value: string = "new";'],
    ['tsx', 'src/view.tsx', 'export const View = () => <div>old</div>;', 'export const View = () => <div>new</div>;'],
    ['javascript', 'src/value.js', 'export const value = "old";', 'export const value = "new";'],
    ['jsx', 'src/view.jsx', 'export const View = () => <div>old</div>;', 'export const View = () => <div>new</div>;'],
    ['graphql', 'schema/value.graphql', 'input ValueInput { title: String! }', 'input ValueInput { title: ID! }'],
    ['graphql', 'schema/value.gql', 'input ValueInput { title: String! }', 'input ValueInput { title: ID! }']
  ] as const)('parses supported %s files', async (language, filePath, oldContents, newContents) => {
    const analysis = await analyzeReviewPatchSyntax(
      filePath,
      `@@ -1 +1 @@\n-${oldContents}\n+${newContents}\n`,
      { oldContents, newContents },
      `supported-language:${language}:${filePath}`
    );

    expect(analysis?.language).toBe(language);
    expect(analysis?.hasErrors).toBe(false);
    expect(analysis?.hunks[0]?.newIdentifiers.length).toBeGreaterThan(0);
  });

  it('captures complete TypeScript declarations and nested blocks around a changed line', async () => {
    const oldContents = [
      'export class ReviewService {',
      '  run(enabled: boolean) {',
      '    if (enabled) {',
      '      return { result: false };',
      '    }',
      '  }',
      '}'
    ].join('\n');
    const newContents = oldContents.replace('false', 'true');
    const analysis = await analyzeReviewPatchSyntax(
      'src/review.ts',
      '@@ -4 +4 @@\n-      return { result: false };\n+      return { result: true };\n',
      { oldContents, newContents },
      'typescript-structure'
    );

    expect(analysis?.newNodes).toEqual(expect.arrayContaining([
      { kind: 'declaration', startLine: 1, endLine: 7 },
      { kind: 'block', startLine: 2, endLine: 6 },
      { kind: 'block', startLine: 3, endLine: 5 }
    ]));
    expect(analysis?.hunks[0]?.newOwners).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'class',
        qualifiedName: 'ReviewService'
      }),
      expect.objectContaining({
        kind: 'method',
        qualifiedName: 'ReviewService.run'
      })
    ]));
  });

  it('qualifies changed TypeScript members by their unchanged lexical owner', async () => {
    const oldContents = [
      'export class ProductCategorySeoInput {',
      '  title!: string;',
      '}'
    ].join('\n');
    const newContents = oldContents.replace('string', 'LocalizedStringInput');
    const analysis = await analyzeReviewPatchSyntax(
      'src/product-category-seo.input.ts',
      '@@ -2 +2 @@\n-  title!: string;\n+  title!: LocalizedStringInput;\n',
      { oldContents, newContents },
      'typescript-qualified-members'
    );

    expect(analysis?.hunks[0]?.newIdentifiers).toEqual(expect.arrayContaining([
      {
        name: 'title',
        role: 'member',
        scope: 'ProductCategorySeoInput.title',
        qualifiedName: 'ProductCategorySeoInput.title'
      },
      {
        name: 'LocalizedStringInput',
        role: 'type-reference',
        scope: 'ProductCategorySeoInput.title',
        qualifiedName: undefined
      }
    ]));
  });

  it('does not report identifiers that occur only in comments or strings', async () => {
    const oldContents = '// unrelated note\nexport const value = "old";';
    const newContents = '// SharedConfig should not create a relationship\nexport const value = "new SharedConfig";';
    const analysis = await analyzeReviewPatchSyntax(
      'src/notes.ts',
      '@@ -1,2 +1,2 @@\n-// unrelated note\n-export const value = "old";\n+// SharedConfig should not create a relationship\n+export const value = "new SharedConfig";\n',
      { oldContents, newContents },
      'typescript-non-code-identifiers'
    );
    const names = analysis?.hunks[0]?.newIdentifiers.map((identifier) => identifier.name);

    expect(names).toContain('value');
    expect(names).not.toContain('SharedConfig');
    expect(names).not.toContain('new');
  });

  it('captures TypeScript roles with Tree-sitter queries', async () => {
    const newContents = [
      "import { Field } from '@nestjs/graphql';",
      '@InputType()',
      'export class ProductInput {',
      '  @Field(() => LocalizedStringInput)',
      '  title!: LocalizedStringInput;',
      '  load() { return mapper.transform(this.title); }',
      '}'
    ].join('\n');
    const analysis = await analyzeReviewPatchSyntax(
      'src/product.input.ts',
      '@@ -0,0 +1,7 @@\n' + newContents.split('\n').map((line) => `+${line}\n`).join(''),
      { oldContents: '', newContents },
      'typescript-query-roles'
    );
    const identifiers = analysis?.hunks[0]?.newIdentifiers ?? [];

    expect(identifiers).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'ProductInput', role: 'declaration' }),
      expect.objectContaining({ name: 'title', role: 'member', qualifiedName: 'ProductInput.title' }),
      expect.objectContaining({ name: 'LocalizedStringInput', role: 'type-reference' }),
      expect.objectContaining({ name: 'InputType', role: 'decorator' }),
      expect.objectContaining({ name: 'Field', role: 'decorator' }),
      expect.objectContaining({ name: 'transform', role: 'call', qualifiedName: 'mapper.transform' })
    ]));
    expect(identifiers.find((identifier) => identifier.name === 'Field' && identifier.role === 'import'))
      .toBeDefined();
  });

  it('captures complete GraphQL owner and field blocks', async () => {
    const oldContents = [
      'input ProductInput {',
      '  title: String!',
      '  description: String!',
      '}'
    ].join('\n');
    const newContents = oldContents.replace('title: String!', 'title: LocalizedStringInput!');
    const analysis = await analyzeReviewPatchSyntax(
      'schema.graphql',
      '@@ -2 +2 @@\n-  title: String!\n+  title: LocalizedStringInput!\n',
      { oldContents, newContents },
      'graphql-structure'
    );

    expect(analysis?.newNodes).toEqual(expect.arrayContaining([
      { kind: 'graphql', startLine: 1, endLine: 4 }
    ]));
    expect(analysis?.hunks[0]?.newOwners).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'graphql-type',
        qualifiedName: 'ProductInput'
      }),
      expect.objectContaining({
        kind: 'graphql-field',
        qualifiedName: 'ProductInput.title'
      })
    ]));
    expect(analysis?.hunks[0]?.newIdentifiers).toEqual(expect.arrayContaining([
      {
        name: 'title',
        role: 'member',
        scope: 'ProductInput.title',
        qualifiedName: 'ProductInput.title'
      },
      {
        name: 'LocalizedStringInput',
        role: 'type-reference',
        scope: 'ProductInput.title',
        qualifiedName: undefined
      }
    ]));
  });

  it('captures GraphQL declarations, fields, references, and type references with queries', async () => {
    const newContents = [
      'input ProductInput {',
      '  title: LocalizedStringInput!',
      '}',
      'query LoadProduct {',
      '  product { title }',
      '}'
    ].join('\n');
    const analysis = await analyzeReviewPatchSyntax(
      'schema/product.gql',
      '@@ -0,0 +1,6 @@\n' + newContents.split('\n').map((line) => `+${line}\n`).join(''),
      { oldContents: '', newContents },
      'graphql-query-roles'
    );

    expect(analysis?.hunks[0]?.newIdentifiers).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'ProductInput', role: 'declaration' }),
      expect.objectContaining({ name: 'title', role: 'member', qualifiedName: 'ProductInput.title' }),
      expect.objectContaining({ name: 'LocalizedStringInput', role: 'type-reference' }),
      expect.objectContaining({ name: 'LoadProduct', role: 'declaration' }),
      expect.objectContaining({ name: 'product', role: 'reference', qualifiedName: 'LoadProduct.product' })
    ]));
  });

  it('leaves unsupported languages on the generic fallback path', () => {
    expect(reviewSyntaxLanguage('component.tsx')).toBe('tsx');
    expect(reviewSyntaxLanguage('component.jsx')).toBe('jsx');
    expect(reviewSyntaxLanguage('module.js')).toBe('javascript');
    expect(reviewSyntaxLanguage('module.ts')).toBe('typescript');
    expect(reviewSyntaxLanguage('schema.graphql')).toBe('graphql');
    expect(reviewSyntaxLanguage('schema.gql')).toBe('graphql');
    expect(reviewSyntaxLanguage('service.py')).toBeUndefined();
    expect(reviewSyntaxLanguage('service.rs')).toBeUndefined();
  });

  it('keeps useful syntax facts around incomplete WIP code', async () => {
    const oldContents = 'export class DraftInput {\n  title!: string;\n}';
    const newContents = 'export class DraftInput {\n  title!: LocalizedStringInput;';
    const analysis = await analyzeReviewPatchSyntax(
      'src/draft.input.ts',
      '@@ -1,3 +1,2 @@\n export class DraftInput {\n-  title!: string;\n-}\n+  title!: LocalizedStringInput;\n',
      { oldContents, newContents },
      'incomplete-wip'
    );

    expect(analysis?.hasErrors).toBe(true);
    expect(analysis?.hunks[0]?.hasErrors).toBe(true);
    expect(analysis?.hunks[0]?.newOwners).toEqual(expect.arrayContaining([
      expect.objectContaining({ qualifiedName: 'DraftInput' })
    ]));
  });

  it('keeps valid hunks trusted when another changed range has a syntax error', async () => {
    resetReviewSyntaxCacheForTests();
    const oldContents = [
      'export class ProductInput {',
      '  title!: string;',
      '}',
      '',
      'export const draft = 1;'
    ].join('\n');
    const newContents = [
      'export class ProductInput {',
      '  title!: LocalizedStringInput;',
      '}',
      '',
      'export const draft = ;'
    ].join('\n');
    const analysis = await analyzeReviewPatchSyntax(
      'src/product.input.ts',
      [
        '@@ -2 +2 @@',
        '-  title!: string;',
        '+  title!: LocalizedStringInput;',
        '@@ -5 +5 @@',
        '-export const draft = 1;',
        '+export const draft = ;',
        ''
      ].join('\n'),
      { oldContents, newContents },
      'range-local-errors'
    );

    expect(analysis?.hasErrors).toBe(true);
    expect(analysis?.hunks[0]).toMatchObject({ hasErrors: false });
    expect(analysis?.hunks[0]?.newIdentifiers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'title',
        role: 'member',
        qualifiedName: 'ProductInput.title'
      })
    ]));
    expect(analysis?.hunks[1]).toMatchObject({ hasErrors: true });
    expect(reviewSyntaxQueryStatsForTests()).toEqual({ queryCaptureScans: 2 });
    resetReviewSyntaxCacheForTests();
  });

  it('rejects oversized syntax contexts before parsing', () => {
    const oversizedSide = 'x'.repeat(4 * 1024 * 1024 + 1);

    expect(canAnalyzeReviewSyntaxContext({
      oldContents: oversizedSide,
      newContents: oversizedSide
    })).toBe(false);
  });

  it('evicts cached syntax documents by source bytes', async () => {
    resetReviewSyntaxCacheForTests();
    setReviewSyntaxCacheLimitsForTests({
      maximumDocuments: 8,
      maximumSourceBytes: 150
    });
    const oldContents = 'export const value = "old";\n';
    const newContents = 'export const value = "new";\n';
    const patch = '@@ -1 +1 @@\n-export const value = "old";\n+export const value = "new";\n';

    await analyzeReviewPatchSyntax('src/one.ts', patch, { oldContents, newContents }, 'byte-budget-one');
    await analyzeReviewPatchSyntax('src/two.ts', patch, { oldContents, newContents }, 'byte-budget-two');

    expect(reviewSyntaxCacheUsageForTests()).toMatchObject({ cachedDocuments: 2 });
    expect(reviewSyntaxCacheUsageForTests().cachedSourceBytes).toBeLessThanOrEqual(150);
    resetReviewSyntaxCacheForTests();
  });

  it('reuses unchanged trees and invalidates changed WIP documents incrementally', async () => {
    resetReviewSyntaxCacheForTests();
    const oldContents = 'export class DraftInput {\n  title!: string;\n}';
    const firstNewContents = 'export class DraftInput {\n  title!: LocalizedStringInput;\n}';
    const secondNewContents = 'export class DraftInput {\n  title!: number;\n}';
    const firstPatch = '@@ -2 +2 @@\n-  title!: string;\n+  title!: LocalizedStringInput;\n';
    const secondPatch = '@@ -2 +2 @@\n-  title!: string;\n+  title!: number;\n';

    const first = await analyzeReviewPatchSyntax(
      'src/draft.input.ts',
      firstPatch,
      { oldContents, newContents: firstNewContents },
      'incremental-wip'
    );
    const initialStats = reviewSyntaxCacheStatsForTests();
    await analyzeReviewPatchSyntax(
      'src/draft.input.ts',
      firstPatch,
      { oldContents, newContents: firstNewContents },
      'incremental-wip'
    );
    const reusedStats = reviewSyntaxCacheStatsForTests();
    const second = await analyzeReviewPatchSyntax(
      'src/draft.input.ts',
      secondPatch,
      { oldContents, newContents: secondNewContents },
      'incremental-wip'
    );
    const invalidatedStats = reviewSyntaxCacheStatsForTests();

    expect(first?.hunks[0]?.structuralFingerprints).toEqual([
      'member-type:scalar:string->named:localized:string:input'
    ]);
    expect(second?.hunks[0]?.structuralFingerprints).toEqual([
      'member-type:scalar:string->scalar:number'
    ]);
    expect(initialStats).toEqual({ cacheHits: 0, fullParses: 1, incrementalParses: 1 });
    expect(reusedStats).toEqual({ cacheHits: 2, fullParses: 1, incrementalParses: 1 });
    expect(invalidatedStats).toEqual({ cacheHits: 3, fullParses: 1, incrementalParses: 2 });
    resetReviewSyntaxCacheForTests();
  });
});
