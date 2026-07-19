import type { ReactElement } from 'react';
import { Copy, Trash2, Upload } from 'lucide-react';

import type { GitTagDeleteInput } from '@shared/types';

type TagMenuItemsProps = {
  tagName: string;
  remoteName?: string;
  isOperationBusy: boolean;
  onPushTag?: (name: string, remote: string) => Promise<void> | void;
  onDeleteTag?: (input: GitTagDeleteInput) => Promise<void> | void;
  onClose: () => void;
};

export function TagMenuItems({
  tagName,
  remoteName,
  isOperationBusy,
  onPushTag,
  onDeleteTag,
  onClose
}: TagMenuItemsProps): ReactElement {
  function deleteTag(input: GitTagDeleteInput): void {
    if (!onDeleteTag) {
      return;
    }

    void onDeleteTag(input);
    onClose();
  }

  async function copyTagName(): Promise<void> {
    await navigator.clipboard.writeText(tagName);
    onClose();
  }

  return (
    <>
      <button
        className="menu-row"
        type="button"
        role="menuitem"
        disabled={isOperationBusy || !remoteName || !onPushTag}
        title={remoteName ? undefined : 'Configure a remote before pushing this tag'}
        onClick={() => {
          if (!remoteName || !onPushTag) {
            return;
          }

          void onPushTag(tagName, remoteName);
          onClose();
        }}
      >
        <Upload size={14} />
        <span>{remoteName ? `Push ${tagName} to ${remoteName}` : `Push ${tagName}`}</span>
      </button>
      <div className="mx-1.5 my-1 h-px bg-[var(--border)]" />
      <button
        className="menu-row"
        type="button"
        role="menuitem"
        disabled={isOperationBusy || !onDeleteTag}
        onClick={() => deleteTag({ name: tagName, target: 'local' })}
      >
        <Trash2 size={14} />
        <span>Delete {tagName} locally</span>
      </button>
      <button
        className="menu-row"
        type="button"
        role="menuitem"
        disabled={isOperationBusy || !remoteName || !onDeleteTag}
        title={remoteName ? undefined : 'Configure a remote before deleting this tag remotely'}
        onClick={() => {
          if (remoteName) {
            deleteTag({ name: tagName, target: 'remote', remote: remoteName });
          }
        }}
      >
        <Trash2 size={14} />
        <span>{remoteName ? `Delete ${tagName} from ${remoteName}` : `Delete ${tagName} remotely`}</span>
      </button>
      <button
        className="menu-row"
        type="button"
        role="menuitem"
        disabled={isOperationBusy || !remoteName || !onDeleteTag}
        title={remoteName ? undefined : 'Configure a remote before deleting this tag locally and remotely'}
        onClick={() => {
          if (remoteName) {
            deleteTag({ name: tagName, target: 'both', remote: remoteName });
          }
        }}
      >
        <Trash2 size={14} />
        <span>{remoteName ? `Delete ${tagName} locally and from ${remoteName}` : `Delete ${tagName} locally and remotely`}</span>
      </button>
      <div className="mx-1.5 my-1 h-px bg-[var(--border)]" />
      <button
        className="menu-row"
        type="button"
        role="menuitem"
        onClick={() => void copyTagName()}
      >
        <Copy size={14} />
        <span>Copy tag name</span>
      </button>
    </>
  );
}
