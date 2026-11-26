// Shared rules for the pull request workspace's single-key shortcuts. The workspace dispatcher,
// ReviewView and the Tour each own their keys but decide "may this event fire a shortcut?" here.

type ShortcutEvent = Pick<
  KeyboardEvent,
  'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'defaultPrevented' | 'isComposing' | 'target'
> & { getModifierState?: (key: string) => boolean };

const PUNCTUATION_KEYS = new Set(['[', ']', '/', '?']);
const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const BLOCKING_CONTAINERS = '[role="menu"], [role="dialog"], [role="listbox"]';

/**
 * The normalized key when `event` may trigger a single-key shortcut, otherwise undefined.
 * Letters come back lower-case and need no modifier at all. Punctuation is matched by `event.key`, so
 * layouts that type `[` or `/` with Shift, Option or AltGr (Czech) still work; Ctrl and Meta never do,
 * except the Ctrl+Alt that Windows reports for AltGr.
 */
export function pullRequestShortcutKey(event: ShortcutEvent): string | undefined {
  if (event.defaultPrevented || event.isComposing || isBlockedTarget(event.target)) return undefined;

  const { key } = event;
  const anyModifier = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
  if (key.length === 1 && /\p{L}/u.test(key)) return anyModifier ? undefined : key.toLowerCase();
  if (ARROW_KEYS.has(key)) return anyModifier ? undefined : key;
  if (PUNCTUATION_KEYS.has(key)) {
    const altGraph = event.getModifierState?.('AltGraph') === true;
    if (event.metaKey || (event.ctrlKey && !altGraph)) return undefined;
    return key;
  }
  return undefined;
}

/** Shortcuts only act while focus is inside the pull request workspace or nowhere in particular. */
export function isWithinPullRequestWorkspace(target: EventTarget | null): boolean {
  if (!isElement(target)) return false;
  if (typeof document !== 'undefined' && target === document.body) return true;
  return target.closest('[data-pull-request-workspace]') !== null;
}

/** Mod+B: Meta on macOS, Ctrl elsewhere, with no other modifier. */
export function isModB(event: ShortcutEvent, mac = isMacPlatform()): boolean {
  if (event.key.toLowerCase() !== 'b' || event.altKey || event.shiftKey) return false;
  return mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

// WCAG 2.1.4: single-key shortcuts can be turned off. Stored per device, on by default.
export const SINGLE_KEY_SHORTCUTS_STORAGE_KEY = 'git-gud:pr-single-key-shortcuts:v1';
const listeners = new Set<() => void>();
let enabledCache: boolean | undefined;

export function singleKeyShortcutsEnabled(): boolean {
  if (enabledCache === undefined) {
    try {
      enabledCache = globalThis.localStorage?.getItem(SINGLE_KEY_SHORTCUTS_STORAGE_KEY) !== 'false';
    } catch {
      enabledCache = true;
    }
  }
  return enabledCache;
}

export function setSingleKeyShortcutsEnabled(enabled: boolean): void {
  enabledCache = enabled;
  try {
    globalThis.localStorage?.setItem(SINGLE_KEY_SHORTCUTS_STORAGE_KEY, String(enabled));
  } catch {
    // Storage can be unavailable; the in-memory value still applies for this session.
  }
  for (const listener of listeners) listener();
}

/** For `useSyncExternalStore(subscribeSingleKeyShortcuts, singleKeyShortcutsEnabled)`. */
export function subscribeSingleKeyShortcuts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function isBlockedTarget(target: EventTarget | null): boolean {
  if (!isElement(target)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((target as Partial<HTMLElement>).isContentEditable) return true;
  return target.closest(BLOCKING_CONTAINERS) !== null;
}

// Duck-typed so the rules run without a DOM (tests) and across frames.
function isElement(target: EventTarget | null): target is Element {
  return typeof (target as Partial<Element> | null)?.closest === 'function';
}

function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);
}

// A shortcut that did something says so here; the shortcut bar lights its key cap. Call it from the place
// the action happens, so a refused or out-of-range key stays quiet.
const usedListeners = new Set<(chip: string) => void>();

/** `chip` is the key as the bar labels it (`J`, `←`, `[`, or `Mod` plus a letter joined as `Mod+B`). */
export function shortcutUsed(chip: string): void {
  for (const listener of usedListeners) listener(chip);
}

export function subscribeShortcutUsed(listener: (chip: string) => void): () => void {
  usedListeners.add(listener);
  return () => { usedListeners.delete(listener); };
}
