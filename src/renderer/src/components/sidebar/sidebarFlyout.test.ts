import { describe, expect, it } from 'vitest';

import { flyoutReturnFocusTarget, isFlyoutEscape } from './sidebarFlyout';

function keyEvent(key: string, target: unknown = null, isComposing = false) {
  return { key, target, isComposing } as Pick<KeyboardEvent, 'key' | 'isComposing' | 'target'>;
}

describe('flyout Escape', () => {
  it('closes the flyout from anywhere outside a modal', () => {
    expect(isFlyoutEscape(keyEvent('Escape', { closest: () => null }), false)).toBe(true);
    expect(isFlyoutEscape(keyEvent('Escape', {}), false)).toBe(true);
    expect(isFlyoutEscape(keyEvent('Escape'), false)).toBe(true);
  });

  it('leaves Escape to an open context menu', () => {
    expect(isFlyoutEscape(keyEvent('Escape'), true)).toBe(false);
  });

  it('leaves Escape to a modal above the flyout', () => {
    expect(isFlyoutEscape(keyEvent('Escape', { closest: () => ({}) }), false)).toBe(false);
  });

  it('ignores other keys and Escape that cancels text composition', () => {
    expect(isFlyoutEscape(keyEvent('Enter'), false)).toBe(false);
    expect(isFlyoutEscape(keyEvent('Escape', null, true), false)).toBe(false);
  });
});

describe('flyout return focus', () => {
  const body = { isConnected: true };
  const railToggle = { isConnected: true };

  it('returns to the element focused before the flyout opened', () => {
    const canvas = { isConnected: true };

    expect(flyoutReturnFocusTarget(canvas, body, railToggle)).toBe(canvas);
  });

  it('falls back to the rail toggle', () => {
    expect(flyoutReturnFocusTarget({ isConnected: false }, body, railToggle)).toBe(railToggle);
    expect(flyoutReturnFocusTarget(body, body, railToggle)).toBe(railToggle);
    expect(flyoutReturnFocusTarget(null, body, railToggle)).toBe(railToggle);
  });
});
