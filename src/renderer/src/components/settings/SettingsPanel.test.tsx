import type { ReactElement } from 'react';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { createDefaultAppSettings } from '@shared/settings';

import { SettingsPanel } from './SettingsPanel';

function renderToStaticMarkup(element: ReactElement): string {
  return renderMarkup(<QueryClientProvider client={new QueryClient()}>{element}</QueryClientProvider>);
}

describe('SettingsPanel', () => {
  it('explains the configurable auto-fetch interval and safe fetch-only behavior', () => {
    const markup = renderToStaticMarkup(
      <SettingsPanel
        settings={createDefaultAppSettings()}
        isSaving={false}
        codexSkillState={{
          status: 'not-installed',
          installPath: '/Users/example/.agents/skills/git-gud-agent-notes'
        }}
        isCodexSkillBusy={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onInstallCodexSkill={vi.fn()}
        onRemoveCodexSkill={vi.fn()}
      />
    );

    expect(markup).toContain('Auto-fetch interval (minutes)');
    expect(markup).toContain('min="0"');
    expect(markup).toContain('max="60"');
    expect(markup).toContain('value="1"');
    expect(markup).toContain('This never pulls or changes working files.');
  });

  it('offers the global Codex skill without tying it to the Git Gud task launcher', () => {
    const markup = renderToStaticMarkup(
      <SettingsPanel
        settings={createDefaultAppSettings()}
        isSaving={false}
        codexSkillState={{
          status: 'installed',
          installPath: '/Users/example/.agents/skills/git-gud-agent-notes'
        }}
        isCodexSkillBusy={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onInstallCodexSkill={vi.fn()}
        onRemoveCodexSkill={vi.fn()}
      />
    );

    expect(markup).toContain('Agent Notes skill');
    expect(markup).toContain('Most tasks produce none.');
    expect(markup).toContain('tasks started anywhere');
    expect(markup).toContain('Installed');
    expect(markup).toContain('Remove skill');
  });

  it('explains that machines are view-only and looks for Tailscale devices', () => {
    const markup = renderToStaticMarkup(
      <SettingsPanel
        settings={createDefaultAppSettings()}
        isSaving={false}
        isCodexSkillBusy={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onInstallCodexSkill={vi.fn()}
        onRemoveCodexSkill={vi.fn()}
      />
    );

    expect(markup).toContain('Machines');
    expect(markup).toContain('it never changes anything there');
    expect(markup).toContain('Add from Tailscale');
    expect(markup).toContain('Looking for Tailscale');
  });
});
