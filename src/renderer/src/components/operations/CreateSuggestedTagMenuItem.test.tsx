import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { CreateSuggestedTagMenuItem } from './CreateSuggestedTagMenuItem';

describe('CreateSuggestedTagMenuItem', () => {
  it('renders the suggested tag name in the one-click create-and-push action', () => {
    const markup = renderToStaticMarkup(
      <CreateSuggestedTagMenuItem
        suggestedTagName="v2026.8.12"
        isOperationBusy={false}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(markup).toContain('Create v2026.8.12 tag and push');
    expect(markup).toContain('role="menuitem"');
    expect(markup).not.toContain('disabled=""');
  });

  it('does not render when no tag can be suggested', () => {
    const markup = renderToStaticMarkup(
      <CreateSuggestedTagMenuItem
        isOperationBusy={false}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(markup).toBe('');
  });

  it('disables the action while another repository operation is running', () => {
    const markup = renderToStaticMarkup(
      <CreateSuggestedTagMenuItem
        suggestedTagName="v2026.8.12"
        isOperationBusy
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(markup).toContain('disabled=""');
  });
});
