import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'same-method-name-different-owners',
  title: 'Same method name on unrelated owners',
  description: 'Changes to methods named refresh stay with their own class and callers instead of merging by identifier text.',
  tags: ['typescript', 'negative', 'methods', 'ownership'],
  files: [
    {
      path: 'src/users/user-directory.ts',
      before: [
        'export class UserDirectory {',
        '  refresh(userId: string): User {',
        '    return this.api.fetchUser(userId);',
        '  }',
        '}',
        ''
      ].join('\n'),
      after: [
        'export class UserDirectory {',
        '  refresh(userId: string, includeTeams = false): User {',
        '    return this.api.fetchUser(userId, { includeTeams });',
        '  }',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'user-directory-refresh',
          contains: [
            'refresh(userId: string, includeTeams = false)',
            'fetchUser(userId, { includeTeams })'
          ]
        }
      ]
    },
    {
      path: 'src/users/user-page.ts',
      before: 'const user = directory.refresh(route.userId);\n',
      after: 'const user = directory.refresh(route.userId, true);\n',
      hunks: [
        {
          id: 'user-refresh-caller',
          contains: 'directory.refresh(route.userId, true)'
        }
      ]
    },
    {
      path: 'src/cache/record-cache.ts',
      before: [
        'export class RecordCache {',
        '  refresh(key: string): void {',
        '    this.entries.delete(key);',
        '  }',
        '}',
        ''
      ].join('\n'),
      after: [
        'export class RecordCache {',
        '  refresh(key: string): boolean {',
        '    return this.entries.delete(key);',
        '  }',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'record-cache-refresh',
          contains: [
            'refresh(key: string): boolean',
            'return this.entries.delete(key);'
          ]
        }
      ]
    },
    {
      path: 'src/cache/cache-admin.ts',
      before: [
        'export function invalidate(cache: RecordCache, key: string): void {',
        '  cache.refresh(key);',
        '}',
        ''
      ].join('\n'),
      after: [
        'export function invalidate(cache: RecordCache, key: string): boolean {',
        '  return cache.refresh(key);',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'cache-refresh-caller',
          contains: [
            'invalidate(cache: RecordCache, key: string): boolean',
            'return cache.refresh(key);'
          ]
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'user-directory-refresh-change',
      chunks: ['user-directory-refresh', 'user-refresh-caller']
    },
    {
      id: 'record-cache-refresh-change',
      chunks: ['record-cache-refresh', 'cache-refresh-caller']
    }
  ]
});
