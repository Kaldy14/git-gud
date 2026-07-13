import type { FormEvent, ReactElement } from 'react';
import { useId, useState } from 'react';
import { Gauge, GitGraph, Rows3, Settings, SplitSquareHorizontal, X } from 'lucide-react';

import { ModalSurface } from '@renderer/components/accessibility/ModalSurface';
import { MAX_GRAPH_PAGE_SIZE, MIN_GRAPH_PAGE_SIZE, clampGraphPageSize } from '@shared/settings';
import type { AppSettings } from '@shared/types';

type SettingsPanelProps = {
  settings: AppSettings;
  isSaving: boolean;
  errorMessage?: string;
  onClose: () => void;
  onSave: (settings: AppSettings) => Promise<void> | void;
};

export function SettingsPanel({ settings, isSaving, errorMessage, onClose, onSave }: SettingsPanelProps): ReactElement {
  const titleId = useId();
  const descriptionId = useId();
  const [draft, setDraft] = useState<AppSettings>(settings);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void onSave({
      ...draft,
      graphPageSize: clampGraphPageSize(draft.graphPageSize)
    });
  }

  return (
    <ModalSurface
      labelledBy={titleId}
      describedBy={descriptionId}
      className="h-full w-full max-w-[460px]"
      backdropClassName="fixed inset-0 z-50 flex items-stretch justify-end bg-black/45"
      onClose={onClose}
    >
      <form
        className="flex h-full w-full max-w-[460px] flex-col border-l border-[var(--border-strong)] bg-[var(--bg-panel)] shadow-2xl shadow-black/60"
        onSubmit={handleSubmit}
      >
        <header className="flex min-h-12 items-center gap-3 border-b border-[var(--border)] bg-[var(--bg-graph-header)] px-4">
          <Settings size={17} className="text-[var(--accent-2)]" />
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-sm font-semibold text-[var(--text-1)]">Settings</h2>
            <p id={descriptionId} className="mt-0.5 text-[11px] text-[var(--text-3)]">Local workflow defaults</p>
          </div>
          <button className="icon-btn h-7 w-7" type="button" onClick={onClose} aria-label="Close settings">
            <X size={14} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <section className="space-y-3 border-b border-[var(--border)] pb-4">
            <SettingHeading icon={<Rows3 size={15} />} label="Diffs" />
            <div className="segmented">
              <button
                type="button"
                data-active={draft.defaultDiffStyle === 'unified'}
                onClick={() => setDraft((value) => ({ ...value, defaultDiffStyle: 'unified' }))}
              >
                <Rows3 size={12} />
                Unified
              </button>
              <button
                type="button"
                data-active={draft.defaultDiffStyle === 'split'}
                onClick={() => setDraft((value) => ({ ...value, defaultDiffStyle: 'split' }))}
              >
                <SplitSquareHorizontal size={12} />
                Split
              </button>
            </div>
          </section>

          <section className="space-y-3 border-b border-[var(--border)] py-4">
            <SettingHeading icon={<GitGraph size={15} />} label="Graph" />
            <label className="block text-xs text-[var(--text-2)]">
              <span className="mb-1.5 block font-semibold text-[var(--text-1)]">Initial commit rows</span>
              <input
                className="h-9 w-full rounded border border-[var(--border)] bg-[var(--bg-field)] px-3 text-xs text-[var(--text-1)] outline-none transition focus:border-[var(--select-border)]"
                type="number"
                min={MIN_GRAPH_PAGE_SIZE}
                max={MAX_GRAPH_PAGE_SIZE}
                step={250}
                value={draft.graphPageSize}
                onChange={(event) =>
                  setDraft((value) => ({
                    ...value,
                    graphPageSize: Number.parseInt(event.target.value, 10) || MIN_GRAPH_PAGE_SIZE
                  }))
                }
              />
              <span className="mt-1.5 block leading-5 text-[var(--text-3)]">
                Load more remains available after the initial page.
              </span>
            </label>
            <label className="flex items-start gap-2 rounded border border-[var(--border)] bg-[var(--bg-field)] px-3 py-2.5 text-xs text-[var(--text-2)]">
              <input
                className="mt-0.5"
                type="checkbox"
                checked={draft.largeRepoMode}
                onChange={(event) => setDraft((value) => ({ ...value, largeRepoMode: event.target.checked }))}
              />
              <span className="min-w-0">
                <span className="block font-semibold text-[var(--text-1)]">Large-repo mode</span>
                <span className="mt-1 block leading-5 text-[var(--text-3)]">
                  Reduces graph overscan for very large histories.
                </span>
              </span>
            </label>
            <fieldset className="space-y-2 rounded border border-[var(--border)] bg-[var(--bg-field)] px-3 py-2.5">
              <legend className="px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">Graph metadata</legend>
              <label className="flex items-center gap-2 text-xs text-[var(--text-2)]">
                <input
                  type="checkbox"
                  checked={draft.graphColumns.sha}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      graphColumns: { ...value.graphColumns, sha: event.target.checked }
                    }))
                  }
                />
                Short SHA
              </label>
              <p className="text-[11px] leading-4 text-[var(--text-3)]">The commit message stays the primary history detail.</p>
            </fieldset>
            <label className="flex items-start gap-2 rounded border border-[var(--border)] bg-[var(--bg-field)] px-3 py-2.5 text-xs text-[var(--text-2)]">
              <input
                className="mt-0.5"
                type="checkbox"
                checked={draft.remoteAvatars}
                onChange={(event) => setDraft((value) => ({ ...value, remoteAvatars: event.target.checked }))}
              />
              <span className="min-w-0">
                <span className="block font-semibold text-[var(--text-1)]">Load remote author avatars</span>
                <span className="mt-1 block leading-5 text-[var(--text-3)]">On by default. Disable to keep author identities local and use generated avatars.</span>
              </span>
            </label>
          </section>

          {errorMessage ? <p className="text-[11px] text-[var(--danger-text)]" role="alert">{errorMessage}</p> : null}
        </div>

        <footer className="flex min-h-14 items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--bg-graph-header)] px-4">
          <button className="btn-subtle h-8 text-xs" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary h-8 text-xs" type="submit" disabled={isSaving}>
            <Gauge size={13} />
            Save Settings
          </button>
        </footer>
      </form>
    </ModalSurface>
  );
}

function SettingHeading({ icon, label }: { icon: ReactElement; label: string }): ReactElement {
  return (
    <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-3)]">
      {icon}
      {label}
    </h3>
  );
}
