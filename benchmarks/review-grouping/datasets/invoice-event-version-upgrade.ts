import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'invoice-event-version-upgrade',
  title: 'Versioned invoice event upgraded across producer, consumers, and routing',
  description: 'Renaming and versioning an event contract should group the schema move with its TypeScript producer, Go consumer, analytics consumer, and deployment routing; queue retention is independent.',
  tags: ['complex', 'events', 'schema', 'rename', 'cross-language', 'infrastructure', 'cross-file'],
  files: [
    {
      path: 'contracts/invoice-issued.v1.json',
      before: [
        '{',
        '  "$id": "invoice.issued.v1",',
        '  "required": ["invoiceId", "customerId", "totalCents"],',
        '  "properties": {',
        '    "invoiceId": { "type": "string" },',
        '    "customerId": { "type": "string" },',
        '    "totalCents": { "type": "integer" }',
        '  }',
        '}',
        ''
      ].join('\n'),
      after: null,
      hunks: [
        {
          id: 'invoice-issued-v1-contract-deletion',
          contains: '"$id": "invoice.issued.v1"'
        }
      ]
    },
    {
      path: 'contracts/invoice-issued.v2.json',
      before: null,
      after: [
        '{',
        '  "$id": "invoice.issued.v2",',
        '  "required": ["invoiceId", "accountId", "totalCents"],',
        '  "properties": {',
        '    "invoiceId": { "type": "string" },',
        '    "accountId": { "type": "string" },',
        '    "totalCents": { "type": "integer" }',
        '  }',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'invoice-issued-v2-contract-addition',
          contains: [
            '"$id": "invoice.issued.v2"',
            '"accountId": { "type": "string" }'
          ]
        }
      ]
    },
    {
      path: 'src/billing/publish-invoice-issued.ts',
      before: [
        'export async function publishInvoiceIssued(invoice: Invoice) {',
        '  await eventBus.publish("invoice.issued.v1", {',
        '    invoiceId: invoice.id,',
        '    customerId: invoice.customerId,',
        '    totalCents: invoice.totalCents',
        '  });',
        '}',
        ''
      ].join('\n'),
      after: [
        'export async function publishInvoiceIssued(invoice: Invoice) {',
        '  await eventBus.publish("invoice.issued.v2", {',
        '    invoiceId: invoice.id,',
        '    accountId: invoice.accountId,',
        '    totalCents: invoice.totalCents',
        '  });',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'invoice-issued-v2-producer',
          contains: [
            'eventBus.publish("invoice.issued.v2"',
            'accountId: invoice.accountId'
          ]
        }
      ]
    },
    {
      path: 'services/ledger/handlers/invoice_issued.go',
      before: [
        'func HandleInvoiceIssued(event InvoiceIssuedV1) error {',
        '    account, err := accounts.ByCustomerID(event.CustomerID)',
        '    if err != nil {',
        '        return err',
        '    }',
        '    return ledger.Record(account.ID, event.TotalCents)',
        '}',
        ''
      ].join('\n'),
      after: [
        'func HandleInvoiceIssued(event InvoiceIssuedV2) error {',
        '    return ledger.Record(event.AccountID, event.TotalCents)',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'invoice-issued-v2-ledger-consumer',
          contains: [
            'InvoiceIssuedV2',
            'event.AccountID'
          ]
        }
      ]
    },
    {
      path: 'src/analytics/invoice-events.ts',
      before: [
        'export const invoiceIssuedProperties = (event: InvoiceIssuedV1) => ({',
        '  invoice_id: event.invoiceId,',
        '  customer_id: event.customerId,',
        '  total_cents: event.totalCents',
        '});',
        ''
      ].join('\n'),
      after: [
        'export const invoiceIssuedProperties = (event: InvoiceIssuedV2) => ({',
        '  invoice_id: event.invoiceId,',
        '  account_id: event.accountId,',
        '  total_cents: event.totalCents',
        '});',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'invoice-issued-v2-analytics-consumer',
          contains: [
            'event: InvoiceIssuedV2',
            'account_id: event.accountId'
          ]
        }
      ]
    },
    {
      path: 'infra/event-routing.yaml',
      before: [
        'routes:',
        '  invoice-issued-ledger:',
        '    event: invoice.issued.v1',
        '    target: ledger-invoice-issued',
        '  invoice-issued-analytics:',
        '    event: invoice.issued.v1',
        '    target: analytics-invoice-issued',
        ''
      ].join('\n'),
      after: [
        'routes:',
        '  invoice-issued-ledger:',
        '    event: invoice.issued.v2',
        '    target: ledger-invoice-issued',
        '  invoice-issued-analytics:',
        '    event: invoice.issued.v2',
        '    target: analytics-invoice-issued',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'invoice-issued-v2-routing',
          contains: [
            'invoice-issued-ledger:',
            'event: invoice.issued.v2',
            'invoice-issued-analytics:'
          ]
        }
      ]
    },
    {
      path: 'infra/queues.yaml',
      before: [
        'queues:',
        '  invoice-events:',
        '    retentionDays: 7',
        ''
      ].join('\n'),
      after: [
        'queues:',
        '  invoice-events:',
        '    retentionDays: 10',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'invoice-queue-retention-tuning',
          contains: 'retentionDays: 10'
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'upgrade-invoice-issued-event',
      chunks: [
        'invoice-issued-v1-contract-deletion',
        'invoice-issued-v2-contract-addition',
        'invoice-issued-v2-producer',
        'invoice-issued-v2-ledger-consumer',
        'invoice-issued-v2-analytics-consumer',
        'invoice-issued-v2-routing'
      ]
    },
    {
      id: 'invoice-queue-retention',
      chunks: ['invoice-queue-retention-tuning']
    }
  ]
});
