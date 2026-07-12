import { describe, expect, it, vi } from 'vitest';

import { requestOperationCancellation, type CancellableTrackedOperation } from './operationCancellation';

function createOperation(): CancellableTrackedOperation {
  return {
    operationId: 'operation-current',
    repoPath: '/repo',
    label: 'Fetch',
    cancellable: true,
    cancelRequested: false
  };
}

describe('operation cancellation ownership', () => {
  it('only forwards cancellation for the exact active operation id', () => {
    const operation = createOperation();
    const cancel = vi.fn(() => true);

    const staleResult = requestOperationCancellation(operation, '/repo', 'operation-stale', cancel);

    expect(staleResult).toMatchObject({ cancelled: false });
    expect(operation.cancelRequested).toBe(false);
    expect(cancel).not.toHaveBeenCalled();

    const currentResult = requestOperationCancellation(operation, '/repo', 'operation-current', cancel);

    expect(currentResult).toMatchObject({ cancelled: true, message: 'Cancelling Fetch.' });
    expect(operation.cancelRequested).toBe(true);
    expect(cancel).toHaveBeenCalledExactlyOnceWith('operation-current');
  });

  it('does not mark an operation cancelled when the executor no longer owns it', () => {
    const operation = createOperation();

    const result = requestOperationCancellation(operation, '/repo', 'operation-current', () => false);

    expect(result).toMatchObject({ cancelled: false, message: 'Fetch is no longer cancellable.' });
    expect(operation.cancelRequested).toBe(false);
  });
});
