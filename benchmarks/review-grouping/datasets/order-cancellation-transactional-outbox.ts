import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'order-cancellation-transactional-outbox',
  title: 'Order cancellation propagated through a transactional outbox',
  description: 'The database shape, domain model, transaction, event contract, publisher, and consumer form one atomic cancellation capability; an unrelated list-limit change stays separate.',
  tags: ['complex', 'database', 'events', 'transaction', 'cross-language', 'cross-file', 'typescript'],
  files: [
    {
      path: 'db/migrations/20260730_add_order_cancellation.sql',
      before: null,
      after: [
        'ALTER TABLE orders',
        '  ADD COLUMN cancelled_at timestamptz,',
        '  ADD COLUMN cancellation_reason text;',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'order-cancellation-migration',
          contains: [
            'ADD COLUMN cancelled_at',
            'ADD COLUMN cancellation_reason'
          ]
        }
      ]
    },
    {
      path: 'src/orders/order.ts',
      before: [
        'export interface Order {',
        '  id: string;',
        '  customerId: string;',
        '  status: "pending" | "paid" | "shipped";',
        '}',
        ''
      ].join('\n'),
      after: [
        'export interface Order {',
        '  id: string;',
        '  customerId: string;',
        '  status: "pending" | "paid" | "shipped" | "cancelled";',
        '  cancelledAt: Date | null;',
        '  cancellationReason: string | null;',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'order-cancellation-domain-model',
          contains: [
            '"shipped" | "cancelled"',
            'cancellationReason: string | null'
          ]
        }
      ]
    },
    {
      path: 'src/orders/cancel-order.ts',
      before: [
        'export async function cancelOrder(orderId: string) {',
        '  await database.orders.update(orderId, { status: "cancelled" });',
        '}',
        ''
      ].join('\n'),
      after: [
        'export async function cancelOrder(orderId: string, reason: string) {',
        '  await database.transaction(async (transaction) => {',
        '    const cancelledAt = new Date();',
        '    await transaction.orders.update(orderId, {',
        '      status: "cancelled",',
        '      cancelledAt,',
        '      cancellationReason: reason',
        '    });',
        '    await transaction.outbox.insert({',
        '      type: "order.cancelled",',
        '      payload: { orderId, reason, cancelledAt }',
        '    });',
        '  });',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'order-cancellation-transaction',
          contains: [
            'database.transaction',
            'transaction.outbox.insert',
            'type: "order.cancelled"'
          ]
        }
      ]
    },
    {
      path: 'contracts/order-cancelled.json',
      before: null,
      after: [
        '{',
        '  "$id": "order.cancelled",',
        '  "type": "object",',
        '  "required": ["orderId", "reason", "cancelledAt"],',
        '  "properties": {',
        '    "orderId": { "type": "string" },',
        '    "reason": { "type": "string" },',
        '    "cancelledAt": { "type": "string", "format": "date-time" }',
        '  }',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'order-cancelled-event-contract',
          contains: [
            '"$id": "order.cancelled"',
            '"required": ["orderId", "reason", "cancelledAt"]'
          ]
        }
      ]
    },
    {
      path: 'src/events/publish-order-cancelled.ts',
      before: null,
      after: [
        'export async function publishOrderCancelled(entry: OutboxEntry) {',
        '  const event = parseOrderCancelled(entry.payload);',
        '  await eventBus.publish("order.cancelled", event);',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'order-cancelled-publisher',
          contains: [
            'parseOrderCancelled(entry.payload)',
            'eventBus.publish("order.cancelled"'
          ]
        }
      ]
    },
    {
      path: 'services/billing/order_cancelled_handler.go',
      before: null,
      after: [
        'func HandleOrderCancelled(event OrderCancelled) error {',
        '    return authorizations.Release(',
        '        event.OrderID,',
        '        event.CancellationReason,',
        '    )',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'order-cancelled-billing-consumer',
          contains: [
            'func HandleOrderCancelled',
            'event.CancellationReason'
          ]
        }
      ]
    },
    {
      path: 'src/orders/list-orders.ts',
      before: 'export const listOrders = () => repository.list({ limit: 50 });\n',
      after: 'export const listOrders = () => repository.list({ limit: 100 });\n',
      hunks: [
        {
          id: 'order-list-limit-tuning',
          contains: 'limit: 100'
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'transactional-order-cancellation',
      chunks: [
        'order-cancellation-migration',
        'order-cancellation-domain-model',
        'order-cancellation-transaction',
        'order-cancelled-event-contract',
        'order-cancelled-publisher',
        'order-cancelled-billing-consumer'
      ]
    },
    {
      id: 'order-list-limit',
      chunks: ['order-list-limit-tuning']
    }
  ]
});
