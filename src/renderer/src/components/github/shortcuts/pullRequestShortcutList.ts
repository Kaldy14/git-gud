import type { PullRequestDetailTab } from '../pullRequestDetailTab';

// The one list of pull request workspace shortcuts. The shortcut bar shows the entries for the open tab;
// the shortcuts dialog lists them all by area. Keys are display labels; `Mod` renders as ⌘ or Ctrl.

export type PullRequestShortcutArea = 'Pull requests' | 'Tabs' | 'Tour' | 'Diff';
export type PullRequestShortcut = {
  /** Keys pressed together or as alternatives, shown as separate chips (`J`, `K`). */
  keys: string[];
  /** Short label for the bar. */
  label: string;
  /** Longer wording for the dialog, when the label is not enough on its own. */
  description?: string;
  area: PullRequestShortcutArea;
  /** Tabs where the bar shows it; omitted means every tab. */
  tabs?: readonly PullRequestDetailTab[];
  /** Listed in the dialog only. */
  dialogOnly?: boolean;
  /** Uses a modifier, so it keeps working with single-key shortcuts turned off. */
  modified?: boolean;
};

const DIFF_TABS: readonly PullRequestDetailTab[] = ['tour', 'code'];

export const PULL_REQUEST_SHORTCUTS: readonly PullRequestShortcut[] = [
  { keys: ['J', 'K'], label: 'switch PR', description: 'Next or previous pull request in the list', area: 'Pull requests' },
  { keys: ['H', 'L'], label: 'switch tabs', description: 'Previous or next tab', area: 'Tabs' },
  { keys: ['/'], label: 'search', description: 'Search the pull request list', area: 'Pull requests' },
  { keys: ['Mod', 'B'], label: 'sidebar', description: 'Show or hide the pull request list', area: 'Pull requests', modified: true },
  { keys: ['↑', '↓', 'Enter'], label: 'move', description: 'Move through the list and open a pull request (list focused)', area: 'Pull requests', dialogOnly: true },
  { keys: ['←', '→'], label: 'steps', description: 'Previous or next tour step', area: 'Tour', tabs: ['tour'] },
  { keys: ['R'], label: 'reviewed', description: 'Mark the step reviewed and go to the next one', area: 'Tour', tabs: ['tour'] },
  { keys: ['[', ']'], label: 'files', description: 'Previous or next file', area: 'Diff', tabs: DIFF_TABS },
  { keys: ['V'], label: 'viewed', description: 'Mark the current file viewed', area: 'Diff', tabs: DIFF_TABS },
  { keys: ['↑', '↓'], label: 'lines', description: 'Move the line cursor (Shift extends the range)', area: 'Diff', tabs: DIFF_TABS },
  { keys: ['C'], label: 'comment', description: 'Comment on the selected lines', area: 'Diff', tabs: DIFF_TABS },
  { keys: ['Esc'], label: 'cancel', description: 'Clear the line cursor or dismiss an empty comment', area: 'Diff', tabs: DIFF_TABS, dialogOnly: true },
  { keys: ['Mod', 'F'], label: 'find', description: 'Search the diff', area: 'Diff', tabs: DIFF_TABS, dialogOnly: true, modified: true },
  { keys: ['?'], label: 'all shortcuts', description: 'Show this list', area: 'Pull requests', dialogOnly: true }
];

/**
 * What the bar shows on `tab`: the workspace keys first, then the tab's own. Without a usable tour the Tour
 * tab shows its state instead of the diff, so its step and diff keys would do nothing there.
 */
export function shortcutBarItems(tab: PullRequestDetailTab, singleKeyEnabled = true, tourUsable = true): PullRequestShortcut[] {
  return PULL_REQUEST_SHORTCUTS.filter((shortcut) =>
    !shortcut.dialogOnly &&
    (!shortcut.tabs || (shortcut.tabs.includes(tab) && (tab !== 'tour' || tourUsable))) &&
    (singleKeyEnabled || shortcut.modified)
  );
}

export const PULL_REQUEST_SHORTCUT_AREAS: readonly PullRequestShortcutArea[] = ['Pull requests', 'Tabs', 'Tour', 'Diff'];

/**
 * Every shortcut grouped by area, for the dialog. Without a usable tour the Tour keys do nothing anywhere,
 * and on the Tour tab the diff keys do nothing either (it shows the tour's state, not the diff).
 */
export function shortcutDialogSections(
  { tab, tourUsable }: { tab?: PullRequestDetailTab; tourUsable: boolean } = { tourUsable: true }
): Array<{ area: PullRequestShortcutArea; shortcuts: PullRequestShortcut[] }> {
  const hidden = new Set<PullRequestShortcutArea>(tourUsable ? [] : tab === 'tour' ? ['Tour', 'Diff'] : ['Tour']);
  return PULL_REQUEST_SHORTCUT_AREAS.filter((area) => !hidden.has(area)).map((area) => ({
    area,
    shortcuts: PULL_REQUEST_SHORTCUTS.filter((shortcut) => shortcut.area === area)
  }));
}

/** `Mod` is ⌘ on macOS and Ctrl elsewhere. */
export function shortcutKeyLabel(key: string, mac: boolean): string {
  return key === 'Mod' ? (mac ? '⌘' : 'Ctrl') : key;
}

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);
}

// The bar can be hidden with its ×; the more menu and `?` still open the dialog.
const BAR_KEY = 'git-gud:pr-shortcut-bar:v1';
const barListeners = new Set<() => void>();
let barCache: boolean | undefined;

export function shortcutBarVisible(): boolean {
  if (barCache === undefined) {
    try { barCache = globalThis.localStorage?.getItem(BAR_KEY) !== 'hidden'; } catch { barCache = true; }
  }
  return barCache;
}

export function setShortcutBarVisible(visible: boolean): void {
  barCache = visible;
  try { globalThis.localStorage?.setItem(BAR_KEY, visible ? 'shown' : 'hidden'); } catch { /* session value still applies */ }
  for (const listener of barListeners) listener();
}

export function subscribeShortcutBar(listener: () => void): () => void {
  barListeners.add(listener);
  return () => barListeners.delete(listener);
}
