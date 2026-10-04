import { describe, expect, it } from 'vitest';

import type { OperationLogEntry } from '@renderer/components/operations/OperationLog';

import { selectBackgroundOperationStatus } from './backgroundOperationStatus';

describe('selectBackgroundOperationStatus', () => {
  it('scopes automatic operations to the active repository and ignores foreground entries', () => {
    const entries = [
      createEntry({ id: 'other', repoPath: '/other', status: 'pending' }),
      createEntry({ id: 'manual', status: 'pending', background: false })
    ];

    expect(selectBackgroundOperationStatus(entries, '/repo')).toBeUndefined();
    expect(selectBackgroundOperationStatus(entries, undefined)).toBeUndefined();
  });

  it('prefers a running automatic operation over terminal history', () => {
    const entries = [
      createEntry({ id: 'done', status: 'error', happenedAt: '2026-10-04T10:00:05.000Z' }),
      createEntry({ id: 'running', status: 'pending', happenedAt: '2026-10-04T10:00:01.000Z' })
    ];

    expect(selectBackgroundOperationStatus(entries, '/repo')).toMatchObject({ id: 'running', status: 'pending' });
  });

  it('falls back to the most recent terminal automatic operation', () => {
    const entries = [
      createEntry({ id: 'older', status: 'error', happenedAt: '2026-10-04T10:00:01.000Z' }),
      createEntry({ id: 'newer', status: 'success', happenedAt: '2026-10-04T10:00:05.000Z', detail: 'ok' })
    ];

    expect(selectBackgroundOperationStatus(entries, '/repo')).toEqual({
      id: 'newer',
      label: 'Auto-fetch',
      status: 'success',
      detail: 'ok'
    });
  });
});

function createEntry(overrides: Partial<OperationLogEntry>): OperationLogEntry {
  return {
    id: 'entry',
    repoPath: '/repo',
    label: 'Auto-fetch',
    status: 'pending',
    startedAt: '2026-10-04T10:00:00.000Z',
    happenedAt: '2026-10-04T10:00:00.000Z',
    background: true,
    ...overrides
  };
}
