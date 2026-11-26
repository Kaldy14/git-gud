import { describe, expect, it } from 'vitest';

import { hasOpenOverlay, workspaceCommand } from './pullRequestWorkspaceKeys';

// A fake element: `closest` matches when the selector names one of `ancestors`.
function element(tagName = 'DIV', ancestors: string[] = ['data-pull-request-workspace']): EventTarget {
  return {
    tagName,
    isContentEditable: false,
    closest: (selector: string) => (ancestors.some((ancestor) => selector.includes(ancestor)) ? {} : null)
  } as unknown as EventTarget;
}

function key(value: string, init: Partial<KeyboardEvent> = {}) {
  return {
    key: value,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    defaultPrevented: false,
    isComposing: false,
    target: element(),
    getModifierState: () => false,
    ...init
  };
}

const ready = { singleKeyEnabled: true, overlayOpen: false, mac: false };

describe('workspace keyboard dispatcher', () => {
  it('maps the workspace keys', () => {
    expect(workspaceCommand(key('j'), ready)).toBe('next');
    expect(workspaceCommand(key('k'), ready)).toBe('previous');
    expect(workspaceCommand(key('h'), ready)).toBe('previous-tab');
    expect(workspaceCommand(key('l'), ready)).toBe('next-tab');
    expect(workspaceCommand(key('/'), ready)).toBe('search');
    expect(workspaceCommand(key('?', { shiftKey: true }), ready)).toBe('help');
    expect(workspaceCommand(key('b', { ctrlKey: true }), ready)).toBe('toggle-rail');
    expect(workspaceCommand(key('b', { metaKey: true }), { ...ready, mac: true })).toBe('toggle-rail');
  });

  it('never handles a key another owner already handled', () => {
    expect(workspaceCommand(key('j', { defaultPrevented: true }), ready)).toBeUndefined();
    expect(workspaceCommand(key('b', { ctrlKey: true, defaultPrevented: true }), ready)).toBeUndefined();
  });

  it('stays quiet while a dialog or menu is open, or outside the workspace', () => {
    expect(workspaceCommand(key('j'), { ...ready, overlayOpen: true })).toBeUndefined();
    expect(workspaceCommand(key('b', { ctrlKey: true }), { ...ready, overlayOpen: true })).toBeUndefined();
    expect(workspaceCommand(key('j', { target: element('DIV', []) }), ready)).toBeUndefined();
  });

  it('ignores single keys typed into fields but keeps Mod+B', () => {
    expect(workspaceCommand(key('j', { target: element('TEXTAREA') }), ready)).toBeUndefined();
    expect(workspaceCommand(key('b', { ctrlKey: true, target: element('INPUT') }), ready)).toBe('toggle-rail');
  });

  it('turns single keys off with the WCAG 2.1.4 switch, but not Mod+B', () => {
    expect(workspaceCommand(key('j'), { ...ready, singleKeyEnabled: false })).toBeUndefined();
    expect(workspaceCommand(key('b', { ctrlKey: true }), { ...ready, singleKeyEnabled: false })).toBe('toggle-rail');
  });

  it('detects open overlays', () => {
    expect(hasOpenOverlay({ querySelector: () => null })).toBe(false);
    expect(hasOpenOverlay({ querySelector: (selector: string) => (selector.includes('role="menu"') ? ({} as Element) : null) })).toBe(true);
    // The bug scan replaces the tabs without being a dialog.
    expect(hasOpenOverlay({ querySelector: (selector: string) => (selector.includes('.bug-finder-view') ? ({} as Element) : null) })).toBe(true);
  });
});
