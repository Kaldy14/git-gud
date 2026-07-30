import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'asynchronous-export-job-flow',
  title: 'Synchronous export migrated to an asynchronous job workflow',
  description: 'The job model, enqueueing service, HTTP and GraphQL contracts, worker, and polling UI form one end-to-end workflow migration; an unrelated history-label edit stays separate.',
  tags: ['complex', 'graphql', 'async', 'queue', 'api-contract', 'frontend', 'cross-layer', 'typescript'],
  files: [
    {
      path: 'src/exports/export-job.ts',
      before: null,
      after: [
        'export type ExportJob = {',
        '  id: string;',
        '  status: "queued" | "running" | "complete" | "failed";',
        '  downloadUrl: string | null;',
        '};',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'export-job-domain-model',
          contains: [
            'export type ExportJob',
            '"queued" | "running" | "complete" | "failed"'
          ]
        }
      ]
    },
    {
      path: 'src/exports/request-export.ts',
      before: [
        'export async function requestExport(accountId: string) {',
        '  const archive = await buildExportArchive(accountId);',
        '  return objectStorage.put(archive);',
        '}',
        ''
      ].join('\n'),
      after: [
        'export async function requestExport(accountId: string): Promise<ExportJob> {',
        '  const job = await exportJobs.create({ accountId, status: "queued" });',
        '  await exportQueue.enqueue({ jobId: job.id, accountId });',
        '  return job;',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'export-job-enqueueing-service',
          contains: [
            'Promise<ExportJob>',
            'exportQueue.enqueue'
          ]
        }
      ]
    },
    {
      path: 'src/http/export-controller.ts',
      before: [
        'export async function createExport(request: Request) {',
        '  const downloadUrl = await requestExport(request.accountId);',
        '  return response.ok({ downloadUrl });',
        '}',
        ''
      ].join('\n'),
      after: [
        'export async function createExport(request: Request) {',
        '  const job = await requestExport(request.accountId);',
        '  return response.accepted({ jobId: job.id, status: job.status });',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'export-job-http-contract',
          contains: [
            'response.accepted',
            'jobId: job.id'
          ]
        }
      ]
    },
    {
      path: 'schema/export.graphql',
      before: [
        'extend type Mutation {',
        '  requestExport(accountId: ID!): Download!',
        '}',
        ''
      ].join('\n'),
      after: [
        'type ExportJob {',
        '  id: ID!',
        '  status: ExportJobStatus!',
        '  downloadUrl: String',
        '}',
        '',
        'extend type Mutation {',
        '  requestExport(accountId: ID!): ExportJob!',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'export-job-graphql-contract',
          contains: [
            'type ExportJob {',
            'requestExport(accountId: ID!): ExportJob!'
          ]
        }
      ]
    },
    {
      path: 'src/workers/run-export-job.ts',
      before: null,
      after: [
        'export async function runExportJob(message: ExportJobMessage) {',
        '  await exportJobs.markRunning(message.jobId);',
        '  const archive = await buildExportArchive(message.accountId);',
        '  const downloadUrl = await objectStorage.put(archive);',
        '  await exportJobs.markComplete(message.jobId, downloadUrl);',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'export-job-worker',
          contains: [
            'export async function runExportJob',
            'exportJobs.markComplete'
          ]
        }
      ]
    },
    {
      path: 'src/web/export-button.tsx',
      before: [
        'export function ExportButton({ accountId }: Props) {',
        '  const download = useRequestExport();',
        '',
        '  return <Button onClick={() => download.mutate(accountId)}>Download export</Button>;',
        '}',
        ''
      ].join('\n'),
      after: [
        'export function ExportButton({ accountId }: Props) {',
        '  const request = useRequestExport();',
        '  const job = useExportJob(request.data?.id);',
        '',
        '  if (job.data?.status === "complete") {',
        '    return <DownloadLink href={job.data.downloadUrl}>Download export</DownloadLink>;',
        '  }',
        '',
        '  return <Button loading={job.isPolling} onClick={() => request.mutate(accountId)}>Prepare export</Button>;',
        '}',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'export-job-polling-ui',
          contains: [
            'useExportJob(request.data?.id)',
            'loading={job.isPolling}'
          ]
        }
      ]
    },
    {
      path: 'src/web/export-history.tsx',
      before: '<EmptyState title="No downloads yet" />\n',
      after: '<EmptyState title="No exports yet" />\n',
      hunks: [
        {
          id: 'export-history-empty-copy',
          contains: 'title="No exports yet"'
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'migrate-to-export-jobs',
      chunks: [
        'export-job-domain-model',
        'export-job-enqueueing-service',
        'export-job-http-contract',
        'export-job-graphql-contract',
        'export-job-worker',
        'export-job-polling-ui'
      ]
    },
    {
      id: 'export-history-copy',
      chunks: ['export-history-empty-copy']
    }
  ]
});
