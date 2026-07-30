import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'new-error-flow',
  title: 'New domain error from service to HTTP response',
  description: 'The error definition, throw site, and controller mapping are one behavior change; an unrelated controller cleanup is separate.',
  tags: ['error-handling', 'control-flow', 'cross-file', 'typescript'],
  files: [
    {
      path: 'src/inventory/inventory-unavailable-error.ts',
      before: null,
      after: [
        'export class InventoryUnavailableError extends Error {',
        '  readonly code = "INVENTORY_UNAVAILABLE";',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'inventory-error-definition',
          contains: 'class InventoryUnavailableError'
        }
      ]
    },
    {
      path: 'src/inventory/reserve-stock.ts',
      before: [
        'export async function reserveStock(sku: string, quantity: number) {',
        '  const available = await inventory.available(sku);',
        '  if (available < quantity) {',
        '    return false;',
        '  }',
        '  return inventory.reserve(sku, quantity);',
        '}',
        ''
      ].join('\n'),
      after: [
        'export async function reserveStock(sku: string, quantity: number) {',
        '  const available = await inventory.available(sku);',
        '  if (available < quantity) {',
        '    throw new InventoryUnavailableError();',
        '  }',
        '  return inventory.reserve(sku, quantity);',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'inventory-error-throw',
          contains: 'throw new InventoryUnavailableError()'
        }
      ]
    },
    {
      path: 'src/http/inventory-controller.ts',
      before: [
        'export async function reserve(request: Request) {',
        '  await reserveStock(request.sku, request.quantity);',
        '  return response.noContent();',
        '}',
        ''
      ].join('\n'),
      after: [
        'export async function reserve(request: Request) {',
        '  try {',
        '    await reserveStock(request.sku, request.quantity);',
        '    return response.noContent();',
        '  } catch (error) {',
        '    if (error instanceof InventoryUnavailableError) {',
        '      return response.conflict({ code: error.code });',
        '    }',
        '    throw error;',
        '  }',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'inventory-error-http-mapping',
          contains: [
            'error instanceof InventoryUnavailableError',
            'response.conflict'
          ]
        }
      ]
    },
    {
      path: 'src/http/order-controller.ts',
      before: 'export const getOrder = (id: string) => orders.find(id);\n',
      after: 'export const getOrder = async (id: string) => orders.find(id);\n',
      hunks: [
        {
          id: 'order-controller-async-cleanup',
          contains: 'getOrder = async'
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'inventory-unavailable-response',
      chunks: [
        'inventory-error-definition',
        'inventory-error-throw',
        'inventory-error-http-mapping'
      ]
    },
    {
      id: 'order-controller-cleanup',
      chunks: ['order-controller-async-cleanup']
    }
  ]
});
