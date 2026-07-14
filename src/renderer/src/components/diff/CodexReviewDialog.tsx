import type { FormEvent, ReactElement } from 'react';
import { useId, useState } from 'react';
import { Code2, ExternalLink, Loader2, Sparkles, TriangleAlert, X } from 'lucide-react';

import { ModalSurface } from '@renderer/components/accessibility/ModalSurface';
import {
  buildCodexReviewPrompt,
  DEFAULT_CODEX_REVIEW_QUESTION,
  type CodexReviewSelection
} from '@renderer/components/diff/codexReviewPrompt';

type CodexReviewDialogProps = {
  repoPath: string;
  selection: CodexReviewSelection;
  onClose: () => void;
};

export function CodexReviewDialog({ repoPath, selection, onClose }: CodexReviewDialogProps): ReactElement {
  const titleId = useId();
  const descriptionId = useId();
  const questionId = useId();
  const [question, setQuestion] = useState(DEFAULT_CODEX_REVIEW_QUESTION);
  const [isOpening, setIsOpening] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const canSubmit = question.trim().length > 0 && !isOpening;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    setIsOpening(true);
    setErrorMessage(undefined);

    try {
      await window.api.openCodexTask(repoPath, buildCodexReviewPrompt(repoPath, selection, question));
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to open Codex.');
      setIsOpening(false);
    }
  }

  return (
    <ModalSurface
      labelledBy={titleId}
      describedBy={descriptionId}
      className="w-full max-w-[620px] overflow-hidden rounded-lg border border-[var(--ai-border)] bg-[var(--bg-popover)] shadow-2xl shadow-black/70"
      onClose={onClose}
    >
      <form onSubmit={(event) => void handleSubmit(event)}>
        <header className="relative overflow-hidden border-b border-[var(--border)] px-5 py-4">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(139,63,246,0.22),transparent_48%)]" />
          <div className="relative flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--ai-border)] bg-[var(--ai-bg)] text-[var(--ai-text)] shadow-[0_0_24px_rgba(139,63,246,0.18)]">
              <Sparkles size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--ai-text)]">Codex handoff</p>
              <h2 id={titleId} className="text-[15px] font-semibold text-[var(--text-1)]">Ask about this code</h2>
              <p id={descriptionId} className="mt-1 text-xs leading-5 text-[var(--text-2)]">
                A new Codex task will open in <span className="font-semibold text-[var(--text-1)]">{projectName(repoPath)}</span> with this context prefilled. Review it there, then send.
              </p>
            </div>
            <button className="icon-btn h-7 w-7 shrink-0" type="button" onClick={onClose} aria-label="Close Codex handoff">
              <X size={14} />
            </button>
          </div>
        </header>

        <div className="space-y-4 px-5 py-4">
          <label className="block" htmlFor={questionId}>
            <span className="mb-1.5 block text-xs font-semibold text-[var(--text-1)]">What should Codex explain?</span>
            <textarea
              id={questionId}
              data-modal-initial-focus="true"
              className="min-h-24 w-full resize-y rounded-md border border-[var(--border-strong)] bg-[var(--bg-field)] px-3 py-2.5 text-xs leading-5 text-[var(--text-1)] outline-none transition placeholder:text-[var(--text-3)] focus:border-[var(--ai-border)]"
              value={question}
              maxLength={2_000}
              onChange={(event) => setQuestion(event.target.value)}
            />
          </label>

          <section className="overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg-field)]" aria-label="Selected code preview">
            <header className="flex min-h-9 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-graph-header)] px-3 text-[11px] text-[var(--text-3)]">
              <Code2 size={13} className="shrink-0 text-[var(--ai-text)]" />
              <span className="min-w-0 flex-1 truncate font-semibold text-[var(--text-2)]" title={selection.filePath}>{selection.filePath}</span>
              <span className="shrink-0">{selection.lineCount} line{selection.lineCount === 1 ? '' : 's'}</span>
            </header>
            <pre className="max-h-44 overflow-auto whitespace-pre p-3 text-[11px] leading-[18px] text-[var(--text-2)]"><code>{selection.code}</code></pre>
          </section>

          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11px] leading-4">
            <span className="text-[var(--text-3)]">Revision</span>
            <span className="mono truncate text-[var(--text-2)]" title={selection.revision}>{selection.revision}</span>
            <span className="text-[var(--text-3)]">Change</span>
            <span className="truncate text-[var(--text-2)]" title={selection.subject}>{selection.subject}</span>
          </div>

          {selection.truncated ? (
            <p className="flex items-start gap-2 rounded border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-[11px] leading-4 text-[var(--danger-text)]">
              <TriangleAlert size={13} className="mt-0.5 shrink-0" />
              The selection was large, so the handoff includes its first 12,000 characters. Select a smaller region for full fidelity.
            </p>
          ) : null}

          {errorMessage ? (
            <p className="rounded border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-xs text-[var(--danger-text)]" role="alert">
              {errorMessage}
            </p>
          ) : null}
        </div>

        <footer className="flex min-h-14 items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--bg-graph-header)] px-5 py-3">
          <p className="text-[10.5px] text-[var(--text-3)]">Opens a prefilled local task; Codex does not auto-submit it.</p>
          <div className="flex shrink-0 items-center gap-2">
            <button className="btn-subtle h-8 text-xs" type="button" onClick={onClose}>Cancel</button>
            <button className="btn-primary h-8 min-w-32 text-xs" type="submit" disabled={!canSubmit}>
              {isOpening ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />}
              Open in Codex
            </button>
          </div>
        </footer>
      </form>
    </ModalSurface>
  );
}

function projectName(repoPath: string): string {
  return repoPath.split(/[\\/]/).filter(Boolean).at(-1) ?? repoPath;
}
