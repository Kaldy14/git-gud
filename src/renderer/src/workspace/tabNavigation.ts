export type TabStop = { kind: 'repository'; tabId: string } | { kind: 'start' };

/** Tabs in strip order: repositories first, then the New Tab page when it is open. */
export function listTabStops(tabIds: readonly string[], isStartTabOpen: boolean): TabStop[] {
  const stops: TabStop[] = tabIds.map((tabId) => ({ kind: 'repository', tabId }));
  return isStartTabOpen ? [...stops, { kind: 'start' }] : stops;
}

/** ⌘1–⌘8 select that position; ⌘9 always selects the last tab, as in browsers. */
export function tabStopForDigit(stops: readonly TabStop[], digit: number): TabStop | undefined {
  if (!Number.isInteger(digit) || digit < 1 || digit > 9) {
    return undefined;
  }

  return digit === 9 ? stops.at(-1) : stops[digit - 1];
}

/** Cycles through tabs with wrap-around; with no current tab it starts at either end. */
export function adjacentTabStop(
  stops: readonly TabStop[],
  current: TabStop | undefined,
  direction: 1 | -1
): TabStop | undefined {
  if (stops.length === 0) {
    return undefined;
  }

  const currentIndex = current ? stops.findIndex((stop) => isSameTabStop(stop, current)) : -1;

  if (currentIndex === -1) {
    return direction === 1 ? stops[0] : stops.at(-1);
  }

  return stops[(currentIndex + direction + stops.length) % stops.length];
}

/** Repository tabs a tab's “Close Other Tabs” or “Close Tabs to the Right” command closes. */
export function tabsToClose(tabIds: readonly string[], tabId: string, scope: 'others' | 'right'): string[] {
  const index = tabIds.indexOf(tabId);

  if (index === -1) {
    return [];
  }

  return scope === 'others' ? tabIds.filter((candidate) => candidate !== tabId) : tabIds.slice(index + 1);
}

/** Most recently closed repository first, without duplicates. */
export function rememberClosedRepository(paths: readonly string[], repoPath: string, limit = 10): string[] {
  return [repoPath, ...paths.filter((path) => path !== repoPath)].slice(0, limit);
}

export function tabDigitFromKeyboardEvent(event: Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): number | undefined {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
    return undefined;
  }

  const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
  return match ? Number(match[1]) : undefined;
}

function isSameTabStop(left: TabStop, right: TabStop): boolean {
  if (left.kind === 'start' || right.kind === 'start') {
    return left.kind === right.kind;
  }

  return left.tabId === right.tabId;
}
