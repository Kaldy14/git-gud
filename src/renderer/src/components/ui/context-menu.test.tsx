import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ContextMenuSeparator, ContextMenuSurface } from './context-menu';

describe('ContextMenuSurface', () => {
  it('renders the shared surface and separator styling hooks without changing menu semantics', () => {
    const markup = renderToStaticMarkup(
      <ContextMenuSurface role="menu" aria-label="Commit actions" className="custom-menu">
        <button className="menu-row" role="menuitem">
          Checkout commit
        </button>
        <ContextMenuSeparator />
      </ContextMenuSurface>
    );

    expect(markup).toContain('data-slot="context-menu-content"');
    expect(markup).toContain('class="context-menu-surface custom-menu"');
    expect(markup).toContain('role="menu"');
    expect(markup).toContain('role="menuitem"');
    expect(markup).toContain('data-slot="context-menu-separator"');
    expect(markup).toContain('role="separator"');
  });
});
