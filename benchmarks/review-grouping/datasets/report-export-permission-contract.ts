import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'report-export-permission-contract',
  title: 'Permission rename propagated from policy to GraphQL and UI',
  description: 'Renaming a report capability must keep policy configuration, server constants, authorization, GraphQL directives, and UI visibility together; an unrelated role-description edit stays separate.',
  tags: ['complex', 'permissions', 'graphql', 'configuration', 'frontend', 'cross-layer', 'typescript'],
  files: [
    {
      path: 'config/permissions.yaml',
      before: [
        'permissions:',
        '  - reports:view',
        '  - reports:download',
        '  - reports:schedule',
        ''
      ].join('\n'),
      after: [
        'permissions:',
        '  - reports:view',
        '  - reports:export',
        '  - reports:schedule',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'report-export-policy-name',
          contains: 'reports:export'
        }
      ]
    },
    {
      path: 'src/auth/permissions.ts',
      before: [
        'export const permissions = {',
        '  viewReports: "reports:view",',
        '  downloadReports: "reports:download",',
        '  scheduleReports: "reports:schedule"',
        '} as const;',
        ''
      ].join('\n'),
      after: [
        'export const permissions = {',
        '  viewReports: "reports:view",',
        '  exportReports: "reports:export",',
        '  scheduleReports: "reports:schedule"',
        '} as const;',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'report-export-permission-constant',
          contains: 'exportReports: "reports:export"'
        }
      ]
    },
    {
      path: 'src/reports/export-report.ts',
      before: [
        'export async function downloadReport(context: RequestContext, reportId: string) {',
        '  context.authorize(permissions.downloadReports);',
        '  return reports.render(reportId);',
        '}',
        ''
      ].join('\n'),
      after: [
        'export async function exportReport(context: RequestContext, reportId: string) {',
        '  context.authorize(permissions.exportReports);',
        '  return reports.render(reportId);',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'report-export-authorization',
          contains: [
            'export async function exportReport',
            'permissions.exportReports'
          ]
        }
      ]
    },
    {
      path: 'schema/report.graphql',
      before: [
        'extend type Mutation {',
        '  downloadReport(id: ID!): Download!',
        '    @requiresPermission(name: "reports:download")',
        '}',
        ''
      ].join('\n'),
      after: [
        'extend type Mutation {',
        '  exportReport(id: ID!): Download!',
        '    @requiresPermission(name: "reports:export")',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'report-export-graphql-contract',
          contains: [
            'exportReport(id: ID!)',
            '@requiresPermission(name: "reports:export")'
          ]
        }
      ]
    },
    {
      path: 'src/web/report-actions.tsx',
      before: [
        'export function ReportActions({ report, viewer }: Props) {',
        '  const canDownload = viewer.permissions.includes("reports:download");',
        '',
        '  return canDownload ? <DownloadReportButton report={report} /> : null;',
        '}',
        ''
      ].join('\n'),
      after: [
        'export function ReportActions({ report, viewer }: Props) {',
        '  const canExport = viewer.permissions.includes("reports:export");',
        '',
        '  return canExport ? <ExportReportButton report={report} /> : null;',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'report-export-ui-visibility',
          contains: [
            'includes("reports:export")',
            '<ExportReportButton'
          ]
        }
      ]
    },
    {
      path: 'config/roles.yaml',
      before: [
        'roles:',
        '  analyst:',
        '    description: Reviews the reports.',
        ''
      ].join('\n'),
      after: [
        'roles:',
        '  analyst:',
        '    description: Reviews reports.',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'analyst-role-description-copy',
          contains: 'description: Reviews reports.'
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'rename-report-export-permission',
      chunks: [
        'report-export-policy-name',
        'report-export-permission-constant',
        'report-export-authorization',
        'report-export-graphql-contract',
        'report-export-ui-visibility'
      ]
    },
    {
      id: 'analyst-role-copy-edit',
      chunks: ['analyst-role-description-copy']
    }
  ]
});
