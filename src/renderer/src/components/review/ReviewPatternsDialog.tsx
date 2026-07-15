import type { FormEvent, ReactElement } from 'react';
import { useId, useMemo, useState } from 'react';
import { Settings2, X } from 'lucide-react';

import { ModalSurface } from '@renderer/components/accessibility/ModalSurface';

import { parseReviewFilePatterns } from './reviewFilters';

type ReviewPatternsDialogProps = {
  repoPath: string;
  patterns: readonly string[];
  onSave: (patterns: string[]) => void;
  onClose: () => void;
};

export function ReviewPatternsDialog({
  repoPath,
  patterns,
  onSave,
  onClose
}: ReviewPatternsDialogProps): ReactElement {
  const titleId = useId();
  const descriptionId = useId();
  const textareaId = useId();
  const [draft, setDraft] = useState(() => patterns.join('\n'));
  const parsedPatterns = useMemo(() => parseReviewFilePatterns(draft), [draft]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSave(parsedPatterns);
  }

  return (
    <ModalSurface
      labelledBy={titleId}
      describedBy={descriptionId}
      className="w-full max-w-[560px] overflow-hidden rounded-lg border border-[var(--border-strong)] bg-[var(--bg-popover)] shadow-2xl shadow-black/70"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <header className="flex items-start gap-3 border-b border-[var(--border)] px-5 py-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--control-active-border)] bg-[var(--control-active-bg)] text-[var(--accent-2)]">
            <Settings2 size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[15px] font-semibold text-[var(--text-1)]">
              Review skip patterns
            </h2>
            <p id={descriptionId} className="mt-1 text-xs leading-5 text-[var(--text-2)]">
              These patterns apply only to this repository. Matching files are omitted when the Skip patterns checkbox is enabled.
            </p>
          </div>
          <button className="icon-btn h-7 w-7 shrink-0" type="button" onClick={onClose} aria-label="Close skip pattern settings">
            <X size={14} />
          </button>
        </header>

        <div className="space-y-3 px-5 py-4">
          <label className="block" htmlFor={textareaId}>
            <span className="mb-1.5 flex items-center justify-between gap-3 text-xs font-semibold text-[var(--text-1)]">
              <span>File patterns</span>
              <span className="font-normal text-[var(--text-3)]">{parsedPatterns.length} configured</span>
            </span>
            <textarea
              id={textareaId}
              data-modal-initial-focus="true"
              className="min-h-44 w-full resize-y rounded-md border border-[var(--border-strong)] bg-[var(--bg-field)] px-3 py-2.5 font-mono text-xs leading-5 text-[var(--text-1)] outline-none placeholder:text-[var(--text-3)] focus:border-[var(--select-border)]"
              value={draft}
              maxLength={10_000}
              placeholder={'dist/**\n*.snap\nsrc/generated/**'}
              spellCheck={false}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>

          <div className="rounded-md border border-[var(--border)] bg-[var(--bg-field)] px-3 py-2.5 text-[11px] leading-5 text-[var(--text-3)]">
            Enter one repository-relative pattern per line. Use <code className="text-[var(--text-2)]">*</code> within a path segment, <code className="text-[var(--text-2)]">**</code> across directories, and <code className="text-[var(--text-2)]">?</code> for one character. Lines beginning with <code className="text-[var(--text-2)]">#</code> are ignored.
          </div>

          <p className="truncate font-mono text-[10.5px] text-[var(--text-3)]" title={repoPath}>
            {repoPath}
          </p>
        </div>

        <footer className="flex min-h-14 items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--bg-graph-header)] px-5 py-3">
          <p className="text-[10.5px] text-[var(--text-3)]">Saving an empty list disables pattern skipping.</p>
          <div className="flex shrink-0 items-center gap-2">
            <button className="btn-subtle h-8 text-xs" type="button" onClick={onClose}>Cancel</button>
            <button className="btn-primary h-8 text-xs" type="submit">Save patterns</button>
          </div>
        </footer>
      </form>
    </ModalSurface>
  );
}
