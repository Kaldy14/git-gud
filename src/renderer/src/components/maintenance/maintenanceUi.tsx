import type { ReactElement, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Copy } from 'lucide-react';

import type { BranchCleanupCandidate } from '@shared/maintenance';

import { isAnalyzed } from './branchCleanupPresentation';
import { EVIDENCE_HINTS, EVIDENCE_LABELS } from './maintenanceFormat';

export function EvidenceBadge({ candidate }: { candidate: BranchCleanupCandidate }): ReactElement {
  const { evidence } = candidate;

  if (!isAnalyzed(candidate)) {
    const label = candidate.protectedReason ? 'Protected' : 'Not analyzed';
    const hint = candidate.protectedReason
      ? `${candidate.protectedReason}. Protected branches are not analyzed and cannot be deleted here.`
      : 'Newer than the age threshold, so merge status was not checked.';

    return <Badge tone="neutral" title={hint}>{label}</Badge>;
  }

  const tone = evidence === 'merged' ? 'success' : evidence === 'unmerged' || evidence === 'unknown' ? 'danger' : 'warning';
  return <Badge tone={tone} title={EVIDENCE_HINTS[evidence]}>{EVIDENCE_LABELS[evidence]}</Badge>;
}

export function Badge({
  tone,
  title,
  children
}: {
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  title?: string;
  children: ReactNode;
}): ReactElement {
  const classes = tone === 'success'
    ? 'border-[var(--success-border)] text-[var(--success-text)]'
    : tone === 'danger'
      ? 'border-[var(--danger-border)] text-[var(--danger-text)]'
      : tone === 'warning'
        ? 'border-[color-mix(in_srgb,var(--warning-text)_45%,var(--border))] text-[var(--warning-text)]'
        : 'border-[var(--border)] text-[var(--text-2)]';

  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded border px-1.5 text-[10.5px] font-medium leading-[18px] ${classes}`} title={title}>
      {children}
    </span>
  );
}

export function Warning({ tone, children }: { tone: 'danger' | 'warning' | 'success'; children: ReactNode }): ReactElement {
  const classes = tone === 'danger'
    ? 'border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-text)]'
    : tone === 'warning'
      ? 'border-[color-mix(in_srgb,var(--warning-text)_36%,var(--border))] bg-[var(--warning-bg)] text-[var(--warning-text)]'
      : 'border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-text)]';

  return (
    <div className={`flex gap-2 rounded border px-3 py-2 text-[11.5px] leading-4 ${classes}`}>
      {tone === 'success' ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" aria-hidden /> : <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />}
      <span>{children}</span>
    </div>
  );
}

export function InlineMessage({ tone, children }: { tone: 'error' | 'info' | 'warning'; children: ReactNode }): ReactElement {
  const classes = tone === 'error'
    ? 'border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-text)]'
    : tone === 'warning'
      ? 'border-[var(--border)] bg-[var(--warning-bg)] text-[var(--warning-text)]'
      : 'border-[var(--border)] text-[var(--text-2)]';

  return (
    <div className={`flex items-start gap-2 border-b px-4 py-1.5 text-[11.5px] leading-4 ${classes}`} role={tone === 'error' ? 'alert' : 'status'}>
      {tone === 'info' ? null : <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }): ReactElement {
  return <div className="grid h-full min-h-32 place-items-center px-6 text-center text-xs text-[var(--text-3)]">{children}</div>;
}

export function FieldLabel({ children }: { children: ReactNode }): ReactElement {
  return <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-3)]">{children}</span>;
}

export function SectionHeading({ children }: { children: ReactNode }): ReactElement {
  return <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-3)]">{children}</h3>;
}

export function CopyButton({ text, label, accessibleLabel }: { text: string; label: string; accessibleLabel: string }): ReactElement {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (status !== 'copied') {
      return;
    }

    const timeout = window.setTimeout(() => setStatus('idle'), 1500);
    return () => window.clearTimeout(timeout);
  }, [status]);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      if (mountedRef.current) {
        setStatus('copied');
      }
    } catch {
      if (mountedRef.current) {
        setStatus('failed');
      }
    }
  }

  return (
    <>
      <button className="review-comment-action" type="button" aria-label={accessibleLabel} title={text} onClick={() => void handleCopy()}>
        {status === 'copied' ? <Check size={12} /> : <Copy size={12} />}
        {status === 'copied' ? 'Copied' : label}
      </button>
      {status === 'failed' ? (
        <p className="w-full text-[11px] text-[var(--danger-text)]" role="alert">
          Could not copy to the clipboard. Select and copy it manually:{' '}
          <code className="mono select-all break-all text-[var(--text-2)]">{text}</code>
        </p>
      ) : null}
    </>
  );
}
