import { describe, expect, it } from 'vitest';

import type { GitOperationProgressEvent } from '@shared/types';

import type { OperationLogEntry } from './OperationLog';
import {
  applyOperationFailure,
  applyOperationProgress,
  createOptimisticOperationEntry
} from './operationProgress';

const queuedEvent: GitOperationProgressEvent = {
  operationId: 'operation-1',
  repoPath: '/repo',
  label: 'Fetch',
  phase: 'queued',
  elapsedMs: 0,
  cancellable: true,
  happenedAt: '2026-07-10T10:00:00.000Z'
};

describe('operation progress state', () => {
  it('only offers retry when an operation explicitly opts in', () => {
    const destructive = createOptimisticOperationEntry({
      id: 'drop-stash',
      repoPath: '/repo',
      label: 'Drop stash@{0}',
      happenedAt: queuedEvent.happenedAt,
      retryable: false
    });
    const safeFetch = createOptimisticOperationEntry({
      id: 'fetch',
      repoPath: '/repo',
      label: 'Fetch',
      happenedAt: queuedEvent.happenedAt,
      retryable: true
    });

    expect(destructive.canRetry).toBe(false);
    expect(safeFetch.canRetry).toBe(true);
  });

  it('creates an entry for operations started outside the workspace runner', () => {
    const entries = applyOperationProgress([], queuedEvent);

    expect(entries[0]).toMatchObject({
      operationId: 'operation-1',
      status: 'pending',
      cancellable: true
    });
  });

  it('reconciles backend progress with an optimistic client entry', () => {
    const optimistic: OperationLogEntry = {
      id: 'client-1',
      repoPath: '/repo',
      label: 'Fetch origin',
      status: 'pending',
      startedAt: queuedEvent.happenedAt,
      happenedAt: queuedEvent.happenedAt
    };
    const running = applyOperationProgress([optimistic], {
      ...queuedEvent,
      phase: 'output',
      elapsedMs: 1200,
      message: 'Receiving objects'
    });
    const completed = applyOperationProgress(running, {
      ...queuedEvent,
      phase: 'completed',
      elapsedMs: 2500
    });

    expect(running[0]).toMatchObject({
      id: 'client-1',
      operationId: 'operation-1',
      detail: 'Receiving objects'
    });
    expect(completed[0]?.status).toBe('success');
    expect(completed[0]?.cancellable).toBe(false);
  });

  it('marks cancellation distinctly from failure', () => {
    const entries = applyOperationProgress(applyOperationProgress([], queuedEvent), {
      ...queuedEvent,
      phase: 'cancelled',
      message: 'Fetch cancelled'
    });

    expect(entries[0]).toMatchObject({
      status: 'cancelled',
      detail: 'Fetch cancelled'
    });
  });

  it('does not let the rejected invoke overwrite a terminal cancellation event', () => {
    const cancelled = applyOperationProgress(applyOperationProgress([], queuedEvent), {
      ...queuedEvent,
      phase: 'cancelled',
      message: 'Fetch cancelled by user.'
    });
    const afterInvokeRejects = applyOperationFailure(
      cancelled,
      cancelled[0]?.id ?? '',
      'git fetch exited with code 1',
      '2026-07-10T10:00:02.000Z'
    );

    expect(afterInvokeRejects[0]).toMatchObject({
      status: 'cancelled',
      detail: 'Fetch cancelled by user.'
    });
  });

  it('does not bind a backend event to an ambiguous optimistic entry', () => {
    const pending = (id: string): OperationLogEntry => ({
      id,
      repoPath: '/repo',
      label: id,
      status: 'pending',
      startedAt: queuedEvent.happenedAt,
      happenedAt: queuedEvent.happenedAt
    });
    const entries = applyOperationProgress([pending('second'), pending('first')], queuedEvent);

    expect(entries[0]?.operationId).toBe('operation-1');
    expect(entries.slice(1).every((entry) => entry.operationId === undefined)).toBe(true);
  });
});
