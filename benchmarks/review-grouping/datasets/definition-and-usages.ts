import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'definition-and-usages',
  title: 'Definition with its production usage',
  description: 'A new constant and its production consumer belong together; an unrelated constant does not.',
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
      chunks: ['timeout-definition', 'timeout-usage']
    },
    {
      id: 'logging-change',
      chunks: ['logging-definition']
    }
  ]
});
