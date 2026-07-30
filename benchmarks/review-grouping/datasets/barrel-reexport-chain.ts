import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'barrel-reexport-chain',
  title: 'Rename propagated through a barrel re-export chain',
  description: 'A renamed domain type, two barrel updates, and a public consumer form one reviewable migration.',
  tags: ['typescript', 'rename', 'barrel', 're-export', 'cross-file'],
  files: [
    {
      path: 'src/domain/orders/fulfillment-status.ts',
      previousPath: 'src/domain/orders/order-status.ts',
      before: [
        'export type OrderStatus = "pending" | "shipped" | "delivered";',
        ''
      ].join('\n'),
      after: [
        'export type FulfillmentStatus = "pending" | "shipped" | "delivered";',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'fulfillment-status-rename',
          contains: 'export type FulfillmentStatus ='
        }
      ]
    },
    {
      path: 'src/domain/orders/index.ts',
      before: 'export type { OrderStatus } from "./order-status";\n',
      after: 'export type { FulfillmentStatus } from "./fulfillment-status";\n',
      hunks: [
        {
          id: 'orders-barrel-reexport',
          contains: 'export type { FulfillmentStatus } from "./fulfillment-status";'
        }
      ]
    },
    {
      path: 'src/domain/index.ts',
      before: 'export type { OrderStatus } from "./orders";\n',
      after: 'export type { FulfillmentStatus } from "./orders";\n',
      hunks: [
        {
          id: 'domain-barrel-reexport',
          contains: 'export type { FulfillmentStatus } from "./orders";'
        }
      ]
    },
    {
      path: 'src/api/order-response.ts',
      before: [
        'import type { OrderStatus } from "../domain";',
        '',
        'export interface OrderResponse {',
        '  id: string;',
        '  status: OrderStatus;',
        '}',
        ''
      ].join('\n'),
      after: [
        'import type { FulfillmentStatus } from "../domain";',
        '',
        'export interface OrderResponse {',
        '  id: string;',
        '  status: FulfillmentStatus;',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'order-response-barrel-consumer',
          contains: [
            'import type { FulfillmentStatus } from "../domain";',
            'status: FulfillmentStatus;'
          ]
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'fulfillment-status-public-rename',
      chunks: [
        'fulfillment-status-rename',
        'orders-barrel-reexport',
        'domain-barrel-reexport',
        'order-response-barrel-consumer'
      ]
    }
  ]
});
