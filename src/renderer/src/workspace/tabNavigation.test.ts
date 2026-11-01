import { describe, expect, it } from 'vitest';

import {
  adjacentTabStop,
  listTabStops,
  rememberClosedRepository,
  tabDigitFromKeyboardEvent,
  tabStopForDigit,
  tabsToClose
} from './tabNavigation';

const stops = listTabStops(['a', 'b', 'c'], true);

describe('tab navigation', () => {
  it('lists repository tabs before the open New Tab page', () => {
    expect(stops).toEqual([
      { kind: 'repository', tabId: 'a' },
      { kind: 'repository', tabId: 'b' },
      { kind: 'repository', tabId: 'c' },
      { kind: 'start' }
    ]);
    expect(listTabStops(['a'], false)).toEqual([{ kind: 'repository', tabId: 'a' }]);
  });

  it('maps ⌘1–⌘8 to positions and ⌘9 to the last tab', () => {
    expect(tabStopForDigit(stops, 2)).toEqual({ kind: 'repository', tabId: 'b' });
    expect(tabStopForDigit(stops, 8)).toBeUndefined();
    expect(tabStopForDigit(stops, 9)).toEqual({ kind: 'start' });
    expect(tabStopForDigit(stops, 0)).toBeUndefined();
  });

  it('cycles forward and backward with wrap-around', () => {
    expect(adjacentTabStop(stops, { kind: 'repository', tabId: 'c' }, 1)).toEqual({ kind: 'start' });
    expect(adjacentTabStop(stops, { kind: 'start' }, 1)).toEqual({ kind: 'repository', tabId: 'a' });
    expect(adjacentTabStop(stops, { kind: 'repository', tabId: 'a' }, -1)).toEqual({ kind: 'start' });
  });

  it('starts from either end when no tab in the strip is active', () => {
    expect(adjacentTabStop(stops, undefined, 1)).toEqual({ kind: 'repository', tabId: 'a' });
    expect(adjacentTabStop(stops, undefined, -1)).toEqual({ kind: 'start' });
    expect(adjacentTabStop([], undefined, 1)).toBeUndefined();
  });

  it('selects the tabs closed by “Close Other Tabs” and “Close Tabs to the Right”', () => {
    expect(tabsToClose(['a', 'b', 'c', 'd'], 'b', 'others')).toEqual(['a', 'c', 'd']);
    expect(tabsToClose(['a', 'b', 'c', 'd'], 'b', 'right')).toEqual(['c', 'd']);
    expect(tabsToClose(['a', 'b'], 'b', 'right')).toEqual([]);
    expect(tabsToClose(['a', 'b'], 'missing', 'others')).toEqual([]);
  });

  it('remembers the most recently closed repositories without duplicates', () => {
    expect(rememberClosedRepository(['/b', '/a'], '/a')).toEqual(['/a', '/b']);
    expect(rememberClosedRepository(['/1', '/2', '/3'], '/4', 3)).toEqual(['/4', '/1', '/2']);
  });

  it('reads tab digits from the physical key with only ⌘ or Ctrl held', () => {
    const base = { metaKey: true, ctrlKey: false, altKey: false, shiftKey: false };
    expect(tabDigitFromKeyboardEvent({ ...base, code: 'Digit3' })).toBe(3);
    expect(tabDigitFromKeyboardEvent({ ...base, code: 'Numpad9' })).toBe(9);
    expect(tabDigitFromKeyboardEvent({ ...base, code: 'Digit0' })).toBeUndefined();
    expect(tabDigitFromKeyboardEvent({ ...base, code: 'Digit3', shiftKey: true })).toBeUndefined();
    expect(tabDigitFromKeyboardEvent({ ...base, code: 'Digit3', metaKey: false })).toBeUndefined();
  });
});
