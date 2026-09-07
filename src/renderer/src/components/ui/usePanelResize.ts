import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

type PanelSizeOptions = {
  storageKey: string;
  defaultWidth: number;
  expandedWidth: number;
  minWidth: number;
  maxWidth: number;
  minRemainingWidth: number;
  edge: 'left' | 'right';
};

function readWidth(key: string, fallback: number): number {
  const value = window.localStorage.getItem(key);
  const width = value === null ? NaN : Number(value);
  return Number.isFinite(width) && width > 0 ? width : fallback;
}

/** Remember the requested width, but fit the panel to its current workspace. */
export function usePanelResize(options: PanelSizeOptions) {
  const { storageKey, defaultWidth, expandedWidth, minWidth, maxWidth, minRemainingWidth, edge } = options;
  const panelRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ x: number; width: number; cursor: string; userSelect: string } | undefined>(undefined);
  const [requestedWidth, setRequestedWidth] = useState(() => readWidth(storageKey, defaultWidth));
  const [restoreWidth, setRestoreWidth] = useState<number | undefined>(() => {
    const stored = readWidth(`${storageKey}:restore`, 0);
    return stored > 0 ? stored : undefined;
  });
  const [availableWidth, setAvailableWidth] = useState(maxWidth);
  const [isResizing, setIsResizing] = useState(false);
  const limit = Math.max(minWidth, Math.min(maxWidth, availableWidth));
  const width = Math.max(minWidth, Math.min(limit, requestedWidth));

  useLayoutEffect(() => {
    const container = panelRef.current?.parentElement;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      setAvailableWidth(container.clientWidth - minRemainingWidth);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [minRemainingWidth]);

  function stopResize(): void {
    const drag = dragRef.current;
    if (!drag) return;
    document.body.style.cursor = drag.cursor;
    document.body.style.userSelect = drag.userSelect;
    dragRef.current = undefined;
  }

  useEffect(() => stopResize, []);

  function resize(nextWidth: number, restore?: number): void {
    const next = Math.round(Math.max(minWidth, Math.min(limit, nextWidth)));
    setRequestedWidth(next);
    setRestoreWidth(restore);
    window.localStorage.setItem(storageKey, String(next));
    if (restore === undefined) window.localStorage.removeItem(`${storageKey}:restore`);
    else window.localStorage.setItem(`${storageKey}:restore`, String(restore));
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      x: event.clientX,
      width: panelRef.current?.getBoundingClientRect().width ?? width,
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    setIsResizing(true);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (drag) resize(drag.width + (event.clientX - drag.x) * (edge === 'right' ? 1 : -1));
  }

  function onPointerEnd(): void {
    stopResize();
    setIsResizing(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const step = event.shiftKey ? 48 : 16;
    const direction = edge === 'right' ? 1 : -1;
    let next: number;
    switch (event.key) {
      case 'ArrowRight': next = width + step * direction; break;
      case 'ArrowLeft': next = width - step * direction; break;
      case 'Home': next = minWidth; break;
      case 'End': next = limit; break;
      case 'Enter':
      case ' ': next = defaultWidth; break;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    resize(next);
  }

  const attachPanel = useCallback((node: HTMLElement | null) => { panelRef.current = node; }, []);

  return {
    attachPanel,
    width,
    isExpanded: restoreWidth !== undefined,
    toggleExpanded: () => restoreWidth === undefined
      ? resize(Math.max(width, expandedWidth), width)
      : resize(restoreWidth),
    separatorProps: {
      role: 'separator',
      tabIndex: 0,
      'aria-orientation': 'vertical' as const,
      'aria-valuemin': minWidth,
      'aria-valuemax': limit,
      'aria-valuenow': width,
      'data-edge': edge,
      'data-active': isResizing,
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onLostPointerCapture: onPointerEnd,
      onKeyDown,
      onDoubleClick: () => resize(defaultWidth)
    }
  };
}

