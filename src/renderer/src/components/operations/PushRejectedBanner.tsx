import type { ReactElement } from 'react';
import { ArrowDown, ShieldAlert, Upload, X } from 'lucide-react';

import type { PushRejectionPrompt } from '@renderer/workspace/pushRejection';

type PushRejectedBannerProps = {
  prompt?: PushRejectionPrompt;
  isBusy: boolean;
  onPull: (prompt: PushRejectionPrompt) => void;
  onForcePush: (prompt: PushRejectionPrompt) => void;
  onDismiss: () => void;
};

export function PushRejectedBanner({
  prompt,
  isBusy,
  onPull,
  onForcePush,
  onDismiss
}: PushRejectedBannerProps): ReactElement | null {
  if (!prompt) {
    return null;
  }

  return (
    <div
      className="flex min-h-11 shrink-0 items-center gap-3 border-b border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-1.5 text-xs"
      role="alert"
      aria-live="assertive"
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-[var(--danger-border)] bg-black/15 text-[var(--danger-text)]">
        <ShieldAlert size={14} />
      </span>
      <p className="min-w-0 flex-1 truncate text-[var(--text-2)]">
        <span className="font-semibold text-[var(--text-1)]">{prompt.branchName}</span>
        {' cannot be pushed because '}
        <span className="font-semibold text-[var(--text-1)]">{prompt.remoteBranchName}</span>
        {' has different commits. Pull first or force push with lease to replace the remote branch.'}
      </p>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          className="btn-subtle h-7 border-[var(--success-border)] text-[11px] text-[var(--success-text)]"
          type="button"
          disabled={isBusy}
          onClick={() => onPull(prompt)}
        >
          <ArrowDown size={12} />
          {prompt.isCurrentBranch ? 'Pull' : 'Checkout & Pull'}
        </button>
        <button
          className="btn-subtle h-7 border-[var(--danger-border)] text-[11px] text-[var(--danger-text)]"
          type="button"
          disabled={isBusy}
          onClick={() => onForcePush(prompt)}
        >
          <Upload size={12} />
          Force Push
        </button>
        <button
          className="btn-subtle h-7 text-[11px]"
          type="button"
          disabled={isBusy}
          onClick={onDismiss}
        >
          <X size={12} />
          Cancel
        </button>
      </div>
    </div>
  );
}
