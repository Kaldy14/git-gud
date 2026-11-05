import type { ReactElement, ReactNode } from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';

// AI jobs (review guide, bug scan) run for minutes and use the user's quota, so an idle
// job asks once before starting instead of starting on a single click of a small icon.
export function BackgroundJobConfirm({
  open,
  onOpenChange,
  title,
  detail,
  actionLabel,
  onConfirm,
  children
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  detail: string;
  actionLabel: string;
  onConfirm: () => void;
  children: ReactNode;
}): ReactElement {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Anchor asChild>{children}</PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          className="pr-job-confirm"
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={12}
          onClick={(event) => event.stopPropagation()}
        >
          <strong>{title}</strong>
          <p>{detail}</p>
          <div>
            <button
              className="btn-primary btn-compact"
              type="button"
              onClick={() => {
                onOpenChange(false);
                onConfirm();
              }}
            >
              {actionLabel}
            </button>
            <PopoverPrimitive.Close className="btn-subtle btn-compact" type="button">
              Cancel
            </PopoverPrimitive.Close>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
