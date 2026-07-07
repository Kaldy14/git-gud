import type { ReactElement } from 'react';
import { AlertCircle, CheckCircle2, GitPullRequest, Loader2, X } from 'lucide-react';

export type OperationLogStatus = 'pending' | 'success' | 'conflict' | 'error';

export type OperationLogEntry = {
  id: string;
  label: string;
  status: OperationLogStatus;
  detail?: string;
  happenedAt: string;
};

type OperationLogProps = {
  entries: OperationLogEntry[];
  onDismiss: (id: string) => void;
};

export function OperationLog({ entries, onDismiss }: OperationLogProps): ReactElement | null {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-8 right-4 z-40 flex w-[340px] max-w-[calc(100vw-32px)] flex-col gap-2">
      {entries.slice(0, 5).map((entry) => (
        <div
          key={entry.id}
          className="pointer-events-auto rounded-md border border-[var(--border-strong)] bg-[var(--bg-popover)] p-3 shadow-2xl shadow-black/40"
        >
          <div className="flex min-w-0 items-start gap-2.5">
            <span className={operationIconClass(entry.status)}>{operationIcon(entry.status)}</span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <p className="min-w-0 truncate text-xs font-semibold text-[var(--text-1)]">{entry.label}</p>
                <span className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-[var(--text-3)]">{entry.status}</span>
              </div>
              {entry.detail ? <p className="mt-1 text-[11px] leading-4 text-[var(--text-2)]">{entry.detail}</p> : null}
            </div>
            {entry.status !== 'pending' ? (
              <button className="icon-btn h-6 w-6 shrink-0" type="button" onClick={() => onDismiss(entry.id)} aria-label="Dismiss operation">
                <X size={12} />
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function operationIcon(status: OperationLogStatus): ReactElement {
  if (status === 'pending') {
    return <Loader2 size={15} className="animate-spin" />;
  }

  if (status === 'success') {
    return <CheckCircle2 size={15} />;
  }

  if (status === 'conflict') {
    return <GitPullRequest size={15} />;
  }

  return <AlertCircle size={15} />;
}

function operationIconClass(status: OperationLogStatus): string {
  if (status === 'success') {
    return 'mt-0.5 shrink-0 text-[var(--success-text)]';
  }

  if (status === 'conflict' || status === 'error') {
    return 'mt-0.5 shrink-0 text-[var(--danger-text)]';
  }

  return 'mt-0.5 shrink-0 text-[var(--accent-2)]';
}
