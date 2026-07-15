import { describe, expect, it } from 'vitest';

import type { GitFileDiff, GitStatusCode } from '@shared/types';

import { buildReviewPlan, type ReviewPatchInput } from './reviewPlan';

describe('context review plans', () => {
  it('links every file hunk to one shared full-file context', () => {
    const input = patch(
      'src/config.ts',
      '@@ -1 +1 @@\n-export const timeout = 1000;\n+export const timeout = 2000;\n@@ -10 +10 @@\n-export const retries = 2;\n+export const retries = 3;\n'
    );
    input.fileContext = {
      oldContents: 'export const timeout = 1000;\n',
      newContents: 'export const timeout = 2000;\n'
    };

    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'abc123' }, [input]);
    const chunks = plan.units.flatMap((unit) => unit.chunks);

    expect(plan.fileContexts).toHaveLength(1);
    expect(plan.fileContexts[0]).toMatchObject({
      path: 'src/config.ts',
      source: 'commit',
      oldContents: 'export const timeout = 1000;\n',
      newContents: 'export const timeout = 2000;\n'
    });
    expect(new Set(chunks.map((chunk) => chunk.fileContextId))).toEqual(new Set([plan.fileContexts[0]?.id]));
  });

  it('orders a declaration before production and test usages across files', () => {
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'abc123' }, [
      patch(
        'src/config.ts',
        '@@ -1,2 +1,3 @@\n export const name = "git-gud";\n+export const DEFAULT_TIMEOUT = 5000;\n export const enabled = true;\n'
      ),
      patch(
        'src/client.ts',
        '@@ -10,3 +10,3 @@ export async function connect() {\n-  return open();\n+  return open(DEFAULT_TIMEOUT);\n }\n'
      ),
      patch(
        'src/client.test.ts',
        '@@ -20,2 +20,3 @@ describe("connect", () => {\n+  expect(connect(DEFAULT_TIMEOUT)).toBeDefined();\n });\n'
      )
    ]);

    const unit = plan.units.find((candidate) => candidate.symbol === 'DEFAULT_TIMEOUT');

    expect(unit?.title).toBe('DEFAULT_TIMEOUT');
    expect(unit?.chunks.map((chunk) => [chunk.role, chunk.category, chunk.path])).toEqual([
      ['anchor', 'source', 'src/config.ts'],
      ['usage', 'source', 'src/client.ts'],
      ['usage', 'test', 'src/client.test.ts']
    ]);
    expect(plan.units.flatMap((candidate) => candidate.chunks)).toHaveLength(3);
  });

  it('does not cross-group an identifier with multiple declarations', () => {
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'abc123' }, [
      patch('src/one.ts', '@@ -1 +1 @@\n+const timeout = 10;\n'),
      patch('src/two.ts', '@@ -1 +1 @@\n+const timeout = 20;\n'),
      patch('src/use.ts', '@@ -1 +1 @@\n+run(timeout);\n')
    ]);

    expect(plan.units.some((unit) => unit.symbol === 'timeout')).toBe(false);
    expect(plan.units.flatMap((unit) => unit.chunks).map((chunk) => chunk.path).sort()).toEqual([
      'src/one.ts',
      'src/two.ts',
      'src/use.ts'
    ]);
  });

  it('classifies tests, specs, deleted files, deletion-only hunks, and mixed hunks', () => {
    const plan = buildReviewPlan('/repo', { kind: 'wip', scope: 'all' }, [
      patch('tests/client.ts', '@@ -1 +1 @@\n+expect(client).toBeDefined();\n'),
      patch('spec/client_spec.rb', '@@ -1 +1 @@\n+expect(client).to be_present\n'),
      patch('src/deleted.ts', '@@ -1 +0,0 @@\n-export const removed = true;\n', 'deleted'),
      patch('src/cleanup.ts', '@@ -1,2 +1 @@\n-const oldValue = 1;\n return nextValue;\n'),
      patch('src/mixed.ts', '@@ -1 +1 @@\n-const value = 1;\n+const value = 2;\n')
    ]);
    const chunks = plan.units.flatMap((unit) => unit.chunks);

    expect(chunks.find((chunk) => chunk.path === 'tests/client.ts')?.category).toBe('test');
    expect(chunks.find((chunk) => chunk.path === 'spec/client_spec.rb')?.category).toBe('spec');
    expect(chunks.find((chunk) => chunk.path === 'src/deleted.ts')?.changeType).toBe('deleted');
    expect(chunks.find((chunk) => chunk.path === 'src/cleanup.ts')?.changeType).toBe('deleted');
    expect(chunks.find((chunk) => chunk.path === 'src/mixed.ts')?.changeType).toBe('modified');
  });

  it('classifies import-only hunks while keeping mixed and dynamic imports visible', () => {
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'abc123' }, [
      patch(
        'src/imports.ts',
        "@@ -1,5 +1,5 @@\n import {\n-  oldName,\n+  newName,\n } from './dependency';\n const unchanged = true;\n"
      ),
      patch(
        'src/mixed.ts',
        "@@ -1,5 +1,5 @@\n-import { oldName } from './dependency';\n+import { newName } from './dependency';\n export function run() {\n-  return oldName;\n+  return newName;\n }\n"
      ),
      patch(
        'src/dynamic.ts',
        "@@ -1 +1 @@\n-const loader = import('./old');\n+const loader = import('./new');\n"
      )
    ]);
    const chunks = plan.units.flatMap((unit) => unit.chunks);

    expect(chunks.find((chunk) => chunk.path === 'src/imports.ts')?.contentKind).toBe('imports');
    expect(chunks.find((chunk) => chunk.path === 'src/mixed.ts')?.contentKind).toBe('code');
    expect(chunks.find((chunk) => chunk.path === 'src/dynamic.ts')?.contentKind).toBe('code');
  });

  it('preserves chunk identity when only hunk line numbers move', () => {
    const original = buildReviewPlan('/repo', { kind: 'wip', scope: 'unstaged' }, [
      patch('src/client.ts', '@@ -10,2 +10,2 @@ function connect() {\n-  return open();\n+  return open(timeout);\n }\n')
    ]);
    const shifted = buildReviewPlan('/repo', { kind: 'wip', scope: 'unstaged' }, [
      patch('src/client.ts', '@@ -40,2 +40,2 @@ function connect() {\n-  return open();\n+  return open(timeout);\n }\n')
    ]);

    expect(shifted.units[0]?.chunks[0]?.id).toBe(original.units[0]?.chunks[0]?.id);
  });

  it('keeps binary and oversized changes as reviewable placeholders', () => {
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'abc123' }, [
      omittedPatch('assets/logo.png', 'binary'),
      omittedPatch('src/generated.ts', 'too-large')
    ]);
    const chunks = plan.units.flatMap((unit) => unit.chunks);

    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.omittedReason).sort()).toEqual(['binary', 'too-large']);
  });

  it('groups all translation.json and translations.json changes into one review unit', () => {
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'abc123' }, [
      patch(
        'locales/en/translation.json',
        '@@ -1 +1 @@\n-  "save": "Save"\n+  "save": "Save changes"\n@@ -20 +20 @@\n-  "cancel": "Cancel"\n+  "cancel": "Discard"\n'
      ),
      patch(
        'locales/fr/translations.json',
        '@@ -1 +1 @@\n-  "save": "Enregistrer"\n+  "save": "Enregistrer les modifications"\n'
      ),
      patch(
        'locales/en/translation.schema.json',
        '@@ -1 +1 @@\n-  "version": 1\n+  "version": 2\n'
      )
    ]);
    const translationUnit = plan.units.find((unit) => unit.title === 'Translations');

    expect(translationUnit?.reason).toBe('3 changes across 2 translation files');
    expect(translationUnit?.chunks.map((chunk) => chunk.path)).toEqual([
      'locales/en/translation.json',
      'locales/en/translation.json',
      'locales/fr/translations.json'
    ]);
    expect(plan.units.find((unit) => unit.chunks.some((chunk) => chunk.path.endsWith('translation.schema.json')))?.title)
      .toBe('Changes in translation.schema.json');
  });

  it('groups GraphQL schema and operation changes with a TypeScript resolver property', () => {
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'abc123' }, [
      patch(
        'graphql/schema/review.graphql',
        '@@ -1,3 +1,4 @@\n type Query {\n+  repositoryReview(repoPath: String!): RepositoryReview!\n }\n'
      ),
      patch(
        'graphql/queries/review.gql',
        '@@ -1,2 +1,5 @@\n+query RepositoryReview($repoPath: String!) {\n+  repositoryReview(repoPath: $repoPath) {\n+    summary\n+  }\n+}\n'
      ),
      patch(
        'src/graphql/resolvers.ts',
        '@@ -1,2 +1,3 @@\n+export const repositoryReviewQueryKey = buildRepositoryReviewQueryKey(repoPath);\n export const unrelated = true;\n'
      )
    ]);
    const unit = plan.units.find((candidate) => candidate.symbol === 'repositoryReview');

    expect(unit?.reason).toBe('3 related changes across 3 files');
    expect(unit?.chunks.map((chunk) => [chunk.role, chunk.path])).toEqual([
      ['anchor', 'graphql/queries/review.gql'],
      ['anchor', 'graphql/schema/review.graphql'],
      ['usage', 'src/graphql/resolvers.ts']
    ]);
    expect(plan.units.flatMap((candidate) => candidate.chunks)).toHaveLength(3);
  });

  it('does not use generic GraphQL fields as cross-language relationship anchors', () => {
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'abc123' }, [
      patch('graphql/schema/status.graphql', '@@ -1 +1 @@\n+  status: String!\n'),
      patch('src/status.ts', '@@ -1 +1 @@\n+export const status = formatStatus();\n')
    ]);

    expect(plan.units.find((candidate) => candidate.symbol === 'status')?.chunks.map((chunk) => chunk.path)).toEqual([
      'src/status.ts'
    ]);
    expect(plan.units).toHaveLength(2);
  });

  it('uses an unchanged enclosing class as the anchor for related type usages', () => {
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'abc123' }, [
      patch(
        'src/product-category-seo.input.ts',
        '@@ -1,8 +1,8 @@\n @InputType()\n export class ProductCategorySeoInput {\n-  @Field()\n-  title!: string;\n+  @Field(() => LocalizedStringInput)\n+  title!: LocalizedStringInput;\n }\n'
      ),
      patch(
        'src/product-category-create.input.ts',
        '@@ -5,3 +5,3 @@ export class ProductCategoryCreateInput {\n-  @Field(() => ProductCategorySeoTemplatesInput)\n+  @Field(() => ProductCategorySeoInput)\n }\n'
      ),
      patch(
        'src/product-category-update.input.ts',
        '@@ -5,3 +5,3 @@ export class ProductCategoryUpdateInput {\n-  seo?: ProductCategorySeoTemplatesInput;\n+  seo?: ProductCategorySeoInput;\n }\n'
      )
    ]);
    const unit = plan.units.find((candidate) => candidate.symbol === 'ProductCategorySeoInput');

    expect(unit?.reason).toBe('3 related changes across 3 files');
    expect(unit?.chunks.map((chunk) => [chunk.role, chunk.path])).toEqual([
      ['anchor', 'src/product-category-seo.input.ts'],
      ['usage', 'src/product-category-create.input.ts'],
      ['usage', 'src/product-category-update.input.ts']
    ]);
    expect(plan.units.flatMap((candidate) => candidate.chunks)).toHaveLength(3);
  });

  it('does not promote an unchanged enclosing class without an external usage', () => {
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'abc123' }, [
      patch(
        'src/product-category-seo.input.ts',
        '@@ -1,5 +1,5 @@\n export class ProductCategorySeoInput {\n-  title!: string;\n+  title!: LocalizedStringInput;\n }\n'
      )
    ]);

    expect(plan.units).toHaveLength(1);
    expect(plan.units[0]?.symbol).toBeUndefined();
    expect(plan.units[0]?.title).toBe('Changes in product-category-seo.input.ts');
  });

  it('joins an unchanged replacement type definition to the dominant rename group', () => {
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: '622108b' }, [
      patch(
        'packages/graphql/schema.graphql',
        '@@ -1,15 +1,8 @@\n input ProductCategorySeoInput {\n-  description: String!\n-  descriptionMeta: String!\n-  title: String!\n-  titleMeta: String!\n-}\n-\n-input ProductCategorySeoTemplatesInput {\n-  description: String!\n-  descriptionMeta: String!\n-  title: String!\n-  titleMeta: String!\n+  description: LocalizedStringInput!\n+  descriptionMeta: LocalizedStringInput!\n+  title: LocalizedStringInput!\n+  titleMeta: LocalizedStringInput!\n }\n'
      ),
      generatedReplacementPatch('apps/admin/src/gql/sdk.ts'),
      generatedReplacementPatch('apps/branch-control-panel/src/gql/sdk.ts'),
      generatedReplacementPatch('apps/franchise/src/gql/sdk.ts'),
      generatedReplacementPatch('apps/kiosk/src/gql/sdk.ts'),
      replacementPatch('src/product-category-create.input.ts'),
      replacementPatch('src/product-category-update.input.ts'),
      ...['one', 'two', 'three', 'four', 'five'].map((name) => patch(
        `src/new-${name}.ts`,
        '@@ -1 +1 @@\n+consume(ProductCategorySeoInput);\n'
      )),
      patch(
        'src/product-category-seo.input.ts',
        '@@ -1,8 +1,8 @@\n export class ProductCategorySeoInput {\n-  description!: string;\n-  descriptionMeta!: string;\n+  description!: LocalizedStringInput;\n+  descriptionMeta!: LocalizedStringInput;\n }\n'
      )
    ]);
    const unit = plan.units.find((candidate) => candidate.symbol === 'productCategorySeoTemplatesInput');
    const definitionChunk = unit?.chunks.find((chunk) => chunk.path === 'src/product-category-seo.input.ts');

    expect(definitionChunk?.role).toBe('anchor');
    expect(new Set(unit?.chunks.map((chunk) => chunk.path))).toEqual(new Set([
      'apps/admin/src/gql/sdk.ts',
      'apps/branch-control-panel/src/gql/sdk.ts',
      'apps/franchise/src/gql/sdk.ts',
      'apps/kiosk/src/gql/sdk.ts',
      'packages/graphql/schema.graphql',
      'src/product-category-create.input.ts',
      'src/product-category-seo.input.ts',
      'src/product-category-update.input.ts'
    ]));
    expect(plan.units.find((candidate) => candidate.symbol === 'ProductCategorySeoInput')?.chunks.map((chunk) => chunk.path)).toEqual([
      'src/new-five.ts',
      'src/new-four.ts',
      'src/new-one.ts',
      'src/new-three.ts',
      'src/new-two.ts'
    ]);
  });
});

function generatedReplacementPatch(path: string): ReviewPatchInput {
  return patch(
    path,
    '@@ -1,10 +1,5 @@ export type ProductCategorySeoInput = {\n-  description: string;\n-};\n-\n-export type ProductCategorySeoTemplatesInput = {\n-  description: string;\n+  description: LocalizedStringInput;\n };\n@@ -20,3 +15,3 @@ export type ProductCategoryCreateInput = {\n-  seoTemplates?: ProductCategorySeoTemplatesInput;\n+  seoTemplates?: ProductCategorySeoInput;\n };\n'
  );
}

function replacementPatch(path: string): ReviewPatchInput {
  return patch(
    path,
    '@@ -1,3 +1,3 @@\n-  seoTemplates?: ProductCategorySeoTemplatesInput;\n+  seoTemplates?: ProductCategorySeoInput;\n'
  );
}

function patch(path: string, hunk: string, status: GitStatusCode = 'modified'): ReviewPatchInput {
  return {
    path,
    status,
    source: 'commit',
    diff: diff(path, `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${hunk}`)
  };
}

function omittedPatch(path: string, omittedReason: 'binary' | 'too-large'): ReviewPatchInput {
  return {
    path,
    status: 'modified',
    source: 'commit',
    diff: {
      ...diff(path, ''),
      isBinary: omittedReason === 'binary',
      omittedReason
    }
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
