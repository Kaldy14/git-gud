import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ChangelogDialog } from './ChangelogDialog';

describe('ChangelogDialog', () => {
  it('renders up to three bundled highlights for an unseen release', () => {
    const markup = renderToStaticMarkup(
      <ChangelogDialog
        releaseNotes={{
          version: '0.4.23',
          notes: [
            { category: 'Added', text: 'First change.' },
            { category: 'Changed', text: 'Second change.' },
            { category: 'Fixed', text: 'Third change.' },
            { category: 'Security', text: 'Fourth change.' }
          ]
        }}
        storage={{ getItem: () => null, setItem: vi.fn() }}
      />
    );

    expect(markup).toContain('Git Gud was updated');
    expect(markup).toContain('Version 0.4.23');
    expect(markup).toContain('First change.');
    expect(markup).toContain('Third change.');
    expect(markup).not.toContain('Fourth change.');
    expect(markup).toContain('1 more change in the full release notes.');
    expect(markup).toContain('data-modal-initial-focus="true"');
  });

  it('stays hidden after the release was acknowledged', () => {
    const markup = renderToStaticMarkup(
      <ChangelogDialog
        releaseNotes={{ version: '0.4.23', notes: [] }}
        storage={{ getItem: () => '0.4.23', setItem: vi.fn() }}
      />
    );

    expect(markup).toBe('');
  });
});
