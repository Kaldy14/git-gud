import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { OperationLog, type OperationLogEntry } from './OperationLog';
import { operationEarnsCard } from './operationProgress';

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

describe('routine operation feedback', () => {
  const stage = (status: OperationLogEntry['status']): OperationLogEntry => ({ ...createEntry(status), label: 'Stage file' });
  const startedAt = Date.parse('2026-08-07T10:00:00.000Z');

  it('announces a routine success without drawing a card', () => {
    const markup = renderOperationLog([stage('success')]);

    expect(markup).toContain('Stage file: success');
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain('Dismiss Stage file');
    expect(markup).not.toContain('Copy');
  });

  it('still shows routine failures and conflicts with their actions', () => {
    for (const status of ['error', 'conflict', 'cancelled'] as const) {
      const markup = renderOperationLog([{ ...stage(status), detail: 'index.lock exists', canRetry: true }]);

      expect(markup).toContain('Dismiss Stage file');
      expect(markup).toContain('index.lock exists');
      expect(markup).toContain('Copy');
    }
  });

  it('keeps a routine success that has something to say', () => {
    expect(operationEarnsCard({ ...stage('success'), detail: 'Line endings normalized.' }, startedAt)).toBe(true);
  });

  it('reveals routine work only once it stalls', () => {
    expect(operationEarnsCard(stage('pending'), startedAt + 500)).toBe(false);
    expect(operationEarnsCard(stage('pending'), startedAt + 2_000)).toBe(true);
  });

  it('keeps a compact dismissible card for other successes without detail', () => {
    const markup = renderOperationLog([{ ...createEntry('success'), label: 'Push main' }]);

    expect(markup).toContain('Dismiss Push main');
    expect(markup).not.toContain('Copy');
    expect(markup).not.toContain('>success<');
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
