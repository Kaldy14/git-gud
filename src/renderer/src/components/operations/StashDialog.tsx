/* eslint-disable react-refresh/only-export-components -- Selection helpers are exported for focused Node tests. */
import type { FormEvent, ReactElement } from 'react';
import { useId, useMemo, useState } from 'react';
import { Archive, X } from 'lucide-react';

import { ModalSurface } from '@renderer/components/accessibility/ModalSurface';
import type { GitFileChangeDetail, GitStashPushInput } from '@shared/types';

type StashDialogProps = {
  files: GitFileChangeDetail[];
  defaultMessage: string;
  initialPaths?: string[];
  isBusy: boolean;
  onClose: () => void;
  onSubmit: (input: GitStashPushInput) => void;
};

export type StashSelection = {
  includeUntracked: boolean;
  selectedPaths: string[];
};

export function createInitialStashSelection(
  files: GitFileChangeDetail[],
  initialPaths?: string[]
): StashSelection {
  if (initialPaths) {
    const requestedPaths = new Set(initialPaths);
    const includeUntracked = files.some(
      (file) => requestedPaths.has(file.path) && file.status === 'untracked'
    );

    return {
      includeUntracked,
      selectedPaths: selectablePaths(files, includeUntracked).filter((path) => requestedPaths.has(path))
    };
  }

  return {
    includeUntracked: false,
    selectedPaths: selectablePaths(files, false)
  };
}

export function setStashIncludeUntracked(
  files: GitFileChangeDetail[],
  selection: StashSelection,
  includeUntracked: boolean
): StashSelection {
  const untrackedPaths = new Set(
    files.filter((file) => !file.conflicted && file.status === 'untracked').map((file) => file.path)
  );
  const selectedPaths = includeUntracked
    ? orderedUniquePaths([...selection.selectedPaths, ...untrackedPaths])
    : selection.selectedPaths.filter((path) => !untrackedPaths.has(path));

  return { includeUntracked, selectedPaths };
}

export function toggleAllStashPaths(files: GitFileChangeDetail[], selection: StashSelection): StashSelection {
  const eligiblePaths = selectablePaths(files, selection.includeUntracked);
  const selected = new Set(selection.selectedPaths);
  const allSelected = eligiblePaths.length > 0 && eligiblePaths.every((path) => selected.has(path));

  if (allSelected) {
    const eligible = new Set(eligiblePaths);
    return { ...selection, selectedPaths: selection.selectedPaths.filter((path) => !eligible.has(path)) };
  }

  return { ...selection, selectedPaths: orderedUniquePaths([...eligiblePaths, ...selection.selectedPaths]) };
}

export function toggleStashPath(selection: StashSelection, path: string): StashSelection {
  const selected = new Set(selection.selectedPaths);

  if (selected.has(path)) {
    return { ...selection, selectedPaths: selection.selectedPaths.filter((selectedPath) => selectedPath !== path) };
  }

  return { ...selection, selectedPaths: [...selection.selectedPaths, path] };
}

export function buildStashPushInput(
  files: GitFileChangeDetail[],
  selection: StashSelection,
  message: string
): GitStashPushInput {
  const selected = new Set(selection.selectedPaths);

  return {
    message: message.trim() || undefined,
    includeUntracked: selection.includeUntracked,
    paths: selectablePaths(files, selection.includeUntracked).filter((path) => selected.has(path))
  };
}

export function StashDialog({ files, defaultMessage, initialPaths, isBusy, onClose, onSubmit }: StashDialogProps): ReactElement {
  const titleId = useId();
  const descriptionId = useId();
  const [message, setMessage] = useState(defaultMessage);
  const [selection, setSelection] = useState<StashSelection>(() => createInitialStashSelection(files, initialPaths));
  const visibleFiles = useMemo(() => files.filter((file) => !file.conflicted), [files]);
  const eligiblePaths = useMemo(() => selectablePaths(files, selection.includeUntracked), [files, selection.includeUntracked]);
  const selected = useMemo(() => new Set(selection.selectedPaths), [selection.selectedPaths]);
  const allSelected = eligiblePaths.length > 0 && eligiblePaths.every((path) => selected.has(path));
  const selectedCount = eligiblePaths.filter((path) => selected.has(path)).length;
  const partiallySelected = selectedCount > 0 && !allSelected;
  const canSubmit = selectedCount > 0 && !isBusy;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (canSubmit) {
      onSubmit(buildStashPushInput(files, selection, message));
    }
  }

  return (
    <ModalSurface
      labelledBy={titleId}
      describedBy={descriptionId}
      className="w-full max-w-[560px] rounded-md border border-[var(--border-strong)] bg-[var(--bg-popover)] shadow-2xl shadow-black/60"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit}>
        <header className="flex min-h-12 items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <Archive size={17} className="shrink-0 text-[var(--accent-2)]" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-sm font-semibold text-[var(--text-1)]">Stash changes</h2>
            <p id={descriptionId} className="mt-1 text-xs leading-5 text-[var(--text-2)]">
              Choose the files to save in this stash.
            </p>
          </div>
          <button className="icon-btn h-7 w-7" type="button" onClick={onClose} aria-label="Close stash dialog">
            <X size={14} />
          </button>
        </header>

        <div className="space-y-4 px-4 py-4">
          <label className="block text-xs text-[var(--text-2)]">
            <span className="mb-1.5 block font-semibold text-[var(--text-1)]">Message</span>
            <input
              className="h-9 w-full rounded border border-[var(--border)] bg-[var(--bg-field)] px-3 text-xs text-[var(--text-1)] outline-none transition focus:border-[var(--select-border)]"
              type="text"
              value={message}
              disabled={isBusy}
              data-modal-initial-focus="true"
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>

          <div className="overflow-hidden rounded border border-[var(--border)] bg-[var(--bg-field)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2.5">
              <label className="flex items-center gap-2 text-xs font-semibold text-[var(--text-1)]">
                <input
                  ref={(input) => {
                    if (input) {
                      input.indeterminate = partiallySelected;
                    }
                  }}
                  type="checkbox"
                  checked={allSelected}
                  disabled={eligiblePaths.length === 0 || isBusy}
                  aria-label="Select all eligible files"
                  aria-checked={partiallySelected ? 'mixed' : allSelected}
                  onChange={() => setSelection((current) => toggleAllStashPaths(files, current))}
                />
                Select all
              </label>
              <span className="text-[11px] text-[var(--text-3)]">
                {selectedCount} of {eligiblePaths.length} selected
              </span>
            </div>

            <div className="max-h-64 overflow-y-auto" aria-label="Files to stash" role="group">
              {visibleFiles.length > 0 ? visibleFiles.map((file) => {
                const isUntracked = file.status === 'untracked';
                const disabled = isBusy || (isUntracked && !selection.includeUntracked);

                return (
                  <label
                    key={file.path}
                    className="flex items-center gap-2.5 border-b border-[var(--border)] px-3 py-2 text-xs last:border-b-0"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(file.path)}
                      disabled={disabled}
                      aria-label={`Stash ${file.path}`}
                      onChange={() => setSelection((current) => toggleStashPath(current, file.path))}
                    />
                    <span className={disabled ? 'min-w-0 flex-1 truncate text-[var(--text-3)]' : 'min-w-0 flex-1 truncate text-[var(--text-1)]'}>
                      {file.path}
                    </span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--text-3)]">
                      {isUntracked ? 'untracked' : file.status}
                    </span>
                  </label>
                );
              }) : (
                <p className="px-3 py-5 text-center text-xs text-[var(--text-3)]">No stashable files.</p>
              )}
            </div>
          </div>

          <label className="flex items-start gap-2 rounded border border-[var(--border)] bg-[var(--bg-field)] px-3 py-2.5 text-xs text-[var(--text-2)]">
            <input
              className="mt-0.5"
              type="checkbox"
              checked={selection.includeUntracked}
              disabled={isBusy}
              onChange={(event) => setSelection((current) => setStashIncludeUntracked(files, current, event.target.checked))}
            />
            <span>
              <span className="block font-semibold text-[var(--text-1)]">Include untracked files</span>
              <span className="mt-1 block leading-5 text-[var(--text-3)]">Enable untracked files and add them to this stash.</span>
            </span>
          </label>
        </div>

        <footer className="flex min-h-14 items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--bg-graph-header)] px-4 py-3">
          <button className="btn-subtle h-8 text-xs" type="button" disabled={isBusy} onClick={onClose}>Cancel</button>
          <button className="btn-primary h-8 text-xs" type="submit" disabled={!canSubmit}>
            {isBusy ? 'Stashing…' : 'Stash selected'}
          </button>
        </footer>
      </form>
    </ModalSurface>
  );
}

function selectablePaths(files: GitFileChangeDetail[], includeUntracked: boolean): string[] {
  return orderedUniquePaths(
    files
      .filter((file) => !file.conflicted && (file.status !== 'untracked' || includeUntracked))
      .map((file) => file.path)
  );
}

function orderedUniquePaths(paths: Iterable<string>): string[] {
  return [...new Set(paths)];
}
