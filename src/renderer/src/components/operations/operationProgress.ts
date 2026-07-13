import type { OperationLogEntry } from './OperationLog';
import type { GitOperationProgressEvent } from '@shared/types';

type OptimisticOperationInput = {
  id: string;
  repoPath: string;
  label: string;
  happenedAt: string;
  retryable: boolean;
};

export function createOptimisticOperationEntry(input: OptimisticOperationInput): OperationLogEntry {
  return {
    id: input.id,
    repoPath: input.repoPath,
    label: input.label,
    status: 'pending',
    phase: 'queued',
    startedAt: input.happenedAt,
    happenedAt: input.happenedAt,
    canRetry: input.retryable,
    waitsForRefresh: true
  };
}

export function applyOperationProgress(
  entries: OperationLogEntry[],
  event: GitOperationProgressEvent
): OperationLogEntry[] {
  const correlatedIndex = entries.findIndex((entry) => entry.operationId === event.operationId);
  const uncorrelatedCandidates = entries
    .map((entry, index) => ({ entry, index }))
    .filter(
      ({ entry }) =>
        !entry.operationId && entry.status === 'pending' && entry.repoPath === event.repoPath
    );
  const entryIndex =
    correlatedIndex >= 0
      ? correlatedIndex
      : uncorrelatedCandidates.length === 1
        ? (uncorrelatedCandidates[0]?.index ?? -1)
        : -1;

  if (entryIndex < 0) {
    if (event.phase !== 'queued') {
      return entries;
    }

    return [
      {
        id: event.operationId,
        operationId: event.operationId,
        repoPath: event.repoPath,
        label: event.label,
        status: 'pending',
        phase: event.phase,
        startedAt: event.happenedAt,
        happenedAt: event.happenedAt,
        elapsedMs: event.elapsedMs,
        cancellable: event.cancellable
      },
      ...entries
    ];
  }

  const entry = entries[entryIndex];

  if (!entry) {
    return entries;
  }

  const backendCompletedBeforeRefresh = event.phase === 'completed' && entry.waitsForRefresh;
  const status =
    event.phase === 'failed'
      ? 'error'
      : event.phase === 'cancelled'
        ? 'cancelled'
        : event.phase === 'completed'
          ? backendCompletedBeforeRefresh
            ? 'pending'
            : 'success'
          : entry.status;
  const nextEntry: OperationLogEntry = {
    ...entry,
    operationId: event.operationId,
    label: entry.label || event.label,
    status,
    phase: backendCompletedBeforeRefresh ? 'refreshing' : event.phase,
    detail: backendCompletedBeforeRefresh
      ? 'Updating repository data…'
      : event.message?.slice(0, 4000) ?? entry.detail,
    happenedAt: event.happenedAt,
    elapsedMs: event.elapsedMs,
    cancellable: event.cancellable && event.phase !== 'completed',
    waitsForRefresh:
      event.phase === 'failed' || event.phase === 'cancelled' ? false : entry.waitsForRefresh
  };

  return entries.map((candidate, index) => (index === entryIndex ? nextEntry : candidate));
}

export function applyOperationFailure(
  entries: OperationLogEntry[],
  entryId: string,
  detail: string,
  happenedAt: string
): OperationLogEntry[] {
  return entries.map((entry) => {
    if (entry.id !== entryId || entry.status === 'cancelled') {
      return entry;
    }

    return {
      ...entry,
      status: 'error',
      detail,
      happenedAt,
      waitsForRefresh: false
    };
  });
}
