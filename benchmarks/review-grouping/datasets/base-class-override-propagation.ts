import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'base-class-override-propagation',
  title: 'Base class signature propagated to overrides',
  description: 'A new method parameter groups the base declaration with subclass overrides and the dispatching caller.',
  tags: ['typescript', 'inheritance', 'override', 'cross-file'],
  files: [
    {
      path: 'src/events/event-handler.ts',
      before: [
        'export abstract class EventHandler {',
        '  abstract handle(event: DomainEvent): Promise<void>;',
        '}',
        ''
      ].join('\n'),
      after: [
        'export abstract class EventHandler {',
        '  abstract handle(event: DomainEvent, context: HandlerContext): Promise<void>;',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'base-handler-signature',
          contains: 'handle(event: DomainEvent, context: HandlerContext)'
        }
      ]
    },
    {
      path: 'src/events/audit-event-handler.ts',
      before: [
        'export class AuditEventHandler extends EventHandler {',
        '  async handle(event: DomainEvent): Promise<void> {',
        '    await this.audit.write(event);',
        '  }',
        '}',
        ''
      ].join('\n'),
      after: [
        'export class AuditEventHandler extends EventHandler {',
        '  async handle(event: DomainEvent, context: HandlerContext): Promise<void> {',
        '    await this.audit.write(event, context.actorId);',
        '  }',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'audit-handler-override',
          contains: [
            'handle(event: DomainEvent, context: HandlerContext)',
            'this.audit.write(event, context.actorId)'
          ]
        }
      ]
    },
    {
      path: 'src/events/webhook-event-handler.ts',
      before: [
        'export class WebhookEventHandler extends EventHandler {',
        '  async handle(event: DomainEvent): Promise<void> {',
        '    await this.webhooks.publish(event);',
        '  }',
        '}',
        ''
      ].join('\n'),
      after: [
        'export class WebhookEventHandler extends EventHandler {',
        '  async handle(event: DomainEvent, context: HandlerContext): Promise<void> {',
        '    await this.webhooks.publish(event, { traceId: context.traceId });',
        '  }',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'webhook-handler-override',
          contains: [
            'handle(event: DomainEvent, context: HandlerContext)',
            'traceId: context.traceId'
          ]
        }
      ]
    },
    {
      path: 'src/events/dispatch-event.ts',
      before: [
        'export async function dispatchEvent(event: DomainEvent, handlers: EventHandler[]) {',
        '  await Promise.all(handlers.map((handler) => handler.handle(event)));',
        '}',
        ''
      ].join('\n'),
      after: [
        'export async function dispatchEvent(',
        '  event: DomainEvent,',
        '  context: HandlerContext,',
        '  handlers: EventHandler[]',
        ') {',
        '  await Promise.all(handlers.map((handler) => handler.handle(event, context)));',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'handler-dispatch-caller',
          contains: [
            'context: HandlerContext,',
            'handler.handle(event, context)'
          ]
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'handler-context-propagation',
      chunks: [
        'base-handler-signature',
        'audit-handler-override',
        'webhook-handler-override',
        'handler-dispatch-caller'
      ]
    }
  ]
});
