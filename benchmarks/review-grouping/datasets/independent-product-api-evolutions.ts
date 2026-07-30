import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'independent-product-api-evolutions',
  title: 'Independent product API evolutions interleaved across shared layers',
  description: 'A money-object migration and an inventory-status migration should remain separate review units even though both cross the same domain, GraphQL, resolver, and UI files.',
  tags: ['complex', 'graphql', 'review-boundary', 'multi-feature', 'same-file', 'cross-layer', 'typescript'],
  files: [
    {
      path: 'src/catalog/product.ts',
      before: [
        'export interface Product {',
        '  id: string;',
        '  priceCents: number;',
        '  currency: string;',
        '  title: string;',
        '  description: string;',
        '  slug: string;',
        '  imageUrl: string;',
        '  categoryId: string;',
        '  brandId: string;',
        '  weightGrams: number;',
        '  taxCategory: string;',
        '  supplierId: string;',
        '  available: boolean;',
        '}',
        ''
      ].join('\n'),
      after: [
        'export interface Product {',
        '  id: string;',
        '  price: Money;',
        '  title: string;',
        '  description: string;',
        '  slug: string;',
        '  imageUrl: string;',
        '  categoryId: string;',
        '  brandId: string;',
        '  weightGrams: number;',
        '  taxCategory: string;',
        '  supplierId: string;',
        '  inventoryStatus: "in_stock" | "backordered" | "discontinued";',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'product-money-domain',
          contains: 'price: Money'
        },
        {
          id: 'product-inventory-domain',
          contains: 'inventoryStatus: "in_stock" | "backordered" | "discontinued"'
        }
      ]
    },
    {
      path: 'schema/product.graphql',
      before: [
        'type Product {',
        '  id: ID!',
        '  priceCents: Int!',
        '  currency: String!',
        '  title: String!',
        '  description: String!',
        '  slug: String!',
        '  imageUrl: String!',
        '  category: Category!',
        '  brand: Brand!',
        '  weightGrams: Int!',
        '  available: Boolean!',
        '}',
        ''
      ].join('\n'),
      after: [
        'type Product {',
        '  id: ID!',
        '  price: Money!',
        '  title: String!',
        '  description: String!',
        '  slug: String!',
        '  imageUrl: String!',
        '  category: Category!',
        '  brand: Brand!',
        '  weightGrams: Int!',
        '  inventoryStatus: InventoryStatus!',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'product-money-graphql',
          contains: 'price: Money!'
        },
        {
          id: 'product-inventory-graphql',
          contains: 'inventoryStatus: InventoryStatus!'
        }
      ]
    },
    {
      path: 'src/catalog/product-resolver.ts',
      before: [
        'export const Product = {',
        '  priceCents: (product: ProductRecord) => product.price_cents,',
        '  currency: (product: ProductRecord) => product.currency,',
        '  title: (product: ProductRecord) => product.title,',
        '  description: (product: ProductRecord) => product.description,',
        '  slug: (product: ProductRecord) => product.slug,',
        '  imageUrl: (product: ProductRecord) => product.image_url,',
        '  category: (product: ProductRecord) => categories.load(product.category_id),',
        '  brand: (product: ProductRecord) => brands.load(product.brand_id),',
        '  weightGrams: (product: ProductRecord) => product.weight_grams,',
        '  available: (product: ProductRecord) => product.stock_count > 0',
        '};',
        ''
      ].join('\n'),
      after: [
        'export const Product = {',
        '  price: (product: ProductRecord) => ({',
        '    amount: product.price_cents,',
        '    currencyCode: product.currency',
        '  }),',
        '  title: (product: ProductRecord) => product.title,',
        '  description: (product: ProductRecord) => product.description,',
        '  slug: (product: ProductRecord) => product.slug,',
        '  imageUrl: (product: ProductRecord) => product.image_url,',
        '  category: (product: ProductRecord) => categories.load(product.category_id),',
        '  brand: (product: ProductRecord) => brands.load(product.brand_id),',
        '  weightGrams: (product: ProductRecord) => product.weight_grams,',
        '  inventoryStatus: (product: ProductRecord) => inventoryStatus(product)',
        '};',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'product-money-resolver',
          contains: [
            'price: (product: ProductRecord)',
            'currencyCode: product.currency'
          ]
        },
        {
          id: 'product-inventory-resolver',
          contains: 'inventoryStatus: (product: ProductRecord)'
        }
      ]
    },
    {
      path: 'src/web/product-card.tsx',
      before: [
        'export function ProductCard({ product }: Props) {',
        '  const price = formatPrice(product.priceCents, product.currency);',
        '  const subtitle = product.brand.name;',
        '  const image = product.imageUrl;',
        '  const href = `/products/${product.slug}`;',
        '  const description = truncate(product.description);',
        '  const weight = formatWeight(product.weightGrams);',
        '  const category = product.category.name;',
        '  const analyticsId = product.id;',
        '  const imageAlt = product.title;',
        '  const badgeTone = product.available ? "positive" : "neutral";',
        '  const badgeLabel = product.available ? "In stock" : "Unavailable";',
        '',
        '  return <ProductTile price={price} badge={{ tone: badgeTone, label: badgeLabel }} />;',
        '}',
        ''
      ].join('\n'),
      after: [
        'export function ProductCard({ product }: Props) {',
        '  const price = formatMoney(product.price);',
        '  const subtitle = product.brand.name;',
        '  const image = product.imageUrl;',
        '  const href = `/products/${product.slug}`;',
        '  const description = truncate(product.description);',
        '  const weight = formatWeight(product.weightGrams);',
        '  const category = product.category.name;',
        '  const analyticsId = product.id;',
        '  const imageAlt = product.title;',
        '  const badge = inventoryBadge(product.inventoryStatus);',
        '',
        '  return <ProductTile price={price} badge={badge} />;',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'product-money-ui',
          contains: 'formatMoney(product.price)'
        },
        {
          id: 'product-inventory-ui',
          contains: 'inventoryBadge(product.inventoryStatus)'
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'product-money-object',
      chunks: [
        'product-money-domain',
        'product-money-graphql',
        'product-money-resolver',
        'product-money-ui'
      ]
    },
    {
      id: 'product-inventory-status',
      chunks: [
        'product-inventory-domain',
        'product-inventory-graphql',
        'product-inventory-resolver',
        'product-inventory-ui'
      ]
    }
  ]
});
