import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Archive,
  Ban,
  CheckCircle2,
  Copy,
  FileDiff,
  GitPullRequest,
  Loader2,
  RefreshCcw,
  RotateCcw,
  X
} from 'lucide-react';

import { operationAutoDismisses, operationEarnsCard } from '@renderer/components/operations/operationProgress';
import type { PullRecovery } from '@renderer/workspace/pullRecovery';
import type { GitOperationProgressEvent } from '@shared/types';

const AUTO_DISMISS_MS = 5_000;

type OperationLogStatus = 'pending' | 'success' | 'conflict' | 'error' | 'cancelled';
type OperationLogPhase = GitOperationProgressEvent['phase'] | 'refreshing';

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
  background?: boolean;
  /** Plain-language outcome shown instead of the raw error, which moves to Error details. */
  summary?: string;
  /** Keeps the card until the user dismisses it or recovers; it never auto-expires. */
  persistent?: boolean;
  recovery?: PullRecovery;
};

type OperationLogProps = {
  entries: OperationLogEntry[];
  onDismiss: (id: string) => void;
  onCancel: (entry: OperationLogEntry) => void;
  onRetry: (entry: OperationLogEntry) => void;
  onCopyDetails: (entry: OperationLogEntry) => void;
  onReviewChanges: (entry: OperationLogEntry) => void;
  onStashAndRetryPull: (entry: OperationLogEntry) => void;
  onResetLocalBranch: (entry: OperationLogEntry) => void;
  /** Judged per entry: a card can belong to a repository other than the active tab. */
  isRecoveryUnavailable: (repoPath: string) => boolean;
};

export function OperationLog({
  entries,
  onDismiss,
  onCancel,
  onRetry,
  onCopyDetails,
  onReviewChanges,
  onStashAndRetryPull,
  onResetLocalBranch,
  isRecoveryUnavailable
}: OperationLogProps): ReactElement | null {
  // Automatic operations are summarized in the status bar; only manual actions earn a card.
  const foregroundEntries = entries.filter((entry) => !entry.background);
  const now = useOperationClock(foregroundEntries.some((entry) => entry.status === 'pending'));
  const cardEntries = foregroundEntries.filter((entry) => operationEarnsCard(entry, now));

  // Expire every completed entry, including background ones the status bar shows briefly.
  useEffect(() => {
    const timers = entries
      .filter(operationAutoDismisses)
      .map((entry) => {
        const happenedAt = Date.parse(entry.happenedAt);
        const elapsedMs = Number.isNaN(happenedAt) ? 0 : Date.now() - happenedAt;
        const delayMs = Math.min(AUTO_DISMISS_MS, Math.max(0, AUTO_DISMISS_MS - elapsedMs));
        return window.setTimeout(() => onDismiss(entry.id), delayMs);
      });

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [entries, onDismiss]);

  if (foregroundEntries.length === 0) {
    return null;
  }

  return (
    <div
      className="pointer-events-none fixed bottom-8 left-4 z-40 flex w-[340px] max-w-[calc(100vw-32px)] flex-col gap-2"
    >
      <span className="sr-only" role="status" aria-live="polite">
        {foregroundEntries[0] ? operationAnnouncement(foregroundEntries[0]) : ''}
      </span>
      {cardEntries.slice(0, 5).map((entry) => {
        const isBriefSuccess = entry.status === 'success' && !entry.detail;

        return (
          <div
            key={entry.id}
            className={`pointer-events-auto relative overflow-hidden rounded-md border border-[var(--border-strong)] bg-[var(--bg-popover)] shadow-2xl shadow-black/40 ${isBriefSuccess ? 'px-3 py-1.5' : 'p-3'}`}
          >
            <span className={`absolute inset-y-0 left-0 w-1 ${operationStripeClass(entry.status)}`} aria-hidden="true" />
            <div className={`flex min-w-0 gap-2.5 ${isBriefSuccess ? 'items-center' : 'items-start'}`}>
              <span className={operationIconClass(entry.status)}>{operationIcon(entry.status)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-xs font-semibold text-[var(--text-1)]">{entry.label}</p>
                  {isBriefSuccess ? null : (
                    <span className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-[var(--text-3)]" aria-hidden="true">
                      {operationStatusLabel(entry, now)}
                    </span>
                  )}
                </div>
                {entry.summary ? (
                  <p className="mt-1 break-words text-[11px] leading-4 text-[var(--text-2)]">{entry.summary}</p>
                ) : entry.detail ? (
                  <p className="mt-1 max-h-12 overflow-hidden break-words text-[11px] leading-4 text-[var(--text-2)]">{entry.detail}</p>
                ) : null}
                {entry.recovery ? (
                  <PullRecoveryActions
                    recovery={entry.recovery}
                    isUnavailable={isRecoveryUnavailable(entry.recovery.repoPath)}
                    onReview={() => onReviewChanges(entry)}
                    onStashAndRetry={() => onStashAndRetryPull(entry)}
                    onReset={() => onResetLocalBranch(entry)}
                  />
                ) : null}
                {entry.summary && entry.detail ? (
                  <details className="mt-2 text-[11px] leading-4 text-[var(--text-3)]">
                    <summary className="cursor-pointer select-none">Error details</summary>
                    <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded border border-[var(--border)] bg-[var(--bg-field)] px-2 py-1.5 font-mono text-[11px] leading-4 text-[var(--text-2)]">
                      {entry.detail}
                    </pre>
                  </details>
                ) : null}
                {isBriefSuccess ? null : entry.status !== 'pending' ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    {entry.canRetry && (entry.status === 'error' || entry.status === 'cancelled') ? (
                      <button className="btn-subtle h-6 px-2 text-[11px]" type="button" onClick={() => onRetry(entry)}>
                        <RefreshCcw size={11} />
                        Retry
                      </button>
                    ) : null}
                    <button className="btn-subtle h-6 px-2 text-[11px]" type="button" onClick={() => onCopyDetails(entry)}>
                      <Copy size={11} />
                      Copy
                    </button>
                  </div>
                ) : entry.cancellable ? (
                  <button className="btn-subtle mt-2 h-6 px-2 text-[11px]" type="button" onClick={() => onCancel(entry)}>
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
        );
      })}
    </div>
  );
}

function PullRecoveryActions({
  recovery,
  isUnavailable,
  onReview,
  onStashAndRetry,
  onReset
}: {
  recovery: PullRecovery;
  isUnavailable: boolean;
  onReview: () => void;
  onStashAndRetry: () => void;
  onReset: () => void;
}): ReactElement {
  const resetLabel = recovery.upstream ? `Reset local ${recovery.branchName} to ${recovery.upstream}` : undefined;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      <button className="btn-subtle h-7 px-2 text-[11px]" type="button" disabled={isUnavailable} onClick={onReview}>
        <FileDiff size={12} />
        Review changes
      </button>
      <button className="btn-subtle h-7 px-2 text-[11px]" type="button" disabled={isUnavailable} onClick={onStashAndRetry}>
        <Archive size={12} />
        Stash and retry pull
      </button>
      {resetLabel ? (
        <button
          className="btn-danger h-7 max-w-full px-2 text-[11px]"
          type="button"
          title={resetLabel}
          disabled={isUnavailable}
          onClick={onReset}
        >
          <RotateCcw size={12} className="shrink-0" />
          <span className="min-w-0 truncate">{resetLabel}</span>
        </button>
      ) : null}
    </div>
  );
}

function operationAnnouncement(entry: OperationLogEntry): string {
  const state = entry.status === 'pending' ? (entry.phase ?? entry.status) : entry.status;
  const message = entry.summary ?? entry.detail;
  return `${entry.label}: ${state}${message ? `. ${message}` : ''}`;
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
    return 'shrink-0 text-[var(--success-text)]';
  }

  if (status === 'conflict') {
    return 'mt-0.5 shrink-0 text-[var(--warning-text)]';
  }

  if (status === 'error') {
    return 'mt-0.5 shrink-0 text-[var(--danger-text)]';
  }

  if (status === 'cancelled') {
    return 'mt-0.5 shrink-0 text-[var(--text-3)]';
  }

  return 'mt-0.5 shrink-0 text-[var(--accent-2)]';
}

function operationStripeClass(status: OperationLogStatus): string {
  if (status === 'success') {
    return 'bg-[var(--success-text)]';
  }

  if (status === 'conflict') {
    return 'bg-[var(--warning-text)]';
  }

  if (status === 'error') {
    return 'bg-[var(--danger-text)]';
  }

  if (status === 'cancelled') {
    return 'bg-[var(--text-3)]';
  }

  return 'bg-[var(--accent-2)]';
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
