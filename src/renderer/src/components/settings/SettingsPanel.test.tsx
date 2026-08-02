import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { createDefaultAppSettings } from '@shared/settings';

import { SettingsPanel } from './SettingsPanel';

describe('SettingsPanel', () => {
  it('explains the configurable auto-fetch interval and safe fetch-only behavior', () => {
    const markup = renderToStaticMarkup(
      <SettingsPanel
        settings={createDefaultAppSettings()}
        isSaving={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );

    expect(markup).toContain('Auto-fetch interval (minutes)');
    expect(markup).toContain('min="0"');
    expect(markup).toContain('max="60"');
    expect(markup).toContain('value="1"');
    expect(markup).toContain('This never pulls or changes working files.');
  });
});
