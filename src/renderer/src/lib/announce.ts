import { useEffect, useRef } from 'react';

// One shared polite live region for background status changes (a guide finishing,
// a refresh failing). It is created on first use and mounted before any message,
// so screen readers register the region and then hear each update.
let region: HTMLElement | undefined;

export function announce(message: string): void {
  if (typeof document === 'undefined' || !message) return;
  if (!region?.isConnected) {
    region = document.createElement('div');
    region.className = 'sr-only';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.append(region);
  }
  const target = region;
  // Clearing first makes a repeated message announce again.
  target.textContent = '';
  window.setTimeout(() => { target.textContent = message; }, 50);
}

/** Announces `message` whenever `key` changes after the first render (undefined message = stay quiet). */
export function useAnnounceOnChange(key: string, message: string | undefined): void {
  const previous = useRef(key);
  useEffect(() => {
    if (previous.current === key) return;
    previous.current = key;
    if (message) announce(message);
  }, [key, message]);
}
