import type { KeyboardEvent as ReactKeyboardEvent, ReactElement, ReactNode, RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';

type ModalSurfaceProps = {
  children: ReactNode;
  labelledBy: string;
  describedBy?: string;
  className: string;
  backdropClassName?: string;
  onClose: () => void;
  closeOnBackdropClick?: boolean;
  panelRef?: RefObject<HTMLElement | null>;
};

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export function ModalSurface({
  children,
  labelledBy,
  describedBy,
  className,
  backdropClassName = 'fixed inset-0 z-50 grid place-items-center bg-black/45 px-4 py-8',
  onClose,
  closeOnBackdropClick = false,
  panelRef
}: ModalSurfaceProps): ReactElement {
  const internalPanelRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const activePanelRef = panelRef ?? internalPanelRef;
  // Captured during the first render, before React applies autoFocus inside the panel.
  const [returnFocusTarget] = useState(() =>
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  );

  useEffect(() => {
    const panel = activePanelRef.current;
    const backdrop = backdropRef.current;
    const siblingInertStates = new Map<HTMLElement, boolean>();

    if (backdrop?.parentElement) {
      for (const sibling of Array.from(backdrop.parentElement.children)) {
        if (!(sibling instanceof HTMLElement) || sibling === backdrop) {
          continue;
        }

        siblingInertStates.set(sibling, sibling.inert);
        sibling.inert = true;
      }
    }

    const initialFocus = panel?.querySelector<HTMLElement>('[autofocus], [data-modal-initial-focus="true"]');

    if (initialFocus) {
      initialFocus.focus({ preventScroll: true });
    } else if (!panel?.contains(document.activeElement)) {
      // React's autoFocus focuses fields without an autofocus attribute; keep that focus.
      panel?.focus({ preventScroll: true });
    }

    return () => {
      for (const [sibling, wasInert] of siblingInertStates) {
        sibling.inert = wasInert;
      }

      returnFocusTarget?.focus({ preventScroll: true });
    };
  }, [activePanelRef, returnFocusTarget]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key !== 'Tab') {
      return;
    }

    const panel = activePanelRef.current;
    const focusable = panel
      ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => !element.hidden)
      : [];

    if (focusable.length === 0) {
      event.preventDefault();
      panel?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <div
      ref={backdropRef}
      className={backdropClassName}
      role="presentation"
      onClick={(event) => {
        if (closeOnBackdropClick && event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={activePanelRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {children}
      </section>
    </div>
  );
}
