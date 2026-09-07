import type { ReactElement, ReactNode } from 'react';
import { useEffect, useRef } from 'react';

/** A non-modal inspector. Keep it mounted so closing it preserves drafts and scroll. */
export function PullRequestPanel({
  open,
  labelledBy,
  className = '',
  children,
  onClose
}: {
  open: boolean;
  labelledBy: string;
  className?: string;
  children: ReactNode;
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
      ref={panelRef}
      className={`pr-side-panel ${className}`}
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
      {children}
    </aside>
  );
}
