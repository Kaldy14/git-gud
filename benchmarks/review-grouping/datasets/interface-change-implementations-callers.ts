import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'interface-change-implementations-callers',
  title: 'Interface signature propagated to implementations and callers',
  description: 'A request-object migration groups the interface contract with its production implementation and caller.',
  tags: ['typescript', 'interface', 'implementations', 'cross-file'],
  files: [
    {
      path: 'src/payments/payment-gateway.ts',
      before: [
        'export interface PaymentGateway {',
        '  charge(customerId: string, amount: number): Promise<Receipt>;',
        '}',
        ''
      ].join('\n'),
      after: [
        'export interface ChargeRequest {',
        '  customerId: string;',
        '  amount: number;',
        '  idempotencyKey: string;',
        '}',
        '',
        'export interface PaymentGateway {',
        '  charge(request: ChargeRequest): Promise<Receipt>;',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'payment-gateway-contract',
          contains: [
            'export interface ChargeRequest {',
            'charge(request: ChargeRequest): Promise<Receipt>;'
          ]
        }
      ]
    },
    {
      path: 'src/payments/stripe-gateway.ts',
      before: [
        'export class StripeGateway implements PaymentGateway {',
        '  async charge(customerId: string, amount: number): Promise<Receipt> {',
        '    return this.stripe.charge({ customerId, amount });',
        '  }',
        '}',
        ''
      ].join('\n'),
      after: [
        'export class StripeGateway implements PaymentGateway {',
        '  async charge(request: ChargeRequest): Promise<Receipt> {',
        '    return this.stripe.charge(request);',
        '  }',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'stripe-gateway-implementation',
          contains: [
            'async charge(request: ChargeRequest)',
            'this.stripe.charge(request)'
          ]
        }
      ]
    },
    {
      path: 'src/checkout/complete-checkout.ts',
      before: [
        'export async function completeCheckout(order: Order, gateway: PaymentGateway) {',
        '  return gateway.charge(order.customerId, order.total);',
        '}',
        ''
      ].join('\n'),
      after: [
        'export async function completeCheckout(order: Order, gateway: PaymentGateway) {',
        '  return gateway.charge({',
        '    customerId: order.customerId,',
        '    amount: order.total,',
        '    idempotencyKey: order.id,',
        '  });',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'checkout-gateway-caller',
          contains: [
            'return gateway.charge({',
            'idempotencyKey: order.id'
          ]
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'payment-charge-request-migration',
      chunks: [
        'payment-gateway-contract',
        'stripe-gateway-implementation',
        'checkout-gateway-caller'
      ]
    }
  ]
});
