import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'comments-are-not-usages',
  title: 'Comments and strings are not symbol usages',
  description: 'A real definition and reference belong together, while the same identifier in prose and a string stays separate.',
  tags: ['tree-sitter', 'negative', 'false-positive', 'typescript'],
  files: [
    {
      path: 'src/config/shared.ts',
      before: 'export const SharedConfig = { value: 1 };\n',
      after: 'export const SharedConfig = { value: 2 };\n',
      hunks: [
        {
          id: 'shared-config-definition',
          contains: 'SharedConfig = { value: 2 }'
        }
      ]
    },
    {
      path: 'src/consumer.ts',
      before: 'consume();\n',
      after: 'consume(SharedConfig);\n',
      hunks: [
        {
          id: 'shared-config-usage',
          contains: 'consume(SharedConfig)'
        }
      ]
    },
    {
      path: 'docs/review-note.ts',
      before: '// unrelated note\nexport const note = "unrelated";\n',
      after: '// SharedConfig should not link this file\nexport const note = "SharedConfig";\n',
      hunks: [
        {
          id: 'shared-config-prose',
          contains: [
            '// SharedConfig should not link this file',
            'note = "SharedConfig"'
          ]
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'shared-config-change',
      chunks: ['shared-config-definition', 'shared-config-usage']
    },
    {
      id: 'review-note-change',
      chunks: ['shared-config-prose']
    }
  ]
});
