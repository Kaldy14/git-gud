import { useId, useState, type ReactElement, type ReactNode } from 'react';
import {
  Check,
  CheckCircle2,
  ExternalLink,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X
} from 'lucide-react';

import { ModalSurface } from '@renderer/components/accessibility/ModalSurface';
import type { ReleaseNoteCategory, ReleaseNotes } from '@shared/changelog';

import { markChangelogSeen, shouldShowChangelog } from './changelogVisibility';

const MAX_HIGHLIGHTS = 3;

type ChangelogDialogProps = {
  releaseNotes: ReleaseNotes;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
};

export function ChangelogDialog({
  releaseNotes,
  storage = window.localStorage
}: ChangelogDialogProps): ReactElement | null {
  const titleId = useId();
  const descriptionId = useId();
  const [isOpen, setIsOpen] = useState(() =>
    shouldShowChangelog(releaseNotes.version, storage)
  );

  if (!isOpen) {
    return null;
  }

  const highlights = releaseNotes.notes.slice(0, MAX_HIGHLIGHTS);
  const releaseUrl = `https://github.com/Kaldy14/git-gud/releases/tag/v${releaseNotes.version}`;

  function close(): void {
    markChangelogSeen(releaseNotes.version, storage);
    setIsOpen(false);
  }

  return (
    <ModalSurface
      labelledBy={titleId}
      describedBy={descriptionId}
      className="w-full max-w-[520px] overflow-hidden rounded-lg border border-[var(--border-strong)] bg-[var(--bg-popover)] shadow-2xl shadow-black/70"
      onClose={close}
    >
      <header className="flex min-h-14 items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-graph-header)] px-5 py-3.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[color-mix(in_srgb,var(--accent-2)_45%,var(--border))] bg-[color-mix(in_srgb,var(--accent)_12%,var(--bg-field))] text-[var(--accent-2)]">
          <CheckCircle2 size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-sm font-semibold text-[var(--text-1)]">
            Git Gud was updated
          </h2>
          <p className="mt-0.5 text-[10.5px] text-[var(--text-3)]">
            Version {releaseNotes.version}
          </p>
        </div>
        <button
          className="icon-btn icon-btn-compact shrink-0"
          type="button"
          onClick={close}
          aria-label="Close changelog"
        >
          <X size={14} />
        </button>
      </header>

      <div className="max-h-[min(520px,62vh)] overflow-y-auto px-5 py-4">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--accent-2)]">
          What's new
        </p>
        <p id={descriptionId} className="mb-4 text-xs leading-5 text-[var(--text-2)]">
          {releaseSummary(releaseNotes.notes.length)}
        </p>

        <div className="space-y-2">
          {highlights.length > 0 ? (
            highlights.map((note, index) => (
              <article
                key={`${note.category}:${index}:${note.text}`}
                className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-field)] px-3 py-2.5"
              >
                <span className="grid h-8 w-8 place-items-center rounded-md bg-[var(--bg-surface)] text-[var(--accent-2)]">
                  {releaseNoteIcon(note.category)}
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-3)]">
                    {note.category}
                  </p>
                  <p className="mt-1 text-[11.5px] leading-[18px] text-[var(--text-2)]">
                    {note.text}
                  </p>
                </div>
              </article>
            ))
          ) : (
            <article className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-field)] px-3 py-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-md bg-[var(--bg-surface)] text-[var(--accent-2)]">
                <Check size={15} />
              </span>
              <p className="self-center text-[11.5px] leading-[18px] text-[var(--text-2)]">
                Git Gud is now running version {releaseNotes.version}.
              </p>
            </article>
          )}
        </div>

        {releaseNotes.notes.length > MAX_HIGHLIGHTS ? (
          <p className="mt-3 text-[10.5px] text-[var(--text-3)]">
            {releaseNotes.notes.length - MAX_HIGHLIGHTS} more change{releaseNotes.notes.length - MAX_HIGHLIGHTS === 1 ? '' : 's'} in the full release notes.
          </p>
        ) : null}
      </div>

      <footer className="flex min-h-14 items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--bg-graph-header)] px-5 py-3">
        <a
          className="btn-subtle btn-regular text-[11px]"
          href={releaseUrl}
          target="_blank"
          rel="noreferrer"
          onClick={close}
        >
          <ExternalLink size={12} />
          Full release notes
        </a>
        <button
          className="btn-primary btn-regular text-xs"
          type="button"
          data-modal-initial-focus="true"
          onClick={close}
        >
          Start using v{releaseNotes.version}
        </button>
      </footer>
    </ModalSurface>
  );
}

function releaseSummary(noteCount: number): string {
  if (noteCount === 0) {
    return 'The update installed successfully.';
  }

  if (noteCount === 1) {
    return 'This release has one notable change.';
  }

  return `This release has ${noteCount} notable changes. Here are the highlights.`;
}

function releaseNoteIcon(category: ReleaseNoteCategory): ReactNode {
  switch (category) {
    case 'Added':
      return <Plus size={15} />;
    case 'Changed':
    case 'Deprecated':
      return <RefreshCw size={14} />;
    case 'Removed':
      return <Trash2 size={14} />;
    case 'Fixed':
      return <Check size={15} />;
    case 'Security':
      return <ShieldCheck size={14} />;
  }
}
