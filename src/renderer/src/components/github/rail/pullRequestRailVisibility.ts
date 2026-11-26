import type { PullRequestDetailTab } from '../pullRequestDetailTab';

// The rail is remembered separately for reading tabs (Overview, Conversation) and code tabs (Tour, Code).
// Wide windows dock it beside the pull request; below 1240px it floats over the content when opened.

export type RailTabKind = 'reading' | 'code';
export type RailPreferences = Partial<Record<RailTabKind, boolean>>;

export const RAIL_FLOATING_BELOW = 1240;
// Beside a diff the list costs 280px of code, so it opens by default only where there is room to spare.
const CODE_DOCKED_FROM = 1840;
const PREFERENCES_KEY = 'git-gud:pr-rail:v1';

export function railTabKind(tab: PullRequestDetailTab): RailTabKind {
  return tab === 'tour' || tab === 'code' ? 'code' : 'reading';
}

export function isRailFloating(width: number): boolean {
  return width < RAIL_FLOATING_BELOW;
}

/**
 * Whether the rail shows. Docked widths use the saved choice for this tab kind, defaulting to open for
 * reading tabs and, from 1840px, for code tabs. A floating rail starts closed and is session state only.
 */
export function isRailOpen({ width, kind, saved, floatingOpen }: {
  width: number;
  kind: RailTabKind;
  saved: RailPreferences;
  floatingOpen: boolean;
}): boolean {
  if (isRailFloating(width)) return floatingOpen;
  return saved[kind] ?? (kind === 'reading' || width >= CODE_DOCKED_FROM);
}

export function loadRailPreferences(storage: Pick<Storage, 'getItem'>): RailPreferences {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(PREFERENCES_KEY) ?? '{}');
    const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    const preferences: RailPreferences = {};
    if (typeof record.reading === 'boolean') preferences.reading = record.reading;
    if (typeof record.code === 'boolean') preferences.code = record.code;
    return preferences;
  } catch {
    return {};
  }
}

export function saveRailPreferences(storage: Pick<Storage, 'setItem'>, preferences: RailPreferences): void {
  try { storage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); } catch { /* a remembered rail is a convenience */ }
}
