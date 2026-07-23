import { describe, expect, it } from 'vitest';

import type { GitFileDiff, GitStatusCode } from '@shared/types';

import { extractGraphqlReviewFacts } from './reviewGraphqlRelationships';
import { buildReviewPlan, type ReviewPatchInput } from './reviewPlan';
import { analyzeReviewPatchSyntax } from './reviewSyntax';

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

  it('keeps a shared dependency story together when consumer files are entirely new', () => {
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'new-files' }, [
      patch('src/config.ts', '@@ -0,0 +1 @@\n+export const DEFAULT_TIMEOUT = 5000;\n'),
      patch('src/client.ts', '@@ -0,0 +1 @@\n+export const connect = () => open(DEFAULT_TIMEOUT);\n'),
      patch('src/client.test.ts', '@@ -0,0 +1 @@\n+expect(connect(DEFAULT_TIMEOUT)).toBeDefined();\n')
    ]);

    expect(plan.units.find((unit) => unit.symbol === 'DEFAULT_TIMEOUT')?.chunks.map((chunk) => chunk.path)).toEqual([
      'src/config.ts',
      'src/client.ts',
      'src/client.test.ts'
    ]);
  });

  it('merges related contexts into one sidebar story without duplicating hunks', () => {
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'story' }, [
      patch(
        'src/customer/profile-model.ts',
        '@@ -1 +1 @@\n-export class LegacyUserProfileInput {}\n+export class CustomerUserProfileInput {}\n@@ -10 +10 @@\n-export const OldClientLimitConfig = 1;\n+export const NewClientLimitConfig = 2;\n'
      ),
      patch(
        'src/customer/profile-use.ts',
        '@@ -1 +1 @@\n-consume(LegacyUserProfileInput);\n+consume(CustomerUserProfileInput);\n@@ -10 +10 @@\n-apply(OldClientLimitConfig);\n+apply(NewClientLimitConfig);\n'
      )
    ]);
    const chunkIds = plan.units.flatMap((unit) => unit.chunks.map((chunk) => chunk.id));

    expect(plan.units).toHaveLength(1);
    expect(plan.units[0]?.reason).toContain('2 contexts');
    expect(new Set(plan.units[0]?.chunks.map((chunk) => chunk.reviewContext))).toEqual(new Set([
      'LegacyUserProfileInput → CustomerUserProfileInput',
      'OldClientLimitConfig → NewClientLimitConfig'
    ]));
    expect(chunkIds).toHaveLength(4);
    expect(new Set(chunkIds)).toHaveLength(4);
  });

  it('uses one file fallback story for unrelated hunks that have no semantic anchor', () => {
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'fallback' }, [
      patch(
        'src/tasks.ts',
        '@@ -1 +1 @@ function start() {\n-runOld();\n+runNew();\n@@ -20 +20 @@ function stop() {\n-closeOld();\n+closeNew();\n'
      )
    ]);

    expect(plan.units).toHaveLength(1);
    expect(plan.units[0]?.chunks).toHaveLength(2);
    expect(new Set(plan.units[0]?.chunks.map((chunk) => chunk.reviewContext))).toEqual(new Set([
      'function start() {',
      'function stop() {'
    ]));
  });

  it('keeps identical hunks as distinct changes with one canonical owner each', () => {
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'duplicates' }, [
      patch(
        'src/duplicate.ts',
        '@@ -1 +1 @@\n-oldCall();\n+newCall();\n@@ -20 +20 @@\n-oldCall();\n+newCall();\n'
      )
    ]);
    const chunks = plan.units.flatMap((unit) => unit.chunks);

    expect(chunks).toHaveLength(2);
    expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(2);
    expect(plan.units).toHaveLength(1);
  });

  it('assigns every mixed review hunk to exactly one sidebar story', () => {
    const inputs = [
      patch(
        'src/config.ts',
        '@@ -1 +1 @@\n-export const DEFAULT_TIMEOUT = 1000;\n+export const DEFAULT_TIMEOUT = 2000;\n@@ -20 +20 @@\n-oldCall();\n+newCall();\n'
      ),
      patch('src/consumer.ts', '@@ -1 +1 @@\n+connect(DEFAULT_TIMEOUT);\n'),
      patch(
        'src/duplicates.ts',
        '@@ -1 +1 @@\n-oldCall();\n+newCall();\n@@ -20 +20 @@\n-oldCall();\n+newCall();\n'
      ),
      patch('locales/en/translation.json', '@@ -1 +1 @@\n-{"save":"Save"}\n+{"save":"Save changes"}\n'),
      omittedPatch('assets/logo.png', 'binary')
    ];
    const expectedChunks = inputs.reduce((count, input) =>
      count + (input.diff.omittedReason ? 1 : input.diff.patch.match(/^@@/gm)?.length ?? 0), 0);
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'canonical-ownership' }, inputs);
    const chunks = plan.units.flatMap((unit) => unit.chunks);
    const ownershipCounts = new Map<string, number>();

    for (const unit of plan.units) {
      for (const chunk of unit.chunks) {
        ownershipCounts.set(chunk.id, (ownershipCounts.get(chunk.id) ?? 0) + 1);
      }
    }

    expect(chunks).toHaveLength(expectedChunks);
    expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(expectedChunks);
    expect([...ownershipCounts.values()]).toEqual(Array(expectedChunks).fill(1));
    expect(plan.units.find((unit) => unit.title === 'Translations')?.chunks).toHaveLength(1);
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

  it('fingerprints the exact review source independently from load time', () => {
    const input = patch(
      'src/client.ts',
      '@@ -10,2 +10,2 @@ function connect() {\n-  return open();\n+  return open(timeout);\n }\n'
    );
    const original = buildReviewPlan('/repo', { kind: 'wip', scope: 'unstaged' }, [input]);
    const identical = buildReviewPlan('/repo', { kind: 'wip', scope: 'unstaged' }, [input]);
    const changed = buildReviewPlan('/repo', { kind: 'wip', scope: 'unstaged' }, [
      patch(
        'src/client.ts',
        '@@ -10,2 +10,2 @@ function connect() {\n-  return open();\n+  return open(timeout, retries);\n }\n'
      )
    ]);

    expect(original.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(identical.sourceFingerprint).toBe(original.sourceFingerprint);
    expect(changed.sourceFingerprint).not.toBe(original.sourceFingerprint);
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

  it('extracts GraphQL scalar and union declarations as structured symbols', () => {
    expect(extractGraphqlReviewFacts(['+scalar DateTime']).symbols).toEqual(['dateTime']);
    expect(extractGraphqlReviewFacts(['+union SearchResult = Product | Category']).symbols).toEqual(['searchResult']);
  });

  it('uses unchanged GraphQL lines only as owner context, not as changed symbols', () => {
    expect(extractGraphqlReviewFacts([
      ' type ProductCategoryInput {',
      '+  seo: ProductCategorySeoInput',
      '   subheadline: LocalizedStringInput',
      ' }'
    ])).toEqual({
      symbols: ['productCategoryInput', 'seo'],
      qualifiedSymbols: ['productCategoryInput.seo']
    });
  });

  it('qualifies a GraphQL field using full-file context outside the hunk', () => {
    const schemaPatch = patch(
      'schema/storefront.graphql',
      '@@ -8 +8 @@\n-  seo: LegacyStorefrontBranchSeo!\n+  seo: StorefrontBranchSeo!\n'
    );
    schemaPatch.fileContext = {
      oldContents: 'type StorefrontBranch {\n  id: ID!\n  name: String!\n  code: String!\n  active: Boolean!\n  slug: String!\n  url: String!\n  seo: LegacyStorefrontBranchSeo!\n}\n',
      newContents: 'type StorefrontBranch {\n  id: ID!\n  name: String!\n  code: String!\n  active: Boolean!\n  slug: String!\n  url: String!\n  seo: StorefrontBranchSeo!\n}\n'
    };
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'owner-context' }, [
      schemaPatch,
      patch(
        'src/storefront-branch-seo.ts',
        '@@ -1,3 +1,3 @@\n export class StorefrontBranchSeo {\n-  title!: string;\n+  title!: LocalizedText;\n }\n'
      )
    ]);
    const unit = plan.units.find((candidate) => candidate.symbol === 'StorefrontBranchSeo');

    expect(new Set(unit?.chunks.map((chunk) => chunk.path))).toEqual(new Set([
      'schema/storefront.graphql',
      'src/storefront-branch-seo.ts'
    ]));
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

  it('uses the full syntax tree when the unchanged enclosing class is absent from the hunk', async () => {
    const definition = patch(
      'src/product-category-seo.input.ts',
      '@@ -3,2 +3,2 @@\n-  @Field()\n-  title!: string;\n+  @Field(() => LocalizedStringInput)\n+  title!: LocalizedStringInput;\n'
    );
    definition.fileContext = {
      oldContents: [
        '@InputType()',
        'export class ProductCategorySeoInput {',
        '  @Field()',
        '  title!: string;',
        '}'
      ].join('\n'),
      newContents: [
        '@InputType()',
        'export class ProductCategorySeoInput {',
        '  @Field(() => LocalizedStringInput)',
        '  title!: LocalizedStringInput;',
        '}'
      ].join('\n')
    };
    definition.syntax = await analyzeReviewPatchSyntax(
      definition.path,
      definition.diff.patch,
      definition.fileContext,
      'unchanged-enclosing-class'
    );

    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'syntax-owner' }, [
      definition,
      patch(
        'src/product-category-create.input.ts',
        '@@ -5 +5 @@ export class ProductCategoryCreateInput {\n-  seo?: ProductCategorySeoTemplatesInput;\n+  seo?: ProductCategorySeoInput;\n'
      )
    ]);
    const unit = plan.units.find((candidate) => candidate.symbol === 'ProductCategorySeoInput');
    const definitionChunk = unit?.chunks.find((chunk) => chunk.path === definition.path);

    expect(definition.syntax?.hunks[0]?.newOwners).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'class',
        name: 'ProductCategorySeoInput',
        qualifiedName: 'ProductCategorySeoInput',
        startLine: 2,
        endLine: 5
      })
    ]));
    expect(definitionChunk).toMatchObject({
      role: 'anchor',
      reviewContext: 'ProductCategorySeoInput'
    });
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

  it('builds one rename story across GraphQL, TypeScript, Python, and Rust', () => {
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'generic' }, [
      patch(
        'schema/customer.graphql',
        '@@ -1,3 +1,3 @@\n-input LegacyCustomerProfile {\n+input CustomerProfile {\n   name: String!\n }\n'
      ),
      patch(
        'src/customer-profile.ts',
        '@@ -1,4 +1,4 @@\n export class CustomerProfile {\n-  name!: string;\n+  name!: LocalizedText;\n }\n'
      ),
      patch(
        'services/customer.py',
        '@@ -1 +1 @@\n-def load(profile: LegacyCustomerProfile):\n+def load(profile: CustomerProfile):\n'
      ),
      patch(
        'crates/customer/src/lib.rs',
        '@@ -1 +1 @@\n-pub fn save(profile: LegacyCustomerProfile) {}\n+pub fn save(profile: CustomerProfile) {}\n'
      )
    ]);
    const unit = plan.units.find((candidate) => candidate.symbol === 'CustomerProfile');

    expect(unit?.title).toBe('LegacyCustomerProfile → CustomerProfile');
    expect(unit?.confidence).toBe('exact');
    expect(unit?.chunks.map((chunk) => chunk.path)).toEqual([
      'src/customer-profile.ts',
      'schema/customer.graphql',
      'crates/customer/src/lib.rs',
      'services/customer.py'
    ]);
    expect(plan.units).toHaveLength(1);
  });

  it('does not infer an exact rename from prose-only replacements', () => {
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'docs-only' }, [
      patch(
        'README.md',
        '@@ -1 +1 @@\n-Use ProductCategorySeoTemplatesInput in requests.\n+Use ProductCategorySeoInput in requests.\n'
      ),
      patch(
        'docs/api.md',
        '@@ -1 +1 @@\n-ProductCategorySeoTemplatesInput is deprecated.\n+ProductCategorySeoInput is preferred.\n'
      )
    ]);

    expect(plan.units.some((unit) => unit.confidence === 'exact')).toBe(false);
    expect(plan.units).toHaveLength(2);
  });

  it('keeps sibling-scope declarations from becoming one relationship anchor', () => {
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'scoped' }, [
      patch(
        'src/tasks.ts',
        '@@ -1,2 +1,3 @@ function startTask() {\n+  const taskCacheKey = buildStartKey();\n }\n@@ -10,2 +11,3 @@ function stopTask() {\n+  const taskCacheKey = buildStopKey();\n }\n'
      ),
      patch('src/consumer.ts', '@@ -1 +1 @@\n+consume(taskCacheKey);\n')
    ]);

    expect(plan.units.some((unit) => unit.symbol === 'taskCacheKey')).toBe(false);
  });

  it('does not collapse distinct normalized identifiers in the same scope', () => {
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'normalized-collision' }, [
      patch(
        'src/cache.ts',
        '@@ -1,2 +1,3 @@ function buildCache() {\n+  const cacheKey = buildPrimaryKey();\n }\n@@ -10,2 +11,3 @@ function buildCache() {\n+  const cache_key = buildFallbackKey();\n }\n'
      ),
      patch('src/consumer.ts', '@@ -1 +1,2 @@\n+consume(cacheKey);\n+consume(cache_key);\n')
    ]);

    expect(plan.units.some((unit) => unit.symbol === 'cacheKey' || unit.symbol === 'cache_key')).toBe(false);
  });

  it('does not arbitrarily assign a multi-concept hunk to one relationship', () => {
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'multi-concept' }, [
      patch(
        'src/config.ts',
        '@@ -1 +1,2 @@\n+export const DEFAULT_TIMEOUT = 5000;\n+export const MAX_RETRIES = 3;\n'
      ),
      patch('src/client.ts', '@@ -1 +1 @@\n+connect(DEFAULT_TIMEOUT);\n'),
      patch('src/worker.ts', '@@ -1 +1 @@\n+retry(MAX_RETRIES);\n')
    ]);
    const definitionPathInRelationship = plan.units
      .filter((unit) => unit.symbol === 'DEFAULT_TIMEOUT' || unit.symbol === 'MAX_RETRIES')
      .some((unit) => unit.chunks.some((chunk) => chunk.path === 'src/config.ts'));

    expect(definitionPathInRelationship).toBe(false);
  });

  it('keeps plain usages of an accepted rename in the rename story', () => {
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'rename-usages' }, [
      patch(
        'src/profile.ts',
        '@@ -1 +1 @@\n-export class LegacyCustomerProfile {}\n+export class CustomerProfile {}\n'
      ),
      patch('src/new-consumer.ts', '@@ -1 +1 @@\n+consume(CustomerProfile);\n'),
      patch('src/old-consumer.ts', '@@ -1 +1 @@\n-remove(LegacyCustomerProfile);\n')
    ]);
    const unit = plan.units.find((candidate) => candidate.title === 'LegacyCustomerProfile → CustomerProfile');

    expect(unit?.chunks.map((chunk) => chunk.path)).toEqual([
      'src/profile.ts',
      'src/new-consumer.ts',
      'src/old-consumer.ts'
    ]);
  });

  it('qualifies repeated GraphQL fields by their owning type', () => {
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'qualified' }, [
      patch(
        'schema/storefront.graphql',
        '@@ -1,3 +1,4 @@\n type StorefrontBranch {\n+  seo: StorefrontBranchSeo!\n }\n@@ -20,3 +21,4 @@\n type StorefrontProduct {\n+  seo: StorefrontProductSeo!\n }\n'
      ),
      patch(
        'src/storefront-branch-seo.ts',
        '@@ -1,4 +1,4 @@\n export class StorefrontBranchSeo {\n-  title!: string;\n+  title!: LocalizedText;\n }\n'
      ),
      patch(
        'src/storefront-product-seo.ts',
        '@@ -1,4 +1,4 @@\n export class StorefrontProductSeo {\n-  title!: string;\n+  title!: LocalizedText;\n }\n'
      )
    ]);

    expect(plan.units.some((unit) => unit.symbol === 'seo')).toBe(false);
    expect(new Set(plan.units.find((unit) => unit.symbol === 'StorefrontBranchSeo')?.chunks.map((chunk) => chunk.path))).toEqual(new Set([
      'src/storefront-branch-seo.ts',
      'schema/storefront.graphql'
    ]));
    expect(new Set(plan.units.find((unit) => unit.symbol === 'StorefrontProductSeo')?.chunks.map((chunk) => chunk.path))).toEqual(new Set([
      'src/storefront-product-seo.ts',
      'schema/storefront.graphql'
    ]));
  });

  it('does not let a frequent generic identifier become a review hub', () => {
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'generic-hub' }, [
      patch('src/state.ts', '@@ -1 +1 @@\n+export const state = createState();\n'),
      ...['admin', 'api', 'storefront', 'worker', 'cli'].map((name) =>
        patch(`packages/${name}/index.ts`, '@@ -1 +1 @@\n+consume(state);\n')
      )
    ]);

    expect(plan.units.some((unit) => unit.symbol === 'state')).toBe(false);
    expect(plan.units).toHaveLength(6);
  });

  it('ignores relationship names that occur only in comments and strings', async () => {
    const definition = await syntaxPatch(
      'src/config/shared.ts',
      'export const SharedConfig = { value: 1 };',
      'export const SharedConfig = { value: 2 };',
      '@@ -1 +1 @@\n-export const SharedConfig = { value: 1 };\n+export const SharedConfig = { value: 2 };\n'
    );
    const consumer = await syntaxPatch(
      'src/consumer.ts',
      'consume();',
      'consume(SharedConfig);',
      '@@ -1 +1 @@\n-consume();\n+consume(SharedConfig);\n'
    );
    const comment = await syntaxPatch(
      'docs/review-note.ts',
      '// unrelated note\nexport const note = "unrelated";',
      '// SharedConfig should not link this file\nexport const note = "SharedConfig";',
      '@@ -1,2 +1,2 @@\n-// unrelated note\n-export const note = "unrelated";\n+// SharedConfig should not link this file\n+export const note = "SharedConfig";\n'
    );
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'syntax-non-code' }, [
      definition,
      consumer,
      comment
    ]);
    const relationship = plan.units.find((unit) => unit.symbol === 'SharedConfig');

    expect(relationship?.chunks.map((chunk) => chunk.path)).toEqual([
      'src/config/shared.ts',
      'src/consumer.ts'
    ]);
    expect(relationship?.chunks.some((chunk) => chunk.path === comment.path)).toBe(false);
    expect(plan.units.flatMap((unit) => unit.chunks)).toHaveLength(3);
  });

  it('uses syntax roles for definition, call usage, API, and generated sections', async () => {
    const definition = await syntaxPatch(
      'src/load-product.ts',
      'export function loadProduct() { return null; }',
      'export function loadProduct() { return product; }',
      '@@ -1 +1 @@\n-export function loadProduct() { return null; }\n+export function loadProduct() { return product; }\n'
    );
    const consumer = await syntaxPatch(
      'src/consumer.ts',
      'run();',
      'loadProduct();',
      '@@ -1 +1 @@\n-run();\n+loadProduct();\n'
    );
    const schema = await syntaxPatch(
      'schema/product.graphql',
      'type Query { product: String }',
      'type Query { product: Product }',
      '@@ -1 +1 @@\n-type Query { product: String }\n+type Query { product: Product }\n'
    );
    const generated = await syntaxPatch(
      'src/gql/sdk.ts',
      'export type Product = { id: string };',
      'export type Product = { id: string; name: string };',
      '@@ -1 +1 @@\n-export type Product = { id: string };\n+export type Product = { id: string; name: string };\n'
    );
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'syntax-roles' }, [
      definition,
      consumer,
      schema,
      generated
    ]);
    const chunks = plan.units.flatMap((unit) => unit.chunks);

    expect(chunks.find((chunk) => chunk.path === definition.path)).toMatchObject({
      role: 'anchor',
      relationship: 'Defines loadProduct',
      reviewSection: 'definition'
    });
    expect(chunks.find((chunk) => chunk.path === consumer.path)).toMatchObject({
      role: 'usage',
      relationship: 'Calls loadProduct',
      reviewSection: 'implementation'
    });
    expect(chunks.find((chunk) => chunk.path === schema.path)?.reviewSection).toBe('api');
    expect(chunks.find((chunk) => chunk.path === generated.path)?.reviewSection).toBe('generated');
  });

  it('keeps a directly related test usage in a parser-backed relationship story', async () => {
    const definition = await syntaxPatch(
      'src/config.ts',
      '',
      'export const DEFAULT_TIMEOUT = 5000;\n',
      '@@ -0,0 +1 @@\n+export const DEFAULT_TIMEOUT = 5000;\n'
    );
    const usage = await syntaxPatch(
      'src/client.ts',
      '',
      'export const connect = () => open(DEFAULT_TIMEOUT);\n',
      '@@ -0,0 +1 @@\n+export const connect = () => open(DEFAULT_TIMEOUT);\n'
    );
    const testUsage = await syntaxPatch(
      'src/client.test.ts',
      '',
      'expect(connect(DEFAULT_TIMEOUT)).toBeDefined();\n',
      '@@ -0,0 +1 @@\n+expect(connect(DEFAULT_TIMEOUT)).toBeDefined();\n'
    );
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'parser-backed-test' }, [
      definition,
      usage,
      testUsage
    ]);

    expect(testUsage.syntax?.hunks[0]?.newIdentifiers).toContainEqual(expect.objectContaining({
      name: 'DEFAULT_TIMEOUT',
      role: 'reference'
    }));
    expect(plan.units.find((unit) => unit.symbol === 'DEFAULT_TIMEOUT')?.chunks.map((chunk) => chunk.path)).toEqual([
      'src/config.ts',
      'src/client.ts',
      'src/client.test.ts'
    ]);
    expect(plan.units).toHaveLength(1);
  });

  it('falls back to generic relationship facts when incomplete WIP syntax has errors', async () => {
    const definition = await syntaxPatch(
      'src/draft.input.ts',
      'export class DraftInput {\n  title!: string;\n}',
      'export class DraftInput {\n  title!: LocalizedStringInput;',
      '@@ -1,3 +1,2 @@\n export class DraftInput {\n-  title!: string;\n-}\n+  title!: LocalizedStringInput;\n'
    );
    const plan = buildReviewPlan('/repo', { kind: 'wip', scope: 'unstaged' }, [
      definition,
      patch('src/use-draft.ts', '@@ -1 +1 @@\n+consume(DraftInput);\n')
    ]);
    const unit = plan.units.find((candidate) => candidate.symbol === 'DraftInput');

    expect(definition.syntax?.hasErrors).toBe(true);
    expect(unit?.chunks.map((chunk) => chunk.path)).toEqual([
      'src/draft.input.ts',
      'src/use-draft.ts'
    ]);
  });

  it('preserves generic grouping behavior for unsupported languages', () => {
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'unsupported-fallback' }, [
      patch('services/config.py', '@@ -1 +1,2 @@\n+class SharedConfig:\n+    enabled = True\n'),
      patch('services/consumer.py', '@@ -1 +1 @@\n+consume(SharedConfig)\n')
    ]);

    expect(plan.units.find((unit) => unit.symbol === 'SharedConfig')?.chunks.map((chunk) => chunk.path)).toEqual([
      'services/config.py',
      'services/consumer.py'
    ]);
  });

  it('does not let generated declarations seed a relationship group', () => {
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'generated' }, [
      patch('apps/admin/src/gql/sdk.ts', '@@ -1 +1 @@\n+export type SharedPayload = { id: string };\n'),
      patch('apps/web/src/graphql/sdk.ts', '@@ -1 +1 @@\n+export type SharedPayload = { id: string };\n'),
      patch('src/consumer.ts', '@@ -1 +1 @@\n+consume(payload as SharedPayload);\n')
    ]);

    expect(plan.units.some((unit) => unit.symbol === 'SharedPayload')).toBe(false);
    expect(plan.units).toHaveLength(3);
  });

  it('does not let a generated GraphQL schema seed a relationship group', async () => {
    const generatedSchema = await syntaxPatch(
      'src/gql/schema.generated.graphql',
      '',
      'input SharedPayload { id: ID! }\n',
      '@@ -0,0 +1 @@\n+input SharedPayload { id: ID! }\n'
    );
    const consumer = await syntaxPatch(
      'src/consumer.ts',
      '',
      'consume(payload as SharedPayload);\n',
      '@@ -0,0 +1 @@\n+consume(payload as SharedPayload);\n'
    );
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'generated-graphql' }, [
      generatedSchema,
      consumer
    ]);

    expect(plan.units.some((unit) => unit.symbol === 'SharedPayload')).toBe(false);
    expect(plan.units).toHaveLength(2);
  });

  it('keeps generated GraphQL in a source-owned story as usage', async () => {
    const definition = await syntaxPatch(
      'src/shared-payload.ts',
      '',
      'export class SharedPayload {}\n',
      '@@ -0,0 +1 @@\n+export class SharedPayload {}\n'
    );
    const generatedSchema = await syntaxPatch(
      'src/gql/schema.generated.graphql',
      '',
      'input SharedPayload { id: ID! }\n',
      '@@ -0,0 +1 @@\n+input SharedPayload { id: ID! }\n'
    );
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'generated-graphql-usage' }, [
      definition,
      generatedSchema
    ]);
    const unit = plan.units.find((candidate) => candidate.symbol === 'SharedPayload');

    expect(unit?.chunks.map((chunk) => chunk.path)).toEqual([
      'src/shared-payload.ts',
      'src/gql/schema.generated.graphql'
    ]);
    expect(unit?.chunks.find((chunk) => chunk.path === generatedSchema.path)).toMatchObject({
      role: 'usage',
      relationship: 'Generated from SharedPayload'
    });
  });

  it('does not let a generated artifact bridge unrelated source stories', () => {
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'generated-bridge' }, [
      patch('src/alpha/alpha-model.ts', '@@ -1 +1 @@\n+export const AlphaSchema = createAlpha();\n'),
      patch('src/beta/beta-model.ts', '@@ -1 +1 @@\n+export const BetaSchema = createBeta();\n'),
      patch(
        'src/gql/sdk.ts',
        '@@ -1 +1 @@\n+export type GeneratedPayload = AlphaSchema & BetaSchema;\n'
      )
    ]);
    const alphaStory = plan.units.find((unit) =>
      unit.chunks.some((chunk) => chunk.path === 'src/alpha/alpha-model.ts')
    );
    const betaStory = plan.units.find((unit) =>
      unit.chunks.some((chunk) => chunk.path === 'src/beta/beta-model.ts')
    );

    expect(alphaStory?.id).not.toBe(betaStory?.id);
    expect(alphaStory?.chunks.some((chunk) => chunk.path === 'src/beta/beta-model.ts')).toBe(false);
    expect(betaStory?.chunks.some((chunk) => chunk.path === 'src/alpha/alpha-model.ts')).toBe(false);
  });

  it('keeps a relationship unit id stable when new usages are added', () => {
    const basePatches = [
      patch('src/config.ts', '@@ -1 +1 @@\n+export const DEFAULT_TIMEOUT = 5000;\n'),
      patch('src/client.ts', '@@ -1 +1 @@\n+connect(DEFAULT_TIMEOUT);\n')
    ];
    const original = buildReviewPlan('/repo', { kind: 'wip', scope: 'unstaged' }, basePatches);
    const expanded = buildReviewPlan('/repo', { kind: 'wip', scope: 'unstaged' }, [
      ...basePatches,
      patch('src/worker.ts', '@@ -1 +1 @@\n+start(DEFAULT_TIMEOUT);\n')
    ]);

    expect(expanded.units.find((unit) => unit.symbol === 'DEFAULT_TIMEOUT')?.id).toBe(
      original.units.find((unit) => unit.symbol === 'DEFAULT_TIMEOUT')?.id
    );
  });

  it('groups equivalent parser-backed field transformations within the same feature context', async () => {
    const typeScriptChange = await syntaxPatch(
      'src/customer/customer-input.ts',
      [
        'export class CustomerInput {',
        '  title!: string;',
        '}'
      ].join('\n'),
      [
        'export class CustomerInput {',
        '  title!: LocalizedStringInput;',
        '}'
      ].join('\n'),
      '@@ -2 +2 @@\n-  title!: string;\n+  title!: LocalizedStringInput;\n'
    );
    const graphqlChange = await syntaxPatch(
      'schema/customer/customer-payload.graphql',
      [
        'input CustomerPayload {',
        '  headline: String!',
        '}'
      ].join('\n'),
      [
        'input CustomerPayload {',
        '  headline: LocalizedStringInput!',
        '}'
      ].join('\n'),
      '@@ -2 +2 @@\n-  headline: String!\n+  headline: LocalizedStringInput!\n'
    );
    const unrelatedChange = await syntaxPatch(
      'src/order/order-input.ts',
      [
        'export class OrderInput {',
        '  label!: string;',
        '}'
      ].join('\n'),
      [
        'export class OrderInput {',
        '  label!: LocalizedStringInput;',
        '}'
      ].join('\n'),
      '@@ -2 +2 @@\n-  label!: string;\n+  label!: LocalizedStringInput;\n'
    );

    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'structural' }, [
      typeScriptChange,
      graphqlChange,
      unrelatedChange
    ]);
    const customerStory = plan.units.find((unit) =>
      unit.chunks.some((chunk) => chunk.path === typeScriptChange.path)
    );

    expect(typeScriptChange.syntax?.hunks[0]?.structuralFingerprints).toEqual([
      'member-type:scalar:string->named:localized:string:input'
    ]);
    expect(graphqlChange.syntax?.hunks[0]?.structuralFingerprints).toEqual(
      typeScriptChange.syntax?.hunks[0]?.structuralFingerprints
    );
    expect(customerStory?.chunks.map((chunk) => chunk.path)).toEqual([
      'src/customer/customer-input.ts',
      'schema/customer/customer-payload.graphql'
    ]);
    expect(plan.units.flatMap((unit) => unit.chunks)).toHaveLength(3);
    expect(plan.units).toHaveLength(2);
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
    const unit = plan.units.find((candidate) => candidate.symbol === 'ProductCategorySeoInput');
    const definitionChunk = unit?.chunks.find((chunk) => chunk.path === 'src/product-category-seo.input.ts');

    expect(unit?.title).toBe('ProductCategorySeoTemplatesInput → ProductCategorySeoInput');
    expect(unit?.confidence).toBe('exact');
    expect(definitionChunk?.role).toBe('anchor');
    expect(new Set(unit?.chunks.map((chunk) => chunk.path))).toEqual(new Set([
      'apps/admin/src/gql/sdk.ts',
      'apps/branch-control-panel/src/gql/sdk.ts',
      'apps/franchise/src/gql/sdk.ts',
      'apps/kiosk/src/gql/sdk.ts',
      'packages/graphql/schema.graphql',
      'src/product-category-create.input.ts',
      'src/product-category-seo.input.ts',
      'src/product-category-update.input.ts',
      'src/new-one.ts',
      'src/new-two.ts',
      'src/new-three.ts',
      'src/new-four.ts',
      'src/new-five.ts'
    ]));
    expect(plan.units.flatMap((candidate) => candidate.chunks)).toHaveLength(17);
    expect(unit?.chunks).toHaveLength(17);
  });

  it('groups repeated replacements when the new type extends the original symbol name', () => {
    const replacementPaths = [
      'src/schema/addition-group.ts',
      'src/schema/combo-group.ts',
      'src/schema/image.ts',
      'src/schema/ingredient-category.ts',
      'src/schema/ingredient.ts',
      'src/schema/payment-types.ts',
      'src/schema/product.ts'
    ];
    const plan = buildReviewPlan('/repo', { kind: 'commit', sha: 'type-extension' }, [
      patch(
        'src/localized-string.model.ts',
        '@@ -1,3 +1,3 @@\n export class LocalizedString {\n-  cs?: string;\n+  readonly cs?: string;\n }\n'
      ),
      patch(
        'src/locale.ts',
        '@@ -0,0 +1,3 @@\n+export type LocalizedStringValue = Partial<Record<string, string>>;\n'
      ),
      ...replacementPaths.map((path, index) => patch(
        path,
        `@@ -1,2 +1,2 @@\n-import { LocalizedString } from './localized-string.model';\n+import type { LocalizedStringValue } from './locale';\n-export const value${index}: LocalizedString = {};\n+export const value${index}: LocalizedStringValue = {};\n`
      ))
    ]);
    const unit = plan.units.find((candidate) =>
      candidate.title === 'LocalizedString → LocalizedStringValue'
    );

    expect(unit?.confidence).toBe('exact');
    expect(unit?.chunks).toHaveLength(9);
    expect(new Set(unit?.chunks.map((chunk) => chunk.path))).toEqual(new Set([
      'src/localized-string.model.ts',
      'src/locale.ts',
      ...replacementPaths
    ]));
    expect(plan.units).toHaveLength(1);
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

async function syntaxPatch(
  path: string,
  oldContents: string,
  newContents: string,
  hunk: string
): Promise<ReviewPatchInput> {
  const input = patch(path, hunk);
  input.fileContext = { oldContents, newContents };
  input.syntax = await analyzeReviewPatchSyntax(
    path,
    input.diff.patch,
    input.fileContext,
    `review-plan:${path}`
  );
  return input;
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
