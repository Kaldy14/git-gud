import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ApplicationUpdateButton } from './StatusBar';

describe('ApplicationUpdateButton', () => {
  it('stays hidden until an update is available', () => {
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

  it('offers the update when it is available or downloaded', () => {
    for (const status of ['available', 'downloaded'] as const) {
      const markup = renderToStaticMarkup(
        <ApplicationUpdateButton
          state={{ status, releaseName: 'Git Gud v0.4.21' }}
          isApplying={false}
          onUpdate={vi.fn()}
        />
      );

      expect(markup).toContain('Update Git Gud');
      expect(markup).not.toContain('disabled=""');
    }
  });

  it('shows a disabled progress state while the update downloads', () => {
    const markup = renderToStaticMarkup(
      <ApplicationUpdateButton
        state={{ status: 'downloading', releaseName: 'Git Gud v0.4.21' }}
        isApplying={false}
        onUpdate={vi.fn()}
      />
    );

    expect(markup).toContain('Downloading update…');
    expect(markup).toContain('disabled=""');
  });
});
