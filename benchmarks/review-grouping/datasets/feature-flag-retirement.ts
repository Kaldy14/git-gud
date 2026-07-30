import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'feature-flag-retirement',
  title: 'Feature flag retirement with fallback deletion',
  description: 'Removing a fully rolled-out search flag should keep configuration cleanup, branch simplification, fallback deletion, and operator documentation together; an independent ranking tune stays separate.',
  tags: ['complex', 'deletion', 'configuration', 'cleanup', 'lifecycle', 'cross-file', 'typescript'],
  files: [
    {
      path: '.env.example',
      before: [
        'SEARCH_ENDPOINT=https://search.example.com',
        'USE_LEGACY_SEARCH=false',
        'SEARCH_TIMEOUT_MS=3000',
        ''
      ].join('\n'),
      after: [
        'SEARCH_ENDPOINT=https://search.example.com',
        'SEARCH_TIMEOUT_MS=3000',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'legacy-search-env-removal',
          contains: 'USE_LEGACY_SEARCH=false'
        }
      ]
    },
    {
      path: 'src/config/schema.ts',
      before: [
        'export const searchSchema = z.object({',
        '  SEARCH_ENDPOINT: z.string().url(),',
        '  USE_LEGACY_SEARCH: z.coerce.boolean(),',
        '  SEARCH_TIMEOUT_MS: z.coerce.number().positive()',
        '});',
        ''
      ].join('\n'),
      after: [
        'export const searchSchema = z.object({',
        '  SEARCH_ENDPOINT: z.string().url(),',
        '  SEARCH_TIMEOUT_MS: z.coerce.number().positive()',
        '});',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'legacy-search-schema-removal',
          contains: 'USE_LEGACY_SEARCH: z.coerce.boolean()'
        }
      ]
    },
    {
      path: 'src/config/runtime.ts',
      before: [
        'export const searchConfig = {',
        '  endpoint: environment.SEARCH_ENDPOINT,',
        '  useLegacySearch: environment.USE_LEGACY_SEARCH,',
        '  timeoutMs: environment.SEARCH_TIMEOUT_MS',
        '};',
        ''
      ].join('\n'),
      after: [
        'export const searchConfig = {',
        '  endpoint: environment.SEARCH_ENDPOINT,',
        '  timeoutMs: environment.SEARCH_TIMEOUT_MS',
        '};',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'legacy-search-runtime-removal',
          contains: 'useLegacySearch: environment.USE_LEGACY_SEARCH'
        }
      ]
    },
    {
      path: 'src/search/search.ts',
      before: [
        'import { legacySearch } from "./legacy-search";',
        'import { semanticSearch } from "./semantic-search";',
        '',
        'export async function search(query: string) {',
        '  if (searchConfig.useLegacySearch) {',
        '    return legacySearch(query);',
        '  }',
        '',
        '  return semanticSearch(query);',
        '}',
        ''
      ].join('\n'),
      after: [
        'import { semanticSearch } from "./semantic-search";',
        '',
        'export async function search(query: string) {',
        '  return semanticSearch(query);',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'legacy-search-branch-removal',
          contains: [
            'import { legacySearch }',
            'if (searchConfig.useLegacySearch)'
          ]
        }
      ]
    },
    {
      path: 'src/search/legacy-search.ts',
      before: [
        'export async function legacySearch(query: string) {',
        '  return sql.query("select * from documents where body like ?", [`%${query}%`]);',
        '}',
        ''
      ].join('\n'),
      after: null,
      hunks: [
        {
          id: 'legacy-search-implementation-deletion',
          contains: 'export async function legacySearch'
        }
      ]
    },
    {
      path: 'docs/search-operations.md',
      before: [
        '# Search operations',
        '',
        'Set `USE_LEGACY_SEARCH=true` to route traffic through the SQL fallback.',
        'The semantic endpoint remains the default.',
        ''
      ].join('\n'),
      after: [
        '# Search operations',
        '',
        'All search traffic is routed through the semantic endpoint.',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'legacy-search-operations-cleanup',
          contains: 'USE_LEGACY_SEARCH=true'
        }
      ]
    },
    {
      path: 'src/search/ranking.ts',
      before: 'export const titleBoost = 1.5;\n',
      after: 'export const titleBoost = 1.75;\n',
      hunks: [
        {
          id: 'search-title-boost-tuning',
          contains: 'titleBoost = 1.75'
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'retire-legacy-search',
      chunks: [
        'legacy-search-env-removal',
        'legacy-search-schema-removal',
        'legacy-search-runtime-removal',
        'legacy-search-branch-removal',
        'legacy-search-implementation-deletion',
        'legacy-search-operations-cleanup'
      ]
    },
    {
      id: 'search-ranking-tune',
      chunks: ['search-title-boost-tuning']
    }
  ]
});
