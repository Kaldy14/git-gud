import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'type-only-and-generic-usages',
  title: 'Type-only imports and generic constraints',
  description: 'A renamed type should stay with import-type, annotation, and generic usages, while the same text in metadata remains independent.',
  tags: ['types', 'generics', 'negative', 'typescript', 'cross-file'],
  files: [
    {
      path: 'src/storage/types.ts',
      before: 'export type PersistedEntity = { id: string; version: number };\n',
      after: 'export type StoredEntity = { id: string; version: number };\n',
      hunks: [
        {
          id: 'stored-entity-definition',
          contains: 'export type StoredEntity'
        }
      ]
    },
    {
      path: 'src/storage/save-user.ts',
      before: [
        'import type { PersistedEntity } from "./types";',
        '',
        'export const saveUser = (user: PersistedEntity) => storage.save(user);',
        ''
      ].join('\n'),
      after: [
        'import type { StoredEntity } from "./types";',
        '',
        'export const saveUser = (user: StoredEntity) => storage.save(user);',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'stored-entity-type-import',
          contains: [
            'import type { StoredEntity }',
            'user: StoredEntity'
          ]
        }
      ]
    },
    {
      path: 'src/storage/create-repository.ts',
      before: [
        'export function createRepository<T extends PersistedEntity>() {',
        '  return new Repository<T>();',
        '}',
        ''
      ].join('\n'),
      after: [
        'export function createRepository<T extends StoredEntity>() {',
        '  return new Repository<T>();',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'stored-entity-generic-constraint',
          contains: 'T extends StoredEntity'
        }
      ]
    },
    {
      path: 'src/telemetry/metadata.ts',
      before: 'export const storageLabel = "PersistedEntity";\n',
      after: 'export const storageLabel = "StoredEntity";\n',
      hunks: [
        {
          id: 'stored-entity-metadata-string',
          contains: 'storageLabel = "StoredEntity"'
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'stored-entity-type-rename',
      chunks: [
        'stored-entity-definition',
        'stored-entity-type-import',
        'stored-entity-generic-constraint'
      ]
    },
    {
      id: 'storage-telemetry-label',
      chunks: ['stored-entity-metadata-string']
    }
  ]
});
