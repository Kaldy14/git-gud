# Review grouping quality benchmark

This benchmark measures whether changed hunks are partitioned into the review units a person would want. It is a quality benchmark, not a timing microbenchmark. The command fails only when the weighted quality score falls below the configured gate, which starts at 90%.

## Run it

```bash
pnpm benchmark:review
```

Useful focused runs:

```bash
REVIEW_BENCHMARK_FILTER=tree-sitter pnpm benchmark:review
REVIEW_BENCHMARK_FILTER=complex pnpm benchmark:review
REVIEW_BENCHMARK_FILTER=graphql pnpm benchmark:review
REVIEW_BENCHMARK_PIPELINE=local-commit pnpm benchmark:review
REVIEW_BENCHMARK_PIPELINE=core-full-context,github-builder pnpm benchmark:review
REVIEW_BENCHMARK_JSON=1 pnpm benchmark:review
```

`REVIEW_BENCHMARK_FILTER` matches dataset ids, titles, and tags. `REVIEW_BENCHMARK_PIPELINE` accepts a comma-separated list.

## Layout

```text
benchmarks/review-grouping/
  config.ts                         suite gate and dataset registry
  datasets/
    index.ts                        explicit, easy-to-scan dataset list
    definition-and-usages.ts        one independently readable scenario
    ...
  types.ts                          dataset authoring contract
  fixtureRepository.ts              temporary Git repository materialization
  pipelines.ts                      production-path adapters
  scoring.ts                        dataset validation and partition scoring
  runtime.ts                        suite orchestration and aggregation
  report.ts                         human-readable output
  review-grouping.benchmark.ts      command entry point
```

Keep one scenario per dataset file. Use a descriptive id and tags so focused runs remain useful as the suite grows. Benchmark datasets intentionally exclude test and spec files so the score reflects production review behavior.

Expected units describe the best human review experience, independent of how the current grouping algorithm behaves. Prefer realistic cross-layer scenarios, preserve genuinely independent changes as separate units even when they share files, and do not weaken an expectation to match the current score.

## Pipeline meanings

- `core-full-context` constructs `ReviewPatchInput` values with complete old/new file contents, attaches Tree-sitter syntax, and calls the central `buildReviewPlan` grouping algorithm.
- `local-commit` materializes the scenario as real Git commits and calls the production `loadReviewPlan` path. This includes Git diff/context loading, payload limits, Tree-sitter attachment, and grouping.
- `github-builder` calls the production GitHub PR plan builder with the patch and file contents that a successful GitHub fetch would provide. It covers PR-specific input conversion and Tree-sitter attachment. It deliberately does not benchmark authentication, network retrieval, GitHub API failures, or the retained-context byte budget.

The adapters are separate on purpose. A core score can remain good while a production pipeline loses context, omits files, or converts inputs incorrectly.

## Dataset shape

Datasets describe repository state before and after one commit. The fixture runtime asks Git to create the real patches, so dataset authors do not hand-maintain unified diff headers.

Each expected hunk has a stable id and one or more snippets that uniquely identify its resulting patch chunk. Every hunk must appear in exactly one expected unit.

```ts
import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'load-product-definition-and-use',
  title: 'Load product definition and use',
  description: 'The definition and consumer should be one review unit.',
  tags: ['typescript', 'cross-file'],
  files: [
    {
      path: 'src/load-product.ts',
      before: null,
      after: 'export function loadProduct() { return null; }\n',
      hunks: [
        {
          id: 'definition',
          contains: 'export function loadProduct'
        }
      ]
    },
    {
      path: 'src/consumer.ts',
      before: 'run();\n',
      after: 'loadProduct();\n',
      hunks: [
        {
          id: 'usage',
          contains: 'loadProduct();'
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'load-product',
      chunks: ['definition', 'usage']
    }
  ]
});
```

Use `null` for a file that does not exist on one side. Set `previousPath` for renames. A file may declare several hunk markers; their `contains` values must each identify exactly one produced review chunk.

After adding the file, export it from `datasets/index.ts`.

## Score

The benchmark compares every pair of named chunks:

- expected together and produced together;
- expected apart and produced apart;
- wrongly split;
- wrongly merged.

It calculates an F1 score for the “together” relation and another for the “apart” relation. The case score is their mean, so always merging everything and always splitting everything are both penalized. The suite score is a weighted mean across datasets; running more pipeline adapters does not give a dataset more weight.

`config.ts` defines the suite-level gate. A dataset may also define `minimumScore` when a particular behavior must not be masked by the aggregate score, or `weight` when the product value of a scenario is intentionally higher.

The report labels a non-perfect case as `GAP` and prints the wrongly split or merged pairs. A `GAP` does not fail the command by itself unless the dataset has its own `minimumScore`; the aggregate 90% gate remains the normal success criterion.
