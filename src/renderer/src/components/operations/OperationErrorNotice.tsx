import type { ReactElement, ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

import { describeOperationError } from '@renderer/lib/ipcErrors';

type OperationErrorNoticeProps = {
  message: string;
  children?: ReactNode;
};

export function OperationErrorNotice({ message, children }: OperationErrorNoticeProps): ReactElement {
  const { summary, hint, detail } = describeOperationError(message);

  return (
    <div className="flex shrink-0 items-start gap-3 border-b border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-3 text-[var(--danger-text)]" role="alert">
      <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold [overflow-wrap:anywhere]">{summary}</p>
        {hint ? <p className="mt-1 text-xs leading-5 text-[var(--text-2)]">{hint}</p> : null}
        {detail ? (
          <details className="mt-1.5 max-w-4xl text-xs text-[var(--text-2)]">
            <summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)]">Git details</summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap [scrollbar-gutter:stable] rounded-md border border-[var(--danger-border)] bg-[var(--bg-field)] p-3 text-xs leading-5 [overflow-wrap:anywhere]">{detail}</pre>
          </details>
        ) : null}
      </div>
      {children}
    </div>
  );
}
