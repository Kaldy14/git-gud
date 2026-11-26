import { useLayoutEffect, useRef, type RefObject } from 'react';

/** The one deceleration curve (`--ease-out` in main.css), for animations started from script. */
export const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** Whether the system asks for less motion. Read at the moment of use, so a changed setting applies at once. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Draws an icon's strokes once, as if written. The length is measured, so any glyph works. */
export function drawStroke(svg: Element | null | undefined): void {
  if (!svg || prefersReducedMotion()) return;
  for (const shape of svg.querySelectorAll<SVGGeometryElement>('path, polyline, line, circle')) {
    const length = shape.getTotalLength();
    shape.animate(
      [{ strokeDasharray: length, strokeDashoffset: length }, { strokeDasharray: length, strokeDashoffset: 0 }],
      { duration: 320, easing: EASE_OUT }
    );
  }
}

/**
 * Draws the icon inside `ref` when `on` turns true while it is on screen: a check for something that just
 * happened. Mounting already true (a restored state, a tab shown again) draws nothing.
 */
export function useDrawOnBecoming(ref: RefObject<Element | null>, on: boolean): void {
  const previous = useRef(on);
  // Before paint: the finished glyph must never show for a frame ahead of its own drawing.
  useLayoutEffect(() => {
    if (on && !previous.current) drawStroke(ref.current?.querySelector('svg'));
    previous.current = on;
  }, [on, ref]);
}
