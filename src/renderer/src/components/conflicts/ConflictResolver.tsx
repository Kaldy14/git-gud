import type { KeyboardEvent, ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  FileWarning,
  GitMerge,
  Loader2,
  Save,
  Trash2,
  X
} from 'lucide-react';

import {
  conflictFileQueryKey,
  invalidateRepositoryQueries,
  useConflictFile
} from '@renderer/queries/repository';
import type {
  GitConflictFile,
  GitConflictFileResolutionInput,
  GitConflictFileVersion,
  GitConflictOperation
} from '@shared/types';

import { parseConflictMarkers, resolveConflictMarker } from './conflictMarkers';

type ConflictResolverProps = {
  repoPath: string;
  path: string;
  unresolvedPaths: string[];
  operation?: GitConflictOperation;
  isOperationBusy: boolean;
  onSelectFile: (path: string) => void;
  onClose: () => void;
};

type ResolutionDraft =
  | { kind: 'text'; content: string }
  | { kind: 'ours' | 'theirs' | 'delete' };

export function ConflictResolver({
  repoPath,
  path,
  unresolvedPaths,
  operation,
  isOperationBusy,
  onSelectFile,
  onClose
}: ConflictResolverProps): ReactElement {
  const sectionRef = useRef<HTMLElement>(null);
  const outputRef = useRef<HTMLTextAreaElement>(null);
  const queryClient = useQueryClient();
  const [isResolving, setIsResolving] = useState(false);
  const conflictQuery = useConflictFile(repoPath, path, !isResolving);
  const conflictFile = conflictQuery.data;
  const [draftOverride, setDraft] = useState<ResolutionDraft>();
  const draft = draftOverride ?? initialDraft(conflictFile);
  const [currentConflictIndex, setCurrentConflictIndex] = useState(0);
  const markers = useMemo(
    () => (draft?.kind === 'text' ? parseConflictMarkers(draft.content) : []),
    [draft]
  );
  const currentConflict = markers[Math.min(currentConflictIndex, Math.max(0, markers.length - 1))];
  const isSaving = isOperationBusy || isResolving;
  const canSave = Boolean(draft) && markers.length === 0 && !isSaving;
  const currentPathIndex = Math.max(0, unresolvedPaths.indexOf(path));
  const displayIndex = currentPathIndex + 1;

  const saveMutation = useMutation({
    mutationKey: ['repository-mutation', repoPath],
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: conflictFileQueryKey(repoPath, path) });
    },
    mutationFn: async (input: GitConflictFileResolutionInput) => window.api.resolveConflictFile(repoPath, input),
    onSuccess: async (result) => {
      queryClient.removeQueries({ queryKey: conflictFileQueryKey(repoPath, path) });
      await invalidateRepositoryQueries(queryClient, result.repoPath, result.invalidates ?? []);
      const nextPath = nextUnresolvedPath(unresolvedPaths, path);

      if (nextPath) {
        onSelectFile(nextPath);
      } else {
        onClose();
      }
    },
    onError: () => {
      setIsResolving(false);
    }
  });

  useEffect(() => {
    if (!currentConflict || !outputRef.current) {
      return;
    }

    outputRef.current.setSelectionRange(currentConflict.startOffset, currentConflict.endOffset);
    outputRef.current.scrollTop = Math.max(0, currentConflict.startLine - 2) * 18;
  }, [currentConflict]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.metaKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      handleSave();
      return;
    }

    if (event.key === 'Escape' && event.target === sectionRef.current) {
      event.preventDefault();
      onClose();
    }
  }

  function chooseSide(side: 'ours' | 'theirs'): void {
    const version = conflictFile?.[side];

    if (!version) {
      setDraft({ kind: 'delete' });
    } else if (version.content !== undefined && !conflictFile?.omittedReason) {
      setDraft({ kind: 'text', content: version.content });
    } else {
      setDraft({ kind: side });
    }

    setCurrentConflictIndex(0);
  }

  function resolveCurrent(side: 'ours' | 'theirs'): void {
    if (draft?.kind !== 'text' || !currentConflict) {
      return;
    }

    setDraft({ kind: 'text', content: resolveConflictMarker(draft.content, currentConflict, side) });
    setCurrentConflictIndex((index) => Math.min(index, Math.max(0, markers.length - 2)));
  }

  function handleSave(): void {
    if (!draft || markers.length > 0 || isSaving || saveMutation.isPending) {
      return;
    }

    setIsResolving(true);
    saveMutation.mutate({
      path,
      resolution: draft.kind === 'text' ? 'content' : draft.kind,
      ...(draft.kind === 'text' ? { content: draft.content } : {})
    });
  }

  const errorMessage =
    saveMutation.error instanceof Error
      ? saveMutation.error.message
      : conflictQuery.error instanceof Error
        ? conflictQuery.error.message
        : undefined;

  return (
    <section
      ref={sectionRef}
      className="conflict-resolver"
      tabIndex={0}
      aria-label={`Resolve conflict in ${path}`}
      onKeyDown={handleKeyDown}
    >
      <header className="conflict-resolver-header">
        <div className="flex min-w-0 items-center gap-2.5">
          <button className="icon-btn h-7 w-7 shrink-0" type="button" onClick={onClose} title="Back to graph" aria-label="Back to graph">
            <ChevronLeft size={14} />
          </button>
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-text)]">
            <GitMerge size={14} />
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-xs font-semibold text-[var(--text-1)]">{path}</span>
              {conflictFile ? <span className="badge-mini shrink-0">{formatConflictKind(conflictFile.kind)}</span> : null}
            </div>
            <div className="mt-0.5 text-[10.5px] text-[var(--text-3)]">
              {formatOperation(operation ?? conflictFile?.operation)} · file {displayIndex} of {unresolvedPaths.length} unresolved
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden text-[10.5px] text-[var(--text-3)] min-[980px]:inline">⌘S to save and stage</span>
          <button
            className="btn-primary h-8 px-3 text-xs"
            type="button"
            disabled={!canSave || saveMutation.isPending}
            title={markers.length > 0 ? `Resolve ${markers.length} remaining conflict${markers.length === 1 ? '' : 's'} first` : 'Save result and mark file resolved'}
            onClick={handleSave}
          >
            {saveMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Save &amp; stage
          </button>
          <button className="icon-btn h-7 w-7" type="button" onClick={onClose} title="Close resolver" aria-label="Close resolver">
            <X size={14} />
          </button>
        </div>
      </header>

      {errorMessage ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-xs text-[var(--danger-text)]" role="alert">
          <AlertTriangle size={13} />
          {errorMessage}
        </div>
      ) : null}

      {conflictQuery.isError && !conflictFile ? (
        <div className="grid min-h-0 flex-1 place-items-center px-8 text-center text-xs text-[var(--text-3)]">
          <div className="flex max-w-md flex-col items-center gap-3">
            <FileWarning size={22} className="text-[var(--danger-text)]" />
            <span>{errorMessage ?? 'Unable to load the conflicted file.'}</span>
            <button className="btn-subtle h-8 px-3 text-xs" type="button" onClick={() => void conflictQuery.refetch()}>
              Retry
            </button>
          </div>
        </div>
      ) : conflictQuery.isLoading || !conflictFile ? (
        <div className="grid min-h-0 flex-1 place-items-center text-xs text-[var(--text-3)]">
          <span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading conflict versions…</span>
        </div>
      ) : (
        <div className="conflict-resolver-body">
          <div className="conflict-source-grid">
            <ConflictSource
              side="ours"
              label={conflictFile.oursLabel}
              version={conflictFile.ours}
              omittedReason={conflictFile.omittedReason}
              onUse={() => chooseSide('ours')}
            />
            <ConflictSource
              side="theirs"
              label={conflictFile.theirsLabel}
              version={conflictFile.theirs}
              omittedReason={conflictFile.omittedReason}
              onUse={() => chooseSide('theirs')}
            />
          </div>

          <div className="conflict-output">
            <div className="conflict-output-toolbar">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[var(--text-2)]">Output</span>
                {draft?.kind === 'text' ? (
                  <span className={markers.length > 0 ? 'text-[var(--danger-text)]' : 'text-[var(--success-text)]'}>
                    {markers.length > 0
                      ? `${markers.length} unresolved conflict${markers.length === 1 ? '' : 's'}`
                      : 'Ready to save'}
                  </span>
                ) : draft ? (
                  <span className="text-[var(--success-text)]">{formatDraft(draft, conflictFile)}</span>
                ) : (
                  <span className="text-[var(--text-3)]">Choose a version to create the result</span>
                )}
              </div>
              {draft?.kind === 'text' && markers.length > 0 ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <button className="btn-subtle h-7 px-2 text-[11px]" type="button" onClick={() => resolveCurrent('ours')}>
                    Use {shortLabel(conflictFile.oursLabel)}
                  </button>
                  <button className="btn-subtle h-7 px-2 text-[11px]" type="button" onClick={() => resolveCurrent('theirs')}>
                    Use {shortLabel(conflictFile.theirsLabel)}
                  </button>
                  <span className="ml-1 text-[10.5px] text-[var(--text-3)]">
                    {Math.min(currentConflictIndex + 1, markers.length)} of {markers.length}
                  </span>
                  <button
                    className="icon-btn h-7 w-7"
                    type="button"
                    disabled={currentConflictIndex <= 0}
                    onClick={() => setCurrentConflictIndex((index) => Math.max(0, index - 1))}
                    title="Previous conflict"
                  >
                    <ChevronUp size={13} />
                  </button>
                  <button
                    className="icon-btn h-7 w-7"
                    type="button"
                    disabled={currentConflictIndex >= markers.length - 1}
                    onClick={() => setCurrentConflictIndex((index) => Math.min(markers.length - 1, index + 1))}
                    title="Next conflict"
                  >
                    <ChevronDown size={13} />
                  </button>
                </div>
              ) : null}
            </div>

            {draft?.kind === 'text' ? (
              <textarea
                ref={outputRef}
                className="conflict-output-editor"
                value={draft.content}
                spellCheck={false}
                aria-label="Resolved file output"
                onChange={(event) => {
                  setDraft({ kind: 'text', content: event.target.value });
                  setCurrentConflictIndex(0);
                }}
              />
            ) : draft ? (
              <div className="conflict-output-choice">
                {draft.kind === 'delete' ? <Trash2 size={22} /> : <Check size={22} />}
                <strong>{formatDraft(draft, conflictFile)}</strong>
                <span>{draft.kind === 'delete' ? 'Saving will stage the file deletion.' : 'The selected Git blob will be checked out and staged.'}</span>
              </div>
            ) : (
              <div className="conflict-output-choice text-[var(--text-3)]">
                <FileWarning size={22} />
                <strong>No result selected</strong>
                <span>Choose “Use this file” on either side. Missing sides represent a deletion.</span>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function ConflictSource({
  side,
  label,
  version,
  omittedReason,
  onUse
}: {
  side: 'ours' | 'theirs';
  label: string;
  version?: GitConflictFileVersion;
  omittedReason?: GitConflictFile['omittedReason'];
  onUse: () => void;
}): ReactElement {
  const preview = version?.content === undefined ? undefined : createPreview(version.content);

  return (
    <section className="conflict-source" data-side={side}>
      <header className="conflict-source-header">
        <div className="flex min-w-0 items-center gap-2">
          <span className="conflict-side-letter">{side === 'ours' ? 'A' : 'B'}</span>
          <div className="min-w-0">
            <div className="truncate text-[11.5px] font-semibold text-[var(--text-1)]">{label}</div>
            <div className="mt-0.5 text-[10px] text-[var(--text-3)]">
              {version ? `${side === 'ours' ? 'ours' : 'theirs'} · ${version.shortOid}` : 'file deleted on this side'}
            </div>
          </div>
        </div>
        <button className="btn-subtle h-7 shrink-0 px-2 text-[11px]" type="button" onClick={onUse}>
          {version ? <Check size={12} /> : <Trash2 size={12} />}
          {version ? 'Use this file' : 'Keep deleted'}
        </button>
      </header>
      {preview !== undefined && !omittedReason ? (
        <pre className="conflict-source-code">{preview}</pre>
      ) : (
        <div className="conflict-source-empty">
          {version ? formatOmittedReason(omittedReason) : 'No file exists in this version.'}
        </div>
      )}
    </section>
  );
}

function nextUnresolvedPath(paths: string[], currentPath: string): string | undefined {
  const currentIndex = paths.indexOf(currentPath);
  return paths[currentIndex + 1] ?? paths.find((path) => path !== currentPath);
}

function initialDraft(conflictFile: GitConflictFile | undefined): ResolutionDraft | undefined {
  return conflictFile?.result !== undefined && !conflictFile.omittedReason
    ? { kind: 'text', content: conflictFile.result }
    : undefined;
}

function formatConflictKind(kind: GitConflictFile['kind']): string {
  if (kind === 'both-modified') return 'both modified';
  if (kind === 'both-added') return 'added by both';
  if (kind === 'deleted-by-us') return 'deleted by us';
  if (kind === 'deleted-by-them') return 'deleted by them';
  return 'unmerged';
}

function formatOperation(operation: GitConflictOperation | undefined): string {
  if (!operation || operation === 'unknown') return 'Conflict resolution';
  return `${operation.replace('-', ' ')} conflict`;
}

function formatDraft(draft: ResolutionDraft, conflictFile: GitConflictFile): string {
  if (draft.kind === 'delete') return 'Delete file';
  if (draft.kind === 'ours') return `Use ${conflictFile.oursLabel}`;
  if (draft.kind === 'theirs') return `Use ${conflictFile.theirsLabel}`;
  return 'Edited output';
}

function formatOmittedReason(reason: GitConflictFile['omittedReason']): string {
  if (reason === 'binary') return 'Binary file preview is unavailable. You can still choose this version.';
  if (reason === 'too-large') return 'This file exceeds the 8 MiB editor limit. You can still choose this version.';
  if (reason === 'unsupported-type') return 'This Git object cannot be edited as text. You can still choose this version.';
  return 'Preview unavailable.';
}

function createPreview(content: string): string {
  const lines = content.split('\n');

  if (lines.length <= 1200) {
    return content;
  }

  return `${lines.slice(0, 1200).join('\n')}\n\n… preview truncated after 1,200 lines …`;
}

function shortLabel(label: string): string {
  const segments = label.split('/');
  return segments.at(-1) ?? label;
}
