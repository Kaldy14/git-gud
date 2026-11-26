import { useEffect, useLayoutEffect, type RefObject } from 'react';

/**
 * One underline for a row of tabs. Writes `--indicator-x` and `--indicator-width` on the list for a
 * `.sliding-indicator` child, measured from the item marked `aria-selected`. It slides only when the
 * selection changes: a count arriving, a resize or the row being shown again places it at once.
 * `inset` is the item's horizontal padding, so the line sits under the label. Pass `present: false`
 * while the list is not rendered, so it is placed and observed once it is.
 */
export function useSlidingIndicator(listRef: RefObject<HTMLElement | null>, selected: string, inset: number, present = true): void {
  useLayoutEffect(() => { placeIndicator(listRef.current, inset, true); }, [listRef, selected, inset, present]);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(() => placeIndicator(list, inset, false));
    observer.observe(list);
    for (const item of list.querySelectorAll('[role="tab"]')) observer.observe(item);
    return () => observer.disconnect();
  }, [listRef, inset, present]);
}

function placeIndicator(list: HTMLElement | null, inset: number, slide: boolean): void {
  const item = list?.querySelector<HTMLElement>('[aria-selected="true"]');
  // A hidden row has no width: leave it unplaced, so showing it places the line without a slide.
  if (!list || !item || item.offsetWidth === 0) return;
  const x = `${item.offsetLeft + inset}px`;
  const width = String(Math.max(0, item.offsetWidth - inset * 2));
  // A re-measure that finds the line where it already is must not cut a slide that is under way.
  if (list.style.getPropertyValue('--indicator-x') === x && list.style.getPropertyValue('--indicator-width') === width) return;
  if (!slide) list.removeAttribute('data-indicator-ready');
  list.style.setProperty('--indicator-x', x);
  list.style.setProperty('--indicator-width', width);
  if (list.hasAttribute('data-indicator-ready')) return;
  // Commit the new place while the transition is off, then allow slides again. Waiting a frame is not
  // enough: a frame callback queued here runs before the style pass, and the "snap" would slide.
  void list.offsetWidth;
  list.setAttribute('data-indicator-ready', '');
}
