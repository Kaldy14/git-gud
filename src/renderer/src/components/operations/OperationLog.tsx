import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { AlertCircle, Ban, CheckCircle2, Copy, GitPullRequest, Loader2, RefreshCcw, Terminal, X } from 'lucide-react';

import type { GitOperationProgressEvent } from '@shared/types';

export type OperationLogStatus = 'pending' | 'success' | 'conflict' | 'error' | 'cancelled';
export type OperationLogPhase = GitOperationProgressEvent['phase'] | 'refreshing';

export type OperationLogEntry = {
  id: string;
  operationId?: string;
  repoPath: string;
  label: string;
  status: OperationLogStatus;
  phase?: OperationLogPhase;
  detail?: string;
  startedAt: string;
  happenedAt: string;
  elapsedMs?: number;
  cancellable?: boolean;
  canRetry?: boolean;
  waitsForRefresh?: boolean;
};

type OperationLogProps = {
  entries: OperationLogEntry[];
  onDismiss: (id: string) => void;
  onCancel: (entry: OperationLogEntry) => void;
  onRetry: (entry: OperationLogEntry) => void;
  onOpenTerminal: (repoPath: string) => void;
  onCopyDetails: (entry: OperationLogEntry) => void;
};

export function OperationLog({
  entries,
  onDismiss,
  onCancel,
  onRetry,
  onOpenTerminal,
  onCopyDetails
}: OperationLogProps): ReactElement | null {
  const now = useOperationClock(entries.some((entry) => entry.status === 'pending'));

  if (entries.length === 0) {
    return null;
  }

  return (
    <div
      className="pointer-events-none fixed bottom-8 right-4 z-40 flex w-[340px] max-w-[calc(100vw-32px)] flex-col gap-2"
    >
      <span className="sr-only" role="status" aria-live="polite">
        {entries[0] ? operationAnnouncement(entries[0]) : ''}
      </span>
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
                <span className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-[var(--text-3)]" aria-hidden="true">
                  {operationStatusLabel(entry, now)}
                </span>
              </div>
              {entry.detail ? <p className="mt-1 max-h-12 overflow-hidden break-words text-[11px] leading-4 text-[var(--text-2)]">{entry.detail}</p> : null}
              {entry.status !== 'pending' ? (
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {entry.canRetry && (entry.status === 'error' || entry.status === 'cancelled') ? (
                    <button className="btn-subtle h-6 px-2 text-[10px]" type="button" onClick={() => onRetry(entry)}>
                      <RefreshCcw size={11} />
                      Retry
                    </button>
                  ) : null}
                  <button className="btn-subtle h-6 px-2 text-[10px]" type="button" onClick={() => onOpenTerminal(entry.repoPath)}>
                    <Terminal size={11} />
                    Terminal
                  </button>
                  <button className="btn-subtle h-6 px-2 text-[10px]" type="button" onClick={() => onCopyDetails(entry)}>
                    <Copy size={11} />
                    Copy
                  </button>
                </div>
              ) : entry.cancellable ? (
                <button className="btn-subtle mt-2 h-6 px-2 text-[10px]" type="button" onClick={() => onCancel(entry)}>
                  <Ban size={11} />
                  Cancel
                </button>
              ) : null}
            </div>
            {entry.status !== 'pending' ? (
              <button className="icon-btn h-6 w-6 shrink-0" type="button" onClick={() => onDismiss(entry.id)} aria-label={`Dismiss ${entry.label}`}>
                <X size={12} />
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function operationAnnouncement(entry: OperationLogEntry): string {
  const state = entry.status === 'pending' ? (entry.phase ?? entry.status) : entry.status;
  return `${entry.label}: ${state}${entry.detail ? `. ${entry.detail}` : ''}`;
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

  if (status === 'cancelled') {
    return <Ban size={15} />;
  }

  return <AlertCircle size={15} />;
}

function operationIconClass(status: OperationLogStatus): string {
  if (status === 'success') {
    return 'mt-0.5 shrink-0 text-[var(--success-text)]';
  }

  if (status === 'conflict' || status === 'error' || status === 'cancelled') {
    return 'mt-0.5 shrink-0 text-[var(--danger-text)]';
  }

  return 'mt-0.5 shrink-0 text-[var(--accent-2)]';
}

function useOperationClock(enabled: boolean): number {
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [enabled]);

  return now;
}

function operationStatusLabel(entry: OperationLogEntry, now: number): string {
  if (entry.status !== 'pending') {
    return entry.status;
  }

  const elapsedMs = Math.max(entry.elapsedMs ?? 0, now - Date.parse(entry.startedAt));
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  return `${entry.phase ?? 'queued'} ${elapsedSeconds}s`;
}
