import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ApplicationUpdateButton, StatusBar } from './StatusBar';

describe('StatusBar', () => {
  it('keeps a global footer visible without an active repository', () => {
    const markup = renderToStaticMarkup(
      <StatusBar isRepositoryLoading={false} isRepositoryRefreshing={false} />
    );

    expect(markup).toContain('Git Gud');
    expect(markup).toContain('<footer');
  });

  it('quietly shows a running automatic operation', () => {
    const markup = renderStatusBar({
      backgroundOperation: { id: 'auto', label: 'Auto-fetch', status: 'pending' }
    });

    expect(markup).toContain('data-background-operation-status="pending"');
    expect(markup).toContain('Auto-fetch…');
    expect(markup).toContain('animate-spin');
    expect(markup).not.toContain('role="status"');
  });

  it('shows automatic operation outcomes with semantic icons and detail titles', () => {
    const success = renderStatusBar({
      backgroundOperation: { id: 'auto', label: 'Auto-fetch', status: 'success' }
    });
    const failure = renderStatusBar({
      backgroundOperation: {
        id: 'auto',
        label: 'Auto-fetch',
        status: 'error',
        detail: 'fatal: unable to access origin'
      }
    });
    const cancelled = renderStatusBar({
      backgroundOperation: { id: 'auto', label: 'Auto-fetch', status: 'cancelled' }
    });

    expect(success).toContain('Auto-fetch complete');
    expect(success).toContain('text-[var(--success-text)]');
    expect(failure).toContain('Auto-fetch failed');
    expect(failure).toContain('text-[var(--danger-text)]');
    expect(failure).toContain('fatal: unable to access origin');
    expect(failure).toContain('role="status"');
    expect(cancelled).toContain('Auto-fetch cancelled');
    expect(cancelled).toContain('data-background-operation-status="cancelled"');
  });

  it('gives foreground progress priority over automatic operations', () => {
    const markup = renderStatusBar({
      activeOperation: { label: 'Push main', phase: 'running' },
      backgroundOperation: { id: 'auto', label: 'Auto-fetch', status: 'pending' }
    });

    expect(markup).toContain('Push main…');
    expect(markup).not.toContain('Auto-fetch');
  });

  it('does not duplicate a running automatic operation with a refresh label', () => {
    const markup = renderStatusBar({
      isRepositoryRefreshing: true,
      backgroundOperation: { id: 'auto', label: 'Auto-fetch', status: 'pending' }
    });

    expect(markup).not.toContain('Refreshing repository…');
    expect(markup.match(/>Auto-fetch…</g)).toHaveLength(1);
  });
});

function renderStatusBar(props: Partial<Parameters<typeof StatusBar>[0]>): string {
  return renderToStaticMarkup(
    <StatusBar isRepositoryLoading={false} isRepositoryRefreshing={false} {...props} />
  );
}

describe('ApplicationUpdateButton', () => {
  it('stays hidden while the updater is idle', () => {
    expect(
      renderToStaticMarkup(
        <ApplicationUpdateButton
          state={{ status: 'idle' }}
          isApplying={false}
          onUpdate={vi.fn()}
        />
      )
    ).toBe('');
  });

  it('shows quiet progress while checking or downloading', () => {
    const checkingMarkup = renderToStaticMarkup(
      <ApplicationUpdateButton
        state={{ status: 'checking' }}
        isApplying={false}
        onUpdate={vi.fn()}
      />
    );
    const downloadingMarkup = renderToStaticMarkup(
      <ApplicationUpdateButton
        state={{ status: 'downloading', releaseName: 'Git Gud v0.4.21' }}
        isApplying={false}
        onUpdate={vi.fn()}
      />
    );

    expect(checkingMarkup).toContain('Checking for update…');
    expect(checkingMarkup).toContain('role="status"');
    expect(downloadingMarkup).toContain('Downloading update…');
  });

  it('briefly confirms when Git Gud is up to date', () => {
    const markup = renderToStaticMarkup(
      <ApplicationUpdateButton
        state={{ status: 'up-to-date', message: 'Git Gud 0.4.21 is up to date.' }}
        isApplying={false}
        onUpdate={vi.fn()}
      />
    );

    expect(markup).toContain('Up to date');
    expect(markup).toContain('Git Gud 0.4.21 is up to date.');
  });

  it('uses direct labels for restart, manual download, and retry actions', () => {
    const cases = [
      {
        state: { status: 'downloaded', releaseName: 'Git Gud v0.4.21' } as const,
        label: 'Restart to update'
      },
      {
        state: {
          status: 'manual-update-required',
          message: 'Download the latest release.'
        } as const,
        label: 'Download latest release'
      },
      {
        state: { status: 'error', message: 'Check your connection, then retry.' } as const,
        label: 'Update failed · Retry'
      }
    ];

    for (const { state, label } of cases) {
      const markup = renderToStaticMarkup(
        <ApplicationUpdateButton state={state} isApplying={false} onUpdate={vi.fn()} />
      );

      expect(markup).toContain(label);
      expect(markup).not.toContain('disabled=""');
    }
  });
});
