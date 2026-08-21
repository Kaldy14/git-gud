import type { ReactElement } from 'react';
import { Check, Cloud } from 'lucide-react';

type BranchContextMenuPrimaryActionsProps = {
  branchName: string;
  hasUpstream?: boolean;
  suggestedTagName?: string;
  isCurrentBranch: boolean;
  isOperationBusy: boolean;
  onCheckoutBranch?: (name: string) => Promise<void> | void;
  onPushBranch?: (name: string) => Promise<void> | void;
  onPushBranchWithTag?: (branchName: string, tagName: string) => Promise<void> | void;
  onClose: () => void;
};

export function BranchContextMenuPrimaryActions({
  branchName,
  hasUpstream = false,
  suggestedTagName,
  isCurrentBranch,
  isOperationBusy,
  onCheckoutBranch,
  onPushBranch,
  onPushBranchWithTag,
  onClose
}: BranchContextMenuPrimaryActionsProps): ReactElement {
  return (
    <>
      <button
        className="menu-row"
        type="button"
        role="menuitem"
        disabled={!onCheckoutBranch || isCurrentBranch || isOperationBusy}
        onClick={() => {
          void onCheckoutBranch?.(branchName);
          onClose();
        }}
      >
        <Check size={14} />
        <span>Checkout {branchName}</span>
      </button>
      <button
        className="menu-row"
        type="button"
        role="menuitem"
        disabled={!onPushBranch || isOperationBusy}
        onClick={() => {
          void onPushBranch?.(branchName);
          onClose();
        }}
      >
        <Cloud size={14} />
        <span>Push branch to remote</span>
      </button>
      {!hasUpstream && suggestedTagName && onPushBranchWithTag ? (
        <button
          className="menu-row"
          type="button"
          role="menuitem"
          disabled={isOperationBusy}
          onClick={() => {
            void onPushBranchWithTag(branchName, suggestedTagName);
            onClose();
          }}
        >
          <Cloud size={14} />
          <span>Push {branchName} &amp; Push {suggestedTagName}</span>
        </button>
      ) : null}
    </>
  );
}
