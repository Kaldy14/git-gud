import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'shadowed-local-is-not-exported-usage',
  title: 'Shadowed local is not an exported symbol usage',
  description: 'An exported helper and its imported caller belong together, while an unrelated local helper with the same name remains separate.',
  tags: ['typescript', 'negative', 'shadowing', 'cross-file'],
  files: [
    {
      path: 'src/accounts/normalize-email.ts',
      before: [
        'export function normalizeEmail(value: string): string {',
        '  return value.trim().toLowerCase();',
        '}',
        ''
      ].join('\n'),
      after: [
        'export function normalizeEmail(value: string): string {',
        '  return value.normalize("NFKC").trim().toLowerCase();',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'exported-email-normalizer',
          contains: 'return value.normalize("NFKC").trim().toLowerCase();'
        }
      ]
    },
    {
      path: 'src/accounts/create-account.ts',
      before: [
        'import { normalizeEmail } from "./normalize-email";',
        '',
        'export const createAccount = (input: SignupInput) =>',
        '  repository.insert({ ...input, email: input.email.trim().toLowerCase() });',
        ''
      ].join('\n'),
      after: [
        'import { normalizeEmail } from "./normalize-email";',
        '',
        'export const createAccount = (input: SignupInput) =>',
        '  repository.insert({ ...input, email: normalizeEmail(input.email) });',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'exported-normalizer-caller',
          contains: 'email: normalizeEmail(input.email)'
        }
      ]
    },
    {
      path: 'src/analytics/email-dimensions.ts',
      before: [
        'export function buildEmailDimensions(raw: string): EmailDimensions {',
        '  const domain = raw.slice(raw.lastIndexOf("@") + 1);',
        '  return { domain };',
        '}',
        ''
      ].join('\n'),
      after: [
        'export function buildEmailDimensions(raw: string): EmailDimensions {',
        '  const normalizeEmail = (value: string) => value.replace(/\\+[^@]+/, "");',
        '  const normalized = normalizeEmail(raw);',
        '  const domain = normalized.slice(normalized.lastIndexOf("@") + 1);',
        '  return { domain };',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'local-analytics-normalizer',
          contains: [
            'const normalizeEmail = (value: string)',
            'const normalized = normalizeEmail(raw);'
          ]
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'account-email-normalization',
      chunks: ['exported-email-normalizer', 'exported-normalizer-caller']
    },
    {
      id: 'analytics-email-normalization',
      chunks: ['local-analytics-normalizer']
    }
  ]
});
