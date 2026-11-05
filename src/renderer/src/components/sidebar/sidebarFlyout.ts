const MODAL_SELECTOR = '[role="dialog"], [role="alertdialog"]';

/** The context menu and any modal above the flyout take Escape first. */
export function isFlyoutEscape(
  event: Pick<KeyboardEvent, 'key' | 'isComposing' | 'target'>,
  hasOpenContextMenu: boolean
): boolean {
  if (event.key !== 'Escape' || event.isComposing || hasOpenContextMenu) {
    return false;
  }

  const target = event.target as Partial<Element> | null;
  return !target?.closest?.(MODAL_SELECTOR);
}

/** Falls back to the rail toggle when the remembered element is gone or held no real focus. */
export function flyoutReturnFocusTarget<T extends { isConnected: boolean }>(
  remembered: T | null,
  body: T,
  railToggle: T | null
): T | null {
  return remembered && remembered !== body && remembered.isConnected ? remembered : railToggle;
}
