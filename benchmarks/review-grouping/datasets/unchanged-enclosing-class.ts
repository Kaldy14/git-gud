import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'unchanged-enclosing-class',
  title: 'Unchanged enclosing class outside the diff hunk',
  description: 'Tree-sitter should recover the definition owner from full-file context and join it to an external type usage.',
  tags: ['tree-sitter', 'full-context', 'typescript', 'cross-file'],
  files: [
    {
      path: 'src/product-category-seo.input.ts',
      before: [
        '@InputType()',
        'export class ProductCategorySeoInput {',
        '  readonly id!: string;',
        '  readonly createdAt!: Date;',
        '  readonly updatedAt!: Date;',
        '  readonly locale!: string;',
        '  @Field()',
        '  title!: string;',
        '}',
        ''
      ].join('\n'),
      after: [
        '@InputType()',
        'export class ProductCategorySeoInput {',
        '  readonly id!: string;',
        '  readonly createdAt!: Date;',
        '  readonly updatedAt!: Date;',
        '  readonly locale!: string;',
        '  @Field(() => LocalizedStringInput)',
        '  title!: LocalizedStringInput;',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'seo-input-definition',
          contains: [
            '@Field(() => LocalizedStringInput)',
            'title!: LocalizedStringInput;'
          ]
        }
      ]
    },
    {
      path: 'src/product-category-create.input.ts',
      before: [
        'export class ProductCategoryCreateInput {',
        '  seo?: ProductCategorySeoTemplatesInput;',
        '}',
        ''
      ].join('\n'),
      after: [
        'export class ProductCategoryCreateInput {',
        '  seo?: ProductCategorySeoInput;',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'seo-input-usage',
          contains: 'seo?: ProductCategorySeoInput;'
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'product-category-seo-input',
      chunks: ['seo-input-definition', 'seo-input-usage']
    }
  ]
});
