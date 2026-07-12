import type { KeyboardEvent } from 'react';

export function handleMenuKeyDown(event: KeyboardEvent<HTMLElement>, onClose: () => void): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    onClose();
    return;
  }

  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    return;
  }

  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')
  ).filter((item) => item.offsetParent !== null);

  if (items.length === 0) {
    return;
  }

  const currentIndex = items.indexOf(document.activeElement as HTMLElement);
  let nextIndex = 0;

  if (event.key === 'ArrowDown') {
    nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
  } else if (event.key === 'ArrowUp') {
    nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
  } else if (event.key === 'End') {
    nextIndex = items.length - 1;
  }

  event.preventDefault();
  items[nextIndex]?.focus({ preventScroll: true });
}
