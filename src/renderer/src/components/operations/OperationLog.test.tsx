import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { OperationLog, type OperationLogEntry } from './OperationLog';

const entries: OperationLogEntry[] = [
  createEntry('pending'),
  createEntry('success'),
  createEntry('conflict'),
  createEntry('error'),
  createEntry('cancelled')
];

describe('OperationLog', () => {
  it('positions operation cards in the bottom-left corner', () => {
    const markup = renderOperationLog(entries.slice(0, 1));

    expect(markup).toContain('fixed bottom-8 left-4');
    expect(markup).not.toContain('fixed bottom-8 right-4');
  });

  it('shows a semantic status stripe on every operation card', () => {
    const markup = renderOperationLog(entries);

    expect(markup).toContain('bg-[var(--accent-2)]');
    expect(markup).toContain('bg-[var(--success-text)]');
    expect(markup).toContain('bg-[var(--warning-text)]');
    expect(markup).toContain('bg-[var(--danger-text)]');
    expect(markup).toContain('bg-[var(--text-3)]');
  });

  it('renders no card or announcement for background-only entries', () => {
    const backgroundEntries = (['pending', 'success', 'error', 'cancelled'] as const).map((status) => ({
      ...createEntry(status),
      label: `Auto-fetch ${status}`,
      background: true
    }));

    expect(renderOperationLog(backgroundEntries)).toBe('');
  });

  it('keeps foreground cards and announcements when background entries are mixed in', () => {
    const markup = renderOperationLog([
      { ...createEntry('pending'), id: 'auto', label: 'Auto-fetch', background: true },
      { ...createEntry('error'), id: 'auto-error', label: 'Auto-fetch failed', background: true },
      { ...createEntry('success'), label: 'Push main' }
    ]);

    expect(markup).toContain('Push main');
    expect(markup).toContain('Push main: success');
    expect(markup).not.toContain('Auto-fetch');
  });
});

function createEntry(status: OperationLogEntry['status']): OperationLogEntry {
  return {
    id: status,
    repoPath: '/repo',
    label: `${status} operation`,
    status,
    startedAt: '2026-08-07T10:00:00.000Z',
    happenedAt: '2026-08-07T10:00:01.000Z'
  };
}

function renderOperationLog(operationEntries: OperationLogEntry[]): string {
  return renderToStaticMarkup(
    <OperationLog
      entries={operationEntries}
      onDismiss={vi.fn()}
      onCancel={vi.fn()}
      onRetry={vi.fn()}
      onCopyDetails={vi.fn()}
    />
  );
}
