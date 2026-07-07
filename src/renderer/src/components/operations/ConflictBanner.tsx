import type { ReactElement } from 'react';
import { AlertTriangle, Check, GitMerge, Loader2, SkipForward, XCircle } from 'lucide-react';

import type { GitConflictActionInput, GitConflictState } from '@shared/types';

type ConflictBannerProps = {
  conflictState?: GitConflictState;
  isBusy: boolean;
  onResolve: (action: GitConflictActionInput['action']) => void;
};

export function ConflictBanner({ conflictState, isBusy, onResolve }: ConflictBannerProps): ReactElement | null {
  if (!conflictState?.isActive) {
    return null;
  }

  const hasConflictedFiles = conflictState.files.length > 0;
  const operationLabel = conflictState.operation?.replace('-', ' ') ?? 'Git operation';

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-2 text-xs text-[var(--danger-text)]">
      <GitMerge size={15} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-semibold capitalize">{operationLabel}</span>
          <span className="min-w-0 truncate text-[var(--text-2)]">{conflictState.message}</span>
        </div>
        {hasConflictedFiles ? (
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--text-2)]">
            <AlertTriangle size={12} className="shrink-0 text-[var(--danger-text)]" />
            <span className="min-w-0 truncate">{conflictState.files.map((file) => file.path).join(', ')}</span>
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          className="btn-subtle h-7 text-[11px]"
          type="button"
          disabled={isBusy || !conflictState.canContinue || hasConflictedFiles}
          title={hasConflictedFiles ? 'Stage resolved files before continuing' : `Continue ${operationLabel}`}
          onClick={() => onResolve('continue')}
        >
          {isBusy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          Continue
        </button>
        <button
          className="btn-subtle h-7 text-[11px]"
          type="button"
          disabled={isBusy || !conflictState.canSkip}
          onClick={() => onResolve('skip')}
        >
          <SkipForward size={12} />
          Skip
        </button>
        <button
          className="btn-subtle h-7 text-[11px]"
          type="button"
          disabled={isBusy || !conflictState.canAbort}
          onClick={() => onResolve('abort')}
        >
          <XCircle size={12} />
          Abort
        </button>
      </div>
    </div>
  );
}
