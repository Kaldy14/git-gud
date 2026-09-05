import type { ReactElement } from 'react';
import type { ContextMenuItem, ContextMenuOpenContext } from '@pierre/trees';
import { Copy } from 'lucide-react';
import { ContextMenu as ContextMenuPrimitive } from 'radix-ui';

import {
  handleMenuKeyDown,
  openContextMenuFromKeyboard
} from '@renderer/components/accessibility/menuKeyboard';
import { ContextMenuSurface } from '@renderer/components/ui/context-menu';

export function ReviewFilePathContextMenu({
  path,
  children
}: {
  path: string;
  children: ReactElement;
}): ReactElement {
  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild onKeyDown={openContextMenuFromKeyboard}>
        {children}
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          className="context-menu-surface review-file-path-context-menu"
          collisionPadding={8}
          aria-label={`File actions for ${path}`}
        >
          <ContextMenuPrimitive.Item
            className="menu-row"
            onSelect={() => void navigator.clipboard.writeText(path)}
          >
            <Copy size={14} />
            <span>Copy file path</span>
          </ContextMenuPrimitive.Item>
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}

export function ReviewFileTreePathContextMenu({
  item,
  context
}: {
  item: ContextMenuItem;
  context: ContextMenuOpenContext;
}): ReactElement {
  const label = item.kind === 'file' ? 'Copy file path' : 'Copy folder path';

  return (
    <ContextMenuSurface
      role="menu"
      aria-label={`${item.kind === 'file' ? 'File' : 'Folder'} actions for ${item.path}`}
      className="review-file-path-context-menu"
      data-file-tree-context-menu-root="true"
      onKeyDown={(event) => handleMenuKeyDown(event, context.close)}
    >
      <button
        type="button"
        role="menuitem"
        className="menu-row"
        autoFocus
        onClick={() => {
          context.close();
          void navigator.clipboard.writeText(item.path);
        }}
      >
        <Copy size={14} />
        <span>{label}</span>
      </button>
    </ContextMenuSurface>
  );
}
