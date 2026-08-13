import type { ReactElement } from 'react';
import { Tag } from 'lucide-react';

type CreateSuggestedTagMenuItemProps = {
  suggestedTagName?: string;
  isOperationBusy: boolean;
  onCreate?: (name: string) => Promise<unknown> | void;
  onClose: () => void;
};

export function CreateSuggestedTagMenuItem({
  suggestedTagName,
  isOperationBusy,
  onCreate,
  onClose
}: CreateSuggestedTagMenuItemProps): ReactElement | null {
  if (!suggestedTagName || !onCreate) {
    return null;
  }

  return (
    <button
      className="menu-row"
      type="button"
      role="menuitem"
      disabled={isOperationBusy}
      onClick={() => {
        void onCreate(suggestedTagName);
        onClose();
      }}
    >
      <Tag size={14} />
      <span>Create {suggestedTagName} tag and push</span>
    </button>
  );
}
