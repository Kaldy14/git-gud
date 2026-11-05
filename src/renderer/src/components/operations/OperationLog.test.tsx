import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { OperationLog, type OperationLogEntry } from './OperationLog';
import { applyOperationFailure, applyOperationProgress, operationAutoDismisses, operationEarnsCard } from './operationProgress';

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

describe('pull recovery card', () => {
  const rawError = 'error: Your local changes to the following files would be overwritten by merge:\n\tsrc/app.ts\nAborting';
  const recovery = { repoPath: '/repo', repoName: 'repo', branchName: 'main', upstream: 'origin/main', mode: 'ff-only' as const };
  const blockedPull: OperationLogEntry = {
    ...createEntry('error'),
    label: 'Pull main',
    detail: rawError,
    summary: 'main in repo was not updated. Local changes to src/app.ts would be overwritten.',
    persistent: true,
    recovery
  };

  it('offers every recovery with the raw error behind details and Copy', () => {
    const markup = renderOperationLog([blockedPull]);

    expect(markup).toContain('Review changes');
    expect(markup).toContain('Stash and retry pull');
    expect(markup).toContain('Reset local main to origin/main');
    expect(markup).toContain('<details');
    expect(markup).toContain('Error details');
    expect(markup).toContain('Copy');
    expect(markup).toContain('src/app.ts');
    expect(markup).not.toContain('max-h-12');
  });

  it('leaves reset out when the branch has no upstream', () => {
    const markup = renderOperationLog([{ ...blockedPull, recovery: { ...recovery, upstream: undefined } }]);

    expect(markup).toContain('Stash and retry pull');
    expect(markup).not.toContain('Reset local');
  });

  it('gives an unrelated error no recovery actions', () => {
    const markup = renderOperationLog([{ ...createEntry('error'), label: 'Pull main', detail: 'fatal: unable to access remote' }]);

    expect(markup).toContain('Copy');
    expect(markup).not.toContain('Stash and retry pull');
    expect(markup).not.toContain('Review changes');
    expect(markup).not.toContain('Reset local');
  });

  it('disables recovery for the card repository while keeping Copy and dismiss', () => {
    const isUnavailable = vi.fn((repoPath: string) => repoPath === '/repo');
    const markup = renderOperationLog([blockedPull], isUnavailable);

    expect(isUnavailable).toHaveBeenCalledWith('/repo');
    expect(markup.match(/<button[^>]*disabled=""/g)).toHaveLength(3);
    expect(markup).toContain('Dismiss Pull main');
  });

  it('keeps a persistent card past the auto-dismiss window', () => {
    expect(operationAutoDismisses(blockedPull)).toBe(false);
    expect(operationAutoDismisses({ ...createEntry('error'), detail: 'fatal: nope' })).toBe(true);
    expect(operationAutoDismisses(createEntry('success'))).toBe(true);
    expect(operationAutoDismisses(createEntry('pending'))).toBe(false);
  });

  it('stores the failure state and keeps it through a late progress event', () => {
    const failed = applyOperationFailure(
      [{ ...createEntry('pending'), operationId: 'op' }],
      'pending',
      rawError,
      '2026-08-07T10:00:02.000Z',
      { summary: 'Blocked.', persistent: true, recovery }
    );
    const [entry] = applyOperationProgress(failed, {
      operationId: 'op',
      repoPath: '/repo',
      label: 'Pull main',
      phase: 'failed',
      message: rawError,
      happenedAt: '2026-08-07T10:00:03.000Z',
      elapsedMs: 10,
      cancellable: false
    } as never);

    expect(entry).toMatchObject({ status: 'error', summary: 'Blocked.', persistent: true, recovery });
  });

  it('does not turn a cancelled pull into a recovery', () => {
    const [entry] = applyOperationFailure([createEntry('cancelled')], 'cancelled', rawError, 'now', {
      persistent: true,
      recovery
    });

    expect(entry?.recovery).toBeUndefined();
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

function renderOperationLog(
  operationEntries: OperationLogEntry[],
  isRecoveryUnavailable: (repoPath: string) => boolean = () => false
): string {
  return renderToStaticMarkup(
    <OperationLog
      entries={operationEntries}
      onDismiss={vi.fn()}
      onCancel={vi.fn()}
      onRetry={vi.fn()}
      onCopyDetails={vi.fn()}
      onReviewChanges={vi.fn()}
      onStashAndRetryPull={vi.fn()}
      onResetLocalBranch={vi.fn()}
      isRecoveryUnavailable={isRecoveryUnavailable}
    />
  );
}
