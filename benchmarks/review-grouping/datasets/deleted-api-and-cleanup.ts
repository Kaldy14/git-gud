import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'deleted-api-and-cleanup',
  title: 'Deleted API with caller and test cleanup',
  description: 'Removing a deprecated cache API, its import, fallback branch, and tests is one review unit; an unrelated debug helper deletion is separate.',
  tags: ['deletion', 'cleanup', 'cross-file', 'typescript'],
  files: [
    {
      path: 'src/cache/read-legacy-cache.ts',
      before: [
        'export async function readLegacyCache(userId: string) {',
        '  return legacyRedis.get(`user:${userId}`);',
        '}',
        ''
      ].join('\n'),
      after: null,
      hunks: [
        {
          id: 'legacy-cache-api-deletion',
          contains: 'export async function readLegacyCache'
        }
      ]
    },
    {
      path: 'src/cache/load-user.ts',
      before: [
        'import { readLegacyCache } from "./read-legacy-cache";',
        'import { readUserCache } from "./read-user-cache";',
        '',
        'export async function loadUser(userId: string) {',
        '  const cached = await readUserCache(userId);',
        '  if (cached) {',
        '    return cached;',
        '  }',
        '',
        '  const source = await database.users.find(userId);',
        '  logger.debug("primary cache miss", { userId });',
        '  if (!source) {',
        '    return readLegacyCache(userId);',
        '  }',
        '',
        '  return source;',
        '}',
        ''
      ].join('\n'),
      after: [
        'import { readUserCache } from "./read-user-cache";',
        '',
        'export async function loadUser(userId: string) {',
        '  const cached = await readUserCache(userId);',
        '  if (cached) {',
        '    return cached;',
        '  }',
        '',
        '  const source = await database.users.find(userId);',
        '  logger.debug("primary cache miss", { userId });',
        '',
        '  return source;',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'legacy-cache-import-cleanup',
          contains: 'import { readLegacyCache }'
        },
        {
          id: 'legacy-cache-fallback-cleanup',
          contains: 'return readLegacyCache(userId)'
        }
      ]
    },
    {
      path: 'src/cache/read-legacy-cache.test.ts',
      before: [
        'it("reads the legacy cache key", async () => {',
        '  await expect(readLegacyCache("user-1")).resolves.toEqual(cachedUser);',
        '});',
        ''
      ].join('\n'),
      after: null,
      hunks: [
        {
          id: 'legacy-cache-test-deletion',
          contains: 'reads the legacy cache key'
        }
      ]
    },
    {
      path: 'src/debug/trace-request.ts',
      before: [
        'export function traceRequest(requestId: string) {',
        '  console.debug("request", requestId);',
        '}',
        ''
      ].join('\n'),
      after: null,
      hunks: [
        {
          id: 'debug-helper-deletion',
          contains: 'export function traceRequest'
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'remove-legacy-cache',
      chunks: [
        'legacy-cache-api-deletion',
        'legacy-cache-import-cleanup',
        'legacy-cache-fallback-cleanup',
        'legacy-cache-test-deletion'
      ]
    },
    {
      id: 'remove-debug-helper',
      chunks: ['debug-helper-deletion']
    }
  ]
});
