import { forwardRef, type ComponentPropsWithoutRef, type ReactElement } from 'react';

import { cn } from '@renderer/lib/utils';

export const ContextMenuSurface = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(
  function ContextMenuSurface({ className, ...props }, ref): ReactElement {
    return (
      <div
        ref={ref}
        data-slot="context-menu-content"
        className={cn('context-menu-surface', className)}
        tabIndex={-1}
        {...props}
      />
    );
  }
);

export function ContextMenuSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<'div'>): ReactElement {
  return (
    <div
      data-slot="context-menu-separator"
      className={cn('context-menu-separator', className)}
      role="separator"
      {...props}
    />
  );
}
