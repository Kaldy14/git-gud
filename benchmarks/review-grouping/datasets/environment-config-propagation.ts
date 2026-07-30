import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'environment-config-propagation',
  title: 'Environment setting propagated to runtime behavior',
  description: 'An environment variable example, validation, runtime mapping, and HTTP client usage form one deployable change; an unrelated documentation edit stays separate.',
  tags: ['configuration', 'environment', 'non-code', 'cross-file', 'typescript'],
  files: [
    {
      path: '.env.example',
      before: [
        'API_URL=https://api.example.test',
        'LOG_LEVEL=info',
        ''
      ].join('\n'),
      after: [
        'API_URL=https://api.example.test',
        'LOG_LEVEL=info',
        'REQUEST_TIMEOUT_MS=8000',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'request-timeout-env-example',
          contains: 'REQUEST_TIMEOUT_MS=8000'
        }
      ]
    },
    {
      path: 'src/config/schema.ts',
      before: [
        'export const environmentSchema = z.object({',
        '  API_URL: z.string().url(),',
        '  LOG_LEVEL: z.enum(["debug", "info", "warn"])',
        '});',
        ''
      ].join('\n'),
      after: [
        'export const environmentSchema = z.object({',
        '  API_URL: z.string().url(),',
        '  LOG_LEVEL: z.enum(["debug", "info", "warn"]),',
        '  REQUEST_TIMEOUT_MS: z.coerce.number().positive()',
        '});',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'request-timeout-validation',
          contains: 'REQUEST_TIMEOUT_MS: z.coerce.number().positive()'
        }
      ]
    },
    {
      path: 'src/config/runtime.ts',
      before: [
        'export const runtimeConfig = {',
        '  apiUrl: environment.API_URL,',
        '  logLevel: environment.LOG_LEVEL',
        '};',
        ''
      ].join('\n'),
      after: [
        'export const runtimeConfig = {',
        '  apiUrl: environment.API_URL,',
        '  logLevel: environment.LOG_LEVEL,',
        '  requestTimeoutMs: environment.REQUEST_TIMEOUT_MS',
        '};',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'request-timeout-runtime-mapping',
          contains: 'requestTimeoutMs: environment.REQUEST_TIMEOUT_MS'
        }
      ]
    },
    {
      path: 'src/http/client.ts',
      before: [
        'export const httpClient = createClient({',
        '  baseUrl: runtimeConfig.apiUrl',
        '});',
        ''
      ].join('\n'),
      after: [
        'export const httpClient = createClient({',
        '  baseUrl: runtimeConfig.apiUrl,',
        '  timeout: runtimeConfig.requestTimeoutMs',
        '});',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'request-timeout-client-usage',
          contains: 'timeout: runtimeConfig.requestTimeoutMs'
        }
      ]
    },
    {
      path: 'README.md',
      before: 'Run the service locally with the development command.\n',
      after: 'Run the service locally using the development command.\n',
      hunks: [
        {
          id: 'readme-wording',
          contains: 'locally using the development command'
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'request-timeout-config',
      chunks: [
        'request-timeout-env-example',
        'request-timeout-validation',
        'request-timeout-runtime-mapping',
        'request-timeout-client-usage'
      ]
    },
    {
      id: 'readme-copy-edit',
      chunks: ['readme-wording']
    }
  ]
});
