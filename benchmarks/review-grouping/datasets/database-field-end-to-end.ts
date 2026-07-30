import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'database-field-end-to-end',
  title: 'Database field propagated through the application',
  description: 'The migration, model, row mapping, query, API field, and test for account archival belong together despite mixed naming conventions and file formats.',
  tags: ['database', 'sql', 'graphql', 'cross-language', 'cross-file'],
  files: [
    {
      path: 'db/migrations/20260730_add_archived_at.sql',
      before: null,
      after: [
        'ALTER TABLE accounts',
        'ADD COLUMN archived_at timestamptz;',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'archived-at-migration',
          contains: 'ADD COLUMN archived_at'
        }
      ]
    },
    {
      path: 'src/accounts/account.ts',
      before: [
        'export interface Account {',
        '  id: string;',
        '  email: string;',
        '}',
        ''
      ].join('\n'),
      after: [
        'export interface Account {',
        '  id: string;',
        '  email: string;',
        '  archivedAt: Date | null;',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'archived-at-model',
          contains: 'archivedAt: Date | null'
        }
      ]
    },
    {
      path: 'src/accounts/map-account-row.ts',
      before: [
        'export const mapAccountRow = (row: AccountRow): Account => ({',
        '  id: row.id,',
        '  email: row.email',
        '});',
        ''
      ].join('\n'),
      after: [
        'export const mapAccountRow = (row: AccountRow): Account => ({',
        '  id: row.id,',
        '  email: row.email,',
        '  archivedAt: row.archived_at',
        '});',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'archived-at-row-mapping',
          contains: 'archivedAt: row.archived_at'
        }
      ]
    },
    {
      path: 'src/accounts/list-active-accounts.ts',
      before: [
        'export async function listActiveAccounts() {',
        '  return database.query("select * from accounts order by email");',
        '}',
        ''
      ].join('\n'),
      after: [
        'export async function listActiveAccounts() {',
        '  return database.query("select * from accounts where archived_at is null order by email");',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'archived-at-query-filter',
          contains: 'where archived_at is null'
        }
      ]
    },
    {
      path: 'schema/account.graphql',
      before: [
        'type Account {',
        '  id: ID!',
        '  email: String!',
        '}',
        ''
      ].join('\n'),
      after: [
        'type Account {',
        '  id: ID!',
        '  email: String!',
        '  archivedAt: DateTime',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'archived-at-api-field',
          contains: 'archivedAt: DateTime'
        }
      ]
    },
    {
      path: 'src/accounts/list-active-accounts.test.ts',
      before: [
        'it("lists accounts", async () => {',
        '  expect(await listActiveAccounts()).toHaveLength(2);',
        '});',
        ''
      ].join('\n'),
      after: [
        'it("excludes archived accounts", async () => {',
        '  expect(await listActiveAccounts()).toEqual([activeAccount]);',
        '});',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'archived-at-behavior-test',
          contains: 'excludes archived accounts'
        }
      ]
    },
    {
      path: 'db/seeds/demo.sql',
      before: 'INSERT INTO teams (name) VALUES (\'Demo Team\');\n',
      after: 'INSERT INTO teams (name) VALUES (\'Demo workspace\');\n',
      hunks: [
        {
          id: 'demo-seed-copy-edit',
          contains: 'Demo workspace'
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'account-archival',
      chunks: [
        'archived-at-migration',
        'archived-at-model',
        'archived-at-row-mapping',
        'archived-at-query-filter',
        'archived-at-api-field',
        'archived-at-behavior-test'
      ]
    },
    {
      id: 'demo-seed-copy',
      chunks: ['demo-seed-copy-edit']
    }
  ]
});
