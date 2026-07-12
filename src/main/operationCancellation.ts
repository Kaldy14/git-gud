import type { GitOperationCancellationResult } from '@shared/types';

export type CancellableTrackedOperation = {
  operationId: string;
  repoPath: string;
  label: string;
  cancellable: boolean;
  cancelRequested: boolean;
};

export function requestOperationCancellation(
  operation: CancellableTrackedOperation | undefined,
  repoPath: string,
  operationId: string,
  cancelOperation: (operationId: string) => boolean
): GitOperationCancellationResult {
  if (!operation) {
    return {
      repoPath,
      cancelled: false,
      message: 'No Git operation is currently running for this repository.'
    };
  }

  if (operation.operationId !== operationId || operation.repoPath !== repoPath) {
    return {
      repoPath,
      cancelled: false,
      message: 'That Git operation is no longer active for this repository.'
    };
  }

  if (!operation.cancellable) {
    return {
      repoPath,
      cancelled: false,
      message: `${operation.label} cannot be cancelled safely after it starts.`
    };
  }

  const cancelled = cancelOperation(operation.operationId);
  operation.cancelRequested = cancelled;

  return {
    repoPath,
    cancelled,
    message: cancelled ? `Cancelling ${operation.label}.` : `${operation.label} is no longer cancellable.`
  };
}
