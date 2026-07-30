import { defineReviewGroupingDataset } from '../types';

export default defineReviewGroupingDataset({
  id: 'two-independent-features-cross-same-files',
  title: 'Independent features interleaved across the same files',
  description: 'Timeout and retry changes should form separate review units even though each touches the same config and implementation files.',
  tags: ['review-boundary', 'multi-feature', 'same-file', 'typescript'],
  files: [
    {
      path: 'src/config.ts',
      before: [
        'export const DEFAULT_TIMEOUT_MS = 5_000;',
        'export const USER_AGENT = "git-gud";',
        'export const API_VERSION = "2026-01";',
        'export const ENABLE_METRICS = true;',
        'export const HEALTH_PATH = "/health";',
        'export const MAX_CONNECTIONS = 20;',
        'export const KEEP_ALIVE_MS = 30_000;',
        'export const CACHE_TTL_MS = 60_000;',
        'export const LOG_SAMPLE_RATE = 0.1;',
        'export const CIRCUIT_BREAKER_LIMIT = 10;',
        'export const RETRY_JITTER_MS = 250;',
        'export const MAX_RETRY_ATTEMPTS = 2;',
        ''
      ].join('\n'),
      after: [
        'export const DEFAULT_TIMEOUT_MS = 8_000;',
        'export const USER_AGENT = "git-gud";',
        'export const API_VERSION = "2026-01";',
        'export const ENABLE_METRICS = true;',
        'export const HEALTH_PATH = "/health";',
        'export const MAX_CONNECTIONS = 20;',
        'export const KEEP_ALIVE_MS = 30_000;',
        'export const CACHE_TTL_MS = 60_000;',
        'export const LOG_SAMPLE_RATE = 0.1;',
        'export const CIRCUIT_BREAKER_LIMIT = 10;',
        'export const RETRY_JITTER_MS = 250;',
        'export const MAX_RETRY_ATTEMPTS = 4;',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'timeout-config',
          contains: 'DEFAULT_TIMEOUT_MS = 8_000'
        },
        {
          id: 'retry-config',
          contains: 'MAX_RETRY_ATTEMPTS = 4'
        }
      ]
    },
    {
      path: 'src/client.ts',
      before: [
        'import { DEFAULT_TIMEOUT_MS, MAX_RETRY_ATTEMPTS } from "./config";',
        '',
        'export const connect = () => open(DEFAULT_TIMEOUT_MS);',
        'const emitAttempt = () => metrics.increment("attempt");',
        'const recordLatency = () => metrics.timing("latency");',
        'const attachHeaders = () => ({ "x-client": "git-gud" });',
        'const parseResponse = (value: unknown) => value;',
        'const closeIdleSocket = () => sockets.closeIdle();',
        'const isTransient = (error: Error) => error.name === "TransientError";',
        'const backoff = (attempt: number) => attempt * 100;',
        'const reportFailure = (error: Error) => logger.error(error);',
        'const reportSuccess = () => logger.info("connected");',
        'const resetCircuit = () => circuit.reset();',
        '',
        'export const shouldRetry = (attempt: number) => attempt < MAX_RETRY_ATTEMPTS;',
        ''
      ].join('\n'),
      after: [
        'import { DEFAULT_TIMEOUT_MS, MAX_RETRY_ATTEMPTS } from "./config";',
        '',
        'export const connect = () => openWithTimeout(DEFAULT_TIMEOUT_MS);',
        'const emitAttempt = () => metrics.increment("attempt");',
        'const recordLatency = () => metrics.timing("latency");',
        'const attachHeaders = () => ({ "x-client": "git-gud" });',
        'const parseResponse = (value: unknown) => value;',
        'const closeIdleSocket = () => sockets.closeIdle();',
        'const isTransient = (error: Error) => error.name === "TransientError";',
        'const backoff = (attempt: number) => attempt * 100;',
        'const reportFailure = (error: Error) => logger.error(error);',
        'const reportSuccess = () => logger.info("connected");',
        'const resetCircuit = () => circuit.reset();',
        '',
        'export const shouldRetry = (attempt: number) => attempt <= MAX_RETRY_ATTEMPTS;',
        ''
      ].join('\n'),
      hunks: [
        {
          id: 'timeout-consumer',
          contains: 'openWithTimeout(DEFAULT_TIMEOUT_MS)'
        },
        {
          id: 'retry-consumer',
          contains: 'attempt <= MAX_RETRY_ATTEMPTS'
        }
      ]
    }
  ],
  expectedUnits: [
    {
      id: 'timeout-behavior',
      chunks: ['timeout-config', 'timeout-consumer']
    },
    {
      id: 'retry-behavior',
      chunks: ['retry-config', 'retry-consumer']
    }
  ]
});
