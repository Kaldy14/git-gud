import type { ReactElement } from 'react';
import { AlertTriangle, ArrowRight, Check, Loader2, SkipForward, XCircle } from 'lucide-react';

import type { GitConflictActionInput, GitConflictState } from '@shared/types';

type ConflictBannerProps = {
  conflictState?: GitConflictState;
  isBusy: boolean;
  onResolve: (action: GitConflictActionInput['action']) => void;
  onSelectFile?: (path: string) => void;
};

export function ConflictBanner({ conflictState, isBusy, onResolve, onSelectFile }: ConflictBannerProps): ReactElement | null {
  if (!conflictState?.isActive) {
    return null;
  }

  const hasConflictedFiles = conflictState.files.length > 0;
  const operationLabel = conflictState.operation?.replace('-', ' ') ?? 'Git operation';

  return (
    <div className="conflict-banner flex min-h-11 shrink-0 items-center gap-3 border-b border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-1.5 text-xs" role="alert" aria-live="polite">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-[var(--danger-border)] bg-black/15 text-[var(--danger-text)]">
        <AlertTriangle size={14} />
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className="shrink-0 font-semibold capitalize text-[var(--text-1)]">{operationLabel} conflicts</span>
        {hasConflictedFiles ? (
          <span className="badge-mini shrink-0 border-[var(--danger-border)] text-[var(--danger-text)]">
            {conflictState.files.length} unresolved
          </span>
        ) : null}
        <span className="min-w-0 truncate text-[11px] text-[var(--text-2)]">
          {hasConflictedFiles ? 'Open the resolver, choose the final output, then save and stage each file.' : conflictState.message}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {hasConflictedFiles ? (
          <button
            className="btn-primary h-8 px-3 text-[11px]"
            type="button"
            disabled={isBusy}
            onClick={() => onSelectFile?.(conflictState.files[0]!.path)}
          >
            Resolve conflicts
            <ArrowRight size={12} />
          </button>
        ) : null}
        <button
          className="btn-subtle h-7 text-[11px]"
          type="button"
          disabled={isBusy || !conflictState.canContinue || hasConflictedFiles}
          title={hasConflictedFiles ? 'Stage resolved files before continuing' : `Continue ${operationLabel}`}
          onClick={() => onResolve('continue')}
        >
          {isBusy && !hasConflictedFiles ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
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
