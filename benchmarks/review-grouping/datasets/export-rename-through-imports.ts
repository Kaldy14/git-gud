import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'export-rename-through-imports',
  title: 'Export rename propagated through imports',
  description: 'Renaming an exported formatter belongs with import and call-site updates in multiple consumers.',
  tags: ['typescript', 'rename', 'cross-file', 'imports'],
  files: [
    {
      path: 'src/money/format.ts',
      before: [
        'export function formatMoney(amount: number, currency: string): string {',
        '  return new Intl.NumberFormat("en", { style: "currency", currency }).format(amount);',
        '}',
        ''
      ].join('\n'),
      after: [
        'export function formatCurrency(amount: number, currency: string): string {',
        '  return new Intl.NumberFormat("en", { style: "currency", currency }).format(amount);',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'formatter-export-rename',
          contains: 'export function formatCurrency('
        }
      ]
    },
    {
      path: 'src/invoices/render-invoice.ts',
      before: [
        'import { formatMoney } from "../money/format";',
        '',
        'export function renderInvoiceTotal(total: number): string {',
        '  return `Total: ${formatMoney(total, "USD")}`;',
        '}',
        ''
      ].join('\n'),
      after: [
        'import { formatCurrency } from "../money/format";',
        '',
        'export function renderInvoiceTotal(total: number): string {',
        '  return `Total: ${formatCurrency(total, "USD")}`;',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'invoice-formatter-import-and-call',
          contains: [
            'import { formatCurrency } from "../money/format";',
            'formatCurrency(total, "USD")'
          ]
        }
      ]
    },
    {
      path: 'src/reports/monthly-summary.ts',
      before: [
        'import { formatMoney } from "../money/format";',
        '',
        'export const monthlyRevenueLabel = (revenue: number) =>',
        '  formatMoney(revenue, "EUR");',
        ''
      ].join('\n'),
      after: [
        'import { formatCurrency } from "../money/format";',
        '',
        'export const monthlyRevenueLabel = (revenue: number) =>',
        '  formatCurrency(revenue, "EUR");',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'summary-formatter-import-and-call',
          contains: [
            'import { formatCurrency } from "../money/format";',
            'formatCurrency(revenue, "EUR")'
          ]
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'format-currency-rename',
      chunks: [
        'formatter-export-rename',
        'invoice-formatter-import-and-call',
        'summary-formatter-import-and-call'
      ]
    }
  ]
});
