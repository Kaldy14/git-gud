import type { ReactElement, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { PanelResizeHandle } from '../ui/panelResize';
import type { usePanelResize } from '../ui/usePanelResize';

/** A non-modal inspector. Keep it mounted so closing it preserves drafts and scroll. */
export function PullRequestPanel({
  open,
  labelledBy,
  className = '',
  children,
  resize,
  onClose
}: {
  open: boolean;
  labelledBy: string;
  className?: string;
  children: ReactNode;
  resize?: ReturnType<typeof usePanelResize>;
  onClose: () => void;
}): ReactElement {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const trigger =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      trigger?.focus({ preventScroll: true });
    };
  }, [open]);

  return (
    <aside
      ref={(node) => { panelRef.current = node; resize?.attachPanel(node); }}
      className={`pr-side-panel ${className}`}
      style={resize ? { '--pr-panel-width': `${resize.width}px` } as CSSProperties : undefined}
      hidden={!open}
      aria-labelledby={labelledBy}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {resize ? <PanelResizeHandle resize={resize} label="pull request details" /> : null}
      {children}
    </aside>
  );
}
