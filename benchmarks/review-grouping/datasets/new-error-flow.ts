import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'new-error-flow',
  title: 'New domain error from service to HTTP response',
  description: 'The error definition, throw site, controller mapping, and response assertion are one behavior change; an unrelated controller cleanup is separate.',
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
      path: 'src/http/inventory-controller.test.ts',
      before: [
        'it("returns no content after reserving stock", async () => {',
        '  expect(await reserve(request)).toHaveStatus(204);',
        '});',
        ''
      ].join('\n'),
      after: [
        'it("returns a conflict when inventory is unavailable", async () => {',
        '  inventory.available.mockResolvedValue(0);',
        '  expect(await reserve(request)).toMatchObject({',
        '    status: 409,',
        '    body: { code: "INVENTORY_UNAVAILABLE" }',
        '  });',
        '});',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'inventory-error-response-test',
          contains: [
            'returns a conflict when inventory is unavailable',
            'status: 409'
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
        'inventory-error-http-mapping',
        'inventory-error-response-test'
      ]
    },
    {
      id: 'order-controller-cleanup',
      chunks: ['order-controller-async-cleanup']
    }
  ]
});
