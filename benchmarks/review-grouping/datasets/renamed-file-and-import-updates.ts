import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'renamed-file-and-import-updates',
  title: 'Renamed domain file with import updates',
  description: 'A moved and renamed domain type should stay with the production and test imports updated for that move.',
  tags: ['rename', 'file-move', 'cross-file', 'typescript'],
  files: [
    {
      path: 'src/domain/account-record.ts',
      previousPath: 'src/legacy/user-record.ts',
      before: [
        'export type UserRecord = {',
        '  id: string;',
        '  email: string;',
        '  displayName: string;',
        '  locale: string;',
        '  createdAt: Date;',
        '  updatedAt: Date;',
        '};',
        ''
      ].join('\n'),
      after: [
        'export type AccountRecord = {',
        '  id: string;',
        '  email: string;',
        '  displayName: string;',
        '  locale: string;',
        '  status: "active" | "disabled";',
        '  createdAt: Date;',
        '  updatedAt: Date;',
        '};',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'account-record-rename',
          contains: [
            'export type AccountRecord',
            'status: "active" | "disabled"'
          ]
        }
      ]
    },
    {
      path: 'src/accounts/load-account.ts',
      before: [
        'import type { UserRecord } from "../legacy/user-record";',
        '',
        'export async function loadAccount(id: string): Promise<UserRecord> {',
        '  return database.accounts.find(id);',
        '}',
        ''
      ].join('\n'),
      after: [
        'import type { AccountRecord } from "../domain/account-record";',
        '',
        'export async function loadAccount(id: string): Promise<AccountRecord> {',
        '  return database.accounts.find(id);',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'account-record-production-import',
          contains: [
            'import type { AccountRecord }',
            'Promise<AccountRecord>'
          ]
        }
      ]
    },
    {
      path: 'src/accounts/load-account.test.ts',
      before: [
        'import type { UserRecord } from "../legacy/user-record";',
        '',
        'const account: UserRecord = makeAccount();',
        'expect(account.id).toBe("account-1");',
        ''
      ].join('\n'),
      after: [
        'import type { AccountRecord } from "../domain/account-record";',
        '',
        'const account: AccountRecord = makeAccount();',
        'expect(account.status).toBe("active");',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'account-record-test-import',
          contains: [
            'import type { AccountRecord }',
            'expect(account.status)'
          ]
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'account-record-move',
      chunks: [
        'account-record-rename',
        'account-record-production-import',
        'account-record-test-import'
      ]
    }
  ]
});
