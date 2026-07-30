import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'definition-and-usages',
  title: 'Definition with production and test usages',
  description: 'A new constant, its production consumer, and its test belong together; an unrelated constant does not.',
  tags: ['baseline', 'cross-file', 'typescript', 'added-files'],
  files: [
    {
      path: 'src/config.ts',
      before: null,
      after: 'export const DEFAULT_TIMEOUT = 5000;\n',
      hunks: [
        {
          id: 'timeout-definition',
          contains: 'export const DEFAULT_TIMEOUT = 5000;'
        }
      ]
    },
    {
      path: 'src/client.ts',
      before: null,
      after: 'export const connect = () => open(DEFAULT_TIMEOUT);\n',
      hunks: [
        {
          id: 'timeout-usage',
          contains: 'open(DEFAULT_TIMEOUT)'
        }
      ]
    },
    {
      path: 'src/client.test.ts',
      before: null,
      after: 'expect(connect(DEFAULT_TIMEOUT)).toBeDefined();\n',
      hunks: [
        {
          id: 'timeout-test',
          contains: 'connect(DEFAULT_TIMEOUT)'
        }
      ]
    },
    {
      path: 'src/logging.ts',
      before: null,
      after: 'export const LOG_PREFIX = "[client]";\n',
      hunks: [
        {
          id: 'logging-definition',
          contains: 'export const LOG_PREFIX'
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'timeout-change',
      chunks: ['timeout-definition', 'timeout-usage', 'timeout-test']
    },
    {
      id: 'logging-change',
      chunks: ['logging-definition']
    }
  ]
});
