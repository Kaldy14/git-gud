import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'dependency-manifest-and-integration',
  title: 'Dependency manifest change with its integration',
  description: 'Adding a retry dependency should stay with the implementation and test that adopt it; an unrelated changelog correction is separate.',
  tags: ['dependency', 'manifest', 'json', 'cross-file', 'typescript'],
  files: [
    {
      path: 'package.json',
      before: [
        '{',
        '  "name": "request-service",',
        '  "dependencies": {',
        '    "undici": "^7.0.0"',
        '  }',
        '}',
        ''
      ].join('\n'),
      after: [
        '{',
        '  "name": "request-service",',
        '  "dependencies": {',
        '    "p-retry": "^7.0.0",',
        '    "undici": "^7.0.0"',
        '  }',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'p-retry-manifest-entry',
          contains: '"p-retry": "^7.0.0"'
        }
      ]
    },
    {
      path: 'src/request.ts',
      before: [
        'import { request } from "undici";',
        '',
        'export async function fetchProfile(url: string) {',
        '  for (let attempt = 0; attempt < 3; attempt += 1) {',
        '    try {',
        '      return await request(url);',
        '    } catch (error) {',
        '      if (attempt === 2) throw error;',
        '    }',
        '  }',
        '}',
        ''
      ].join('\n'),
      after: [
        'import pRetry from "p-retry";',
        'import { request } from "undici";',
        '',
        'export async function fetchProfile(url: string) {',
        '  return pRetry(() => request(url), { retries: 2 });',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'p-retry-integration',
          contains: [
            'import pRetry from "p-retry"',
            'return pRetry(() => request(url)'
          ]
        }
      ]
    },
    {
      path: 'src/request.test.ts',
      before: [
        'it("tries a failed request three times", async () => {',
        '  request.mockRejectedValue(new Error("offline"));',
        '  await expect(fetchProfile(url)).rejects.toThrow("offline");',
        '  expect(request).toHaveBeenCalledTimes(3);',
        '});',
        ''
      ].join('\n'),
      after: [
        'it("retries a failed request twice", async () => {',
        '  request.mockRejectedValue(new Error("offline"));',
        '  await expect(fetchProfile(url)).rejects.toThrow("offline");',
        '  expect(request).toHaveBeenCalledTimes(3);',
        '});',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'p-retry-behavior-test',
          contains: 'retries a failed request twice'
        }
      ]
    },
    {
      path: 'CHANGELOG.md',
      before: '- Fixed an typo in the setup guide.\n',
      after: '- Fixed a typo in the setup guide.\n',
      hunks: [
        {
          id: 'changelog-grammar',
          contains: 'Fixed a typo'
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'adopt-p-retry',
      chunks: [
        'p-retry-manifest-entry',
        'p-retry-integration',
        'p-retry-behavior-test'
      ]
    },
    {
      id: 'changelog-copy-edit',
      chunks: ['changelog-grammar']
    }
  ]
});
