import type { ComponentProps, ReactElement } from 'react';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';

import { cn } from '@renderer/lib/utils';

export function DropdownMenu(props: ComponentProps<typeof DropdownMenuPrimitive.Root>): ReactElement {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

export function DropdownMenuTrigger(props: ComponentProps<typeof DropdownMenuPrimitive.Trigger>): ReactElement {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>): ReactElement {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-32 overflow-x-hidden overflow-y-auto rounded-lg border border-[var(--border-strong)] bg-[var(--bg-popover)] p-1.5 text-[var(--text-2)] shadow-2xl shadow-black/60 outline-none',
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item>): ReactElement {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      className={cn(
        'menu-row cursor-default outline-none focus:bg-[var(--bg-hover)] focus:text-[var(--text-1)] data-[disabled]:pointer-events-none data-[disabled]:text-[var(--text-3)] data-[disabled]:opacity-[0.68]',
        className
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Label>): ReactElement {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      className={cn(
        'px-2.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-3)]',
        className
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>): ReactElement {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('mx-2 my-1.5 h-px bg-[var(--border)]', className)}
      {...props}
    />
  );
}
