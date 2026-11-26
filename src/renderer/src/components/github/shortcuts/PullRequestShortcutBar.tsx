import { useEffect, useId, useRef, useSyncExternalStore, type ReactElement } from 'react';
import { Keyboard, X } from 'lucide-react';

import { ModalSurface } from '@renderer/components/accessibility/ModalSurface';
import { EASE_OUT, prefersReducedMotion } from '@renderer/lib/motion';
import type { PullRequestDetailTab } from '../pullRequestDetailTab';
import {
  isMacPlatform,
  setShortcutBarVisible,
  shortcutBarItems,
  shortcutBarVisible,
  shortcutDialogSections,
  shortcutKeyLabel,
  subscribeShortcutBar,
  type PullRequestShortcut
} from './pullRequestShortcutList';
import { setSingleKeyShortcutsEnabled, singleKeyShortcutsEnabled, subscribeShortcutUsed, subscribeSingleKeyShortcuts } from './pullRequestShortcuts';

// Lit and dipped by a pixel, then back to rest.
const KEY_CAP_PRESS: Keyframe[] = [
  { borderColor: 'var(--accent-2)', backgroundColor: 'var(--accent)', color: 'var(--bg-titlebar)', transform: 'translateY(1px)' },
  {}
];

export function useShortcutBarVisible(): boolean {
  return useSyncExternalStore(subscribeShortcutBar, shortcutBarVisible);
}

export function useSingleKeyShortcutsEnabled(): boolean {
  return useSyncExternalStore(subscribeSingleKeyShortcuts, singleKeyShortcutsEnabled);
}

function ShortcutKeys({ shortcut, mac }: { shortcut: PullRequestShortcut; mac: boolean }): ReactElement {
  return (
    <span className="pr-shortcut-keys" data-modified={shortcut.modified || undefined}>
      {shortcut.keys.map((key) => <kbd key={key} data-key={key}>{shortcutKeyLabel(key, mac)}</kbd>)}
    </span>
  );
}

/** One quiet row at the bottom that teaches the keys for the open tab. */
export function PullRequestShortcutBar({ tab, tourUsable, onViewAll }: {
  tab: PullRequestDetailTab;
  tourUsable: boolean;
  onViewAll: () => void;
}): ReactElement | null {
  const visible = useShortcutBarVisible();
  const singleKeyEnabled = useSingleKeyShortcutsEnabled();
  const barRef = useRef<HTMLElement>(null);

  // A shortcut that did something lights its key cap for a moment, so the bar teaches as it is used.
  // `shortcutUsed` is called where the action happens; a refused key never reaches here.
  useEffect(() => subscribeShortcutUsed((chip) => {
    if (prefersReducedMotion()) return;
    const [modifier, key] = chip.startsWith('Mod+') ? ['Mod', chip.slice(4)] : [undefined, chip];
    for (const group of barRef.current?.querySelectorAll<HTMLElement>('.pr-shortcut-keys') ?? []) {
      const caps = [...group.querySelectorAll<HTMLElement>('kbd')];
      if (Boolean(modifier) !== group.hasAttribute('data-modified') || !caps.some((cap) => cap.dataset.key === key)) continue;
      // With a modifier the whole combination lights; otherwise only the key that was pressed.
      for (const cap of modifier ? caps : caps.filter((item) => item.dataset.key === key)) {
        cap.animate(KEY_CAP_PRESS, { duration: 260, easing: EASE_OUT });
      }
    }
  }), []);

  if (!visible) return null;
  const mac = isMacPlatform();

  return (
    <footer ref={barRef} className="pr-shortcut-bar" aria-label="Keyboard shortcuts">
      <span className="pr-shortcut-bar-title">Keyboard shortcuts</span>
      <ul>
        {shortcutBarItems(tab, singleKeyEnabled, tourUsable).map((shortcut) => (
          <li key={shortcut.label}>
            <ShortcutKeys shortcut={shortcut} mac={mac} />
            <span>{shortcut.label}</span>
          </li>
        ))}
        {singleKeyEnabled ? null : <li className="pr-shortcut-bar-note">Single-key shortcuts are off</li>}
      </ul>
      <button className="pr-shortcut-bar-link" type="button" onClick={onViewAll}>View all</button>
      <button
        className="icon-btn icon-btn-compact"
        type="button"
        aria-label="Hide the shortcut bar"
        title="Hide the shortcut bar (Keyboard shortcuts in the ··· menu brings it back)"
        onClick={() => setShortcutBarVisible(false)}
      >
        <X size={14} />
      </button>
    </footer>
  );
}

/** Every shortcut by area, with the switches for single-key shortcuts (WCAG 2.1.4) and the bar. */
export function PullRequestShortcutsDialog({ tab, tourUsable, onClose }: {
  tab: PullRequestDetailTab;
  tourUsable: boolean;
  onClose: () => void;
}): ReactElement {
  const titleId = useId();
  const singleKeyEnabled = useSingleKeyShortcutsEnabled();
  const barVisible = useShortcutBarVisible();
  const mac = isMacPlatform();

  return (
    <ModalSurface labelledBy={titleId} className="pr-shortcuts-dialog" onClose={onClose} closeOnBackdropClick>
      <header>
        <Keyboard size={16} aria-hidden="true" />
        <h2 id={titleId}>Keyboard shortcuts</h2>
        <button className="icon-btn icon-btn-compact" type="button" onClick={onClose} aria-label="Close keyboard shortcuts">
          <X size={14} />
        </button>
      </header>
      <div className="pr-shortcuts-dialog-body">
        {shortcutDialogSections({ tab, tourUsable }).map(({ area, shortcuts }) => (
          <section key={area} aria-label={area}>
            <h3>{area}</h3>
            <dl>
              {shortcuts.map((shortcut) => (
                <div key={shortcut.label} data-disabled={!singleKeyEnabled && !shortcut.modified ? true : undefined}>
                  <dt><ShortcutKeys shortcut={shortcut} mac={mac} /></dt>
                  <dd>{shortcut.description ?? shortcut.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <footer>
        <label>
          <input
            type="checkbox"
            checked={singleKeyEnabled}
            data-modal-initial-focus="true"
            onChange={(event) => setSingleKeyShortcutsEnabled(event.target.checked)}
          />
          <span>
            <strong>Single-key shortcuts</strong>
            <span>Letter and symbol keys without a modifier. Turn off if they clash with speech input or other tools.</span>
          </span>
        </label>
        <label>
          <input type="checkbox" checked={barVisible} onChange={(event) => setShortcutBarVisible(event.target.checked)} />
          <span>
            <strong>Show shortcut bar</strong>
            <span>The row of keys at the bottom of the pull request view.</span>
          </span>
        </label>
      </footer>
    </ModalSurface>
  );
}
