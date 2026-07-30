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
});

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
          message: 'Download the signed release once.'
        } as const,
        label: 'Get signed release'
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
