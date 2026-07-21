import type { KeyboardEvent, MouseEvent, ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileDiffOptions } from '@pierre/diffs';
import { PatchDiff, WorkerPoolContext } from '@pierre/diffs/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ContextMenu as ContextMenuPrimitive } from 'radix-ui';
import {
  ArrowRight,
  Check,
  Columns2,
  FilePen,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Minus,
  RotateCcw,
  Rows3,
  Sparkles,
  X
} from 'lucide-react';

import {
  invalidateRepositoryQueries,
  useCommitDetail,
  useCommitSelectionDetail,
  useFileDiff,
  useWipDetail
} from '@renderer/queries/repository';
import {
  createDiffRequest,
  DIFF_OPTIONS_BASE,
  fileChangeIconKind,
  findAdjacentFilePath,
  findFile,
  selectWipScope,
  type DiffStyle,
  type WipDiffScope
} from '@renderer/components/commit/fileDetailUtils';
import { FILE_STATUS_COLORS } from '@shared/graph';
import type {
  CommitGraphRow,
  GitFileChangeDetail,
  GitFileDiffSegment,
  GitRepositoryDetail,
  GitStatusCode
} from '@shared/types';
import { CodexReviewDialog } from '@renderer/components/diff/CodexReviewDialog';
import {
  normalizeCodexSelection,
  type CodexReviewSelection
} from '@renderer/components/diff/codexReviewPrompt';
import {
  parseStageablePatchHunks,
  type StageablePatchHunk
} from '@renderer/components/diff/stageablePatch';
import { useDiffSyntaxHighlighter } from '@renderer/components/diff/useDiffSyntaxHighlighter';

type FileFocusViewProps = {
  repoPath?: string;
  row?: CommitGraphRow;
  selectedShas?: string[];
  selectedFile?: string;
  diffStyle: DiffStyle;
  wipScopeByPath: Record<string, WipDiffScope>;
  focusSignal: number;
  isOperationBusy: boolean;
  onSetDiffStyle: (style: DiffStyle) => void;
  onChangeWipScope: (path: string, scope: WipDiffScope) => void;
  onSelectFile: (path: string) => void;
  onClose: () => void;
};

export function FileFocusView({
  repoPath,
  row,
  selectedShas = [],
  selectedFile,
  diffStyle,
  wipScopeByPath,
  focusSignal,
  isOperationBusy,
  onSetDiffStyle,
  onChangeWipScope,
  onSelectFile,
  onClose
}: FileFocusViewProps): ReactElement {
  const sectionRef = useRef<HTMLElement>(null);
  const queryClient = useQueryClient();
  const [contextSelection, setContextSelection] = useState<CodexReviewSelection>();
  const [codexDialogSelection, setCodexDialogSelection] = useState<CodexReviewSelection>();
  const isWip = row?.node.kind === 'wip';
  const isCommitSelection = !isWip && selectedShas.length > 1;
  const commitQuery = useCommitDetail(repoPath, row && !isWip && !isCommitSelection ? row.sha : undefined);
  const commitSelectionQuery = useCommitSelectionDetail(repoPath, isCommitSelection ? selectedShas : []);
  const wipQuery = useWipDetail(repoPath, Boolean(row && isWip));
  const detail = (
    isWip ? wipQuery.data : isCommitSelection ? commitSelectionQuery.data : commitQuery.data
  ) as GitRepositoryDetail | undefined;
  const detailError = isWip ? wipQuery.error : isCommitSelection ? commitSelectionQuery.error : commitQuery.error;
  const isDetailLoading = isWip ? wipQuery.isLoading : isCommitSelection ? commitSelectionQuery.isLoading : commitQuery.isLoading;
  const files = detail?.files ?? [];
  const selectedFileDetail = findFile(files, selectedFile);
  const selectedWipScope = selectedFileDetail ? selectWipScope(selectedFileDetail, wipScopeByPath[selectedFileDetail.path]) : 'unstaged';
  const diffRequest = useMemo(
    () => createDiffRequest(row, selectedFileDetail, selectedWipScope, selectedShas),
    [row, selectedFileDetail, selectedShas, selectedWipScope]
  );
  const diffQuery = useFileDiff(repoPath, diffRequest);
  const stageableHunks = useMemo(() => parseStageablePatchHunks(diffQuery.data?.stageablePatch), [diffQuery.data?.stageablePatch]);
  const patchMode = selectedWipScope === 'staged' ? 'unstage' : 'stage';
  const patchApplyMutation = useMutation({
    mutationKey: ['repository-mutation', repoPath],
    mutationFn: async (hunk: StageablePatchHunk) => {
      if (!repoPath || !selectedFileDetail) {
        throw new Error('A selected WIP file is required.');
      }

      return window.api.applyWipPatch(repoPath, {
        path: selectedFileDetail.path,
        mode: patchMode,
        patch: hunk.patch
      });
    },
    onSuccess: (result) => {
      void invalidateRepositoryQueries(queryClient, result.repoPath, result.invalidates ?? []);
    }
  });
  const diffOptions = useMemo<FileDiffOptions<undefined>>(
    () => ({
      ...DIFF_OPTIONS_BASE,
      diffStyle,
      disableFileHeader: true
    }),
    [diffStyle]
  );
  const headerPath = selectedFileDetail?.path ?? selectedFile ?? 'No file selected';
  const isSyntaxHighlighterReady = useDiffSyntaxHighlighter(selectedFileDetail?.path ?? selectedFile);
  const { directory, basename } = splitPath(headerPath);
  const detailErrorMessage = detailError instanceof Error ? detailError.message : undefined;

  useEffect(() => {
    sectionRef.current?.focus({ preventScroll: true });
  }, [focusSignal, selectedFile]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === 'Escape' && !isEditableTarget(event.target)) {
      event.preventDefault();
      onClose();
      return;
    }

    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      isEditableTarget(event.target)
    ) {
      return;
    }

    const direction = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : undefined;

    if (!direction) {
      return;
    }

    const nextPath = findAdjacentFilePath(files, selectedFileDetail?.path ?? selectedFile, direction);

    if (!nextPath) {
      return;
    }

    event.preventDefault();
    onSelectFile(nextPath);
  }

  function handleDiffContextMenu(event: MouseEvent<HTMLDivElement>): void {
    const normalizedSelection = normalizeCodexSelection(window.getSelection()?.toString() ?? '');

    if (!eventIncludesDiff(event) || !normalizedSelection || !selectedFileDetail || !row) {
      event.preventDefault();
      setContextSelection(undefined);
      return;
    }

    const revision = row.node.kind === 'wip'
      ? detail?.kind === 'wip'
        ? `Working directory on ${detail.branch.head}`
        : 'Working directory'
      : detail?.kind === 'selection'
        ? `${detail.shas.length} selected commits (${detail.shas.at(-1)?.slice(0, 8)}..${detail.shas[0]?.slice(0, 8)})`
        : row.sha;

    setContextSelection({
      ...normalizedSelection,
      filePath: selectedFileDetail.path,
      revision,
      subject: detail?.kind === 'selection' ? selectedCommitSubjects(detail.commits) : row.subject
    });
  }

  return (
    <>
      <section ref={sectionRef} className="file-focus" tabIndex={0} onKeyDown={handleKeyDown}>
        <header className="file-focus-header">
          <div className="flex min-w-0 items-center gap-2" title={headerPath}>
            {selectedFileDetail ? <StatusIcon status={selectedFileDetail.status} /> : <FileText size={13} className="text-[var(--text-3)]" />}
            <span className="flex min-w-0 items-baseline overflow-hidden">
              {directory ? <span className="truncate text-[var(--text-3)]">{directory}</span> : null}
              <span className="min-w-0 truncate font-semibold text-[var(--text-1)]">{basename}</span>
            </span>
            {selectedFileDetail?.originalPath ? (
              <span className="max-[920px]:hidden min-w-0 truncate text-[11px] text-[var(--text-3)]">
                from {selectedFileDetail.originalPath}
              </span>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {isWip && selectedFileDetail?.staged && selectedFileDetail.unstaged ? (
              <div className="segmented" aria-label="Working directory diff scope">
                <button type="button" data-active={selectedWipScope === 'unstaged'} onClick={() => onChangeWipScope(selectedFileDetail.path, 'unstaged')}>
                  Worktree
                </button>
                <button type="button" data-active={selectedWipScope === 'staged'} onClick={() => onChangeWipScope(selectedFileDetail.path, 'staged')}>
                  Staged
                </button>
              </div>
            ) : null}
            <div className="segmented" aria-label="Diff layout">
              <button type="button" data-active={diffStyle === 'unified'} onClick={() => onSetDiffStyle('unified')} title="Unified diff">
                <Rows3 size={12} />
              </button>
              <button type="button" data-active={diffStyle === 'split'} onClick={() => onSetDiffStyle('split')} title="Split diff">
                <Columns2 size={12} />
              </button>
            </div>
            <button className="icon-btn h-7 w-7 shrink-0" type="button" onClick={onClose} title="Close diff" aria-label="Close diff">
              <X size={14} />
            </button>
          </div>
        </header>

        <div className="file-focus-content">
          <ContextMenuPrimitive.Root onOpenChange={(open) => !open && setContextSelection(undefined)}>
            <ContextMenuPrimitive.Trigger asChild>
              <div className="diff-shell diff-shell-main" onContextMenu={handleDiffContextMenu}>
                {/* Match review's reliable syntax path instead of the worker pool's lazy language initialization. */}
                <WorkerPoolContext.Provider value={undefined}>
                  {renderDiffContent({
                    detail,
                    isDetailLoading,
                    detailErrorMessage,
                    selectedFile,
                    selectedFileDetail,
                    diffStyle,
                    diffOptions,
                    diffQuery,
                    isSyntaxHighlighterReady,
                    hunkStaging:
                      isWip && selectedFileDetail && isPatchStageableFile(selectedFileDetail)
                        ? {
                            hunks: stageableHunks,
                            mode: patchMode,
                            isMutating: isOperationBusy || patchApplyMutation.isPending,
                            errorMessage: patchApplyMutation.error instanceof Error ? patchApplyMutation.error.message : undefined,
                            onApplyHunk: (hunk) => {
                              if (!isOperationBusy) {
                                patchApplyMutation.mutate(hunk);
                              }
                            }
                          }
                        : undefined
                  })}
                </WorkerPoolContext.Provider>
              </div>
            </ContextMenuPrimitive.Trigger>
            <ContextMenuPrimitive.Portal>
              <ContextMenuPrimitive.Content className="z-50 min-w-56 overflow-hidden rounded-lg border border-[var(--border-strong)] bg-[var(--bg-popover)] p-1.5 text-[var(--text-2)] shadow-2xl shadow-black/60 outline-none">
                <ContextMenuPrimitive.Label className="px-2.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-3)]">
                  Code selection
                </ContextMenuPrimitive.Label>
                <ContextMenuPrimitive.Item
                  className="flex cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-2 outline-none focus:bg-[var(--bg-hover)] focus:text-[var(--text-1)] data-[disabled]:opacity-50"
                  disabled={!contextSelection}
                  onSelect={() => contextSelection && setCodexDialogSelection(contextSelection)}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded border border-[var(--ai-border)] bg-[var(--ai-bg)] text-[var(--ai-text)]">
                    <Sparkles size={13} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-[var(--text-1)]">Ask Codex</span>
                    <span className="mt-0.5 block text-[10.5px] text-[var(--text-3)]">Explain this change in project context</span>
                  </span>
                </ContextMenuPrimitive.Item>
                {contextSelection ? (
                  <p className="mx-2 mt-1 border-t border-[var(--border)] pt-1.5 text-[10px] text-[var(--text-3)]">
                    {contextSelection.lineCount} selected line{contextSelection.lineCount === 1 ? '' : 's'}
                  </p>
                ) : null}
              </ContextMenuPrimitive.Content>
            </ContextMenuPrimitive.Portal>
          </ContextMenuPrimitive.Root>
        </div>
      </section>
      {repoPath && codexDialogSelection ? (
        <CodexReviewDialog
          repoPath={repoPath}
          selection={codexDialogSelection}
          onClose={() => setCodexDialogSelection(undefined)}
        />
      ) : null}
    </>
  );
}

type DiffContentInput = {
  detail: GitRepositoryDetail | undefined;
  isDetailLoading: boolean;
  detailErrorMessage?: string;
  selectedFile?: string;
  selectedFileDetail?: GitFileChangeDetail;
  diffStyle: DiffStyle;
  diffOptions: FileDiffOptions<undefined>;
  diffQuery: ReturnType<typeof useFileDiff>;
  isSyntaxHighlighterReady: boolean;
  hunkStaging?: HunkStagingConfig;
};

function renderDiffContent({
  detail,
  isDetailLoading,
  detailErrorMessage,
  selectedFile,
  selectedFileDetail,
  diffStyle,
  diffOptions,
  diffQuery,
  isSyntaxHighlighterReady,
  hunkStaging
}: DiffContentInput): ReactElement {
  const diffErrorMessage = diffQuery.error instanceof Error ? diffQuery.error.message : undefined;

  if (isDetailLoading && !detail) {
    return <FileFocusMessage icon={<Loader2 size={15} className="animate-spin" />} label="Loading file details..." />;
  }

  if (detailErrorMessage) {
    return <FileFocusMessage icon={<RotateCcw size={15} />} label={detailErrorMessage} />;
  }

  if (!selectedFile) {
    return <FileFocusMessage icon={<FileText size={15} />} label="Select a changed file to inspect its diff." />;
  }

  if (!selectedFileDetail) {
    return <FileFocusMessage icon={<FileText size={15} />} label="This file is no longer part of the selected change set." />;
  }

  if (diffQuery.isLoading) {
    return <FileFocusMessage icon={<Loader2 size={15} className="animate-spin" />} label="Loading diff..." />;
  }

  if (diffErrorMessage) {
    return <FileFocusMessage icon={<RotateCcw size={15} />} label={diffErrorMessage} />;
  }

  if (
    !isSyntaxHighlighterReady &&
    (Boolean(diffQuery.data?.patch) || diffQuery.data?.segments?.some((segment) => Boolean(segment.patch)))
  ) {
    return <FileFocusMessage icon={<Loader2 size={15} className="animate-spin" />} label="Preparing syntax highlighting..." />;
  }

  if (diffQuery.data?.segments) {
    return renderSelectionDiffSegments(diffQuery.data.segments, diffStyle, diffOptions);
  }

  if (diffQuery.data?.omittedReason === 'too-large') {
    return <FileFocusMessage icon={<FilePen size={15} />} label="This diff exceeds the 8 MiB preview limit. Open the file in your editor to inspect it." />;
  }

  if (diffQuery.data?.isBinary || diffQuery.data?.omittedReason === 'binary') {
    return <FileFocusMessage icon={<FilePen size={15} />} label="Binary preview is unavailable. Open the file in your editor to inspect it." />;
  }

  if (diffQuery.data?.patch) {
    return (
      <>
        {hunkStaging && !diffQuery.data.isBinary ? <HunkStagingPanel config={hunkStaging} /> : null}
        <PatchDiff
          key={`${diffQuery.data.mode}:${diffQuery.data.path}:${diffStyle}:${diffQuery.data.loadedAt}`}
          className="gg-diff gg-diff-main"
          patch={diffQuery.data.patch}
          options={diffOptions}
        />
      </>
    );
  }

  return <FileFocusMessage icon={<FilePen size={15} />} label="No textual diff for this selection." />;
}

function renderSelectionDiffSegments(
  segments: GitFileDiffSegment[],
  diffStyle: DiffStyle,
  diffOptions: FileDiffOptions<undefined>
): ReactElement {
  if (segments.length === 0) {
    return <FileFocusMessage icon={<FilePen size={15} />} label="No textual diff for this selection." />;
  }

  return (
    <div className="space-y-3 pb-3" data-testid="selection-diff-segments">
      {segments.map((segment) => (
        <section key={segment.sha} data-testid="selection-diff-segment">
          <div className="sticky top-0 z-10 flex items-center gap-2 border-y border-[var(--border)] bg-[var(--bg-panel)] px-3 py-2 text-[11px]">
            <span className="mono shrink-0 text-[var(--accent-2)]">{segment.shortSha}</span>
            <span className="truncate text-[var(--text-2)]">{segment.subject}</span>
          </div>
          {segment.omittedReason === 'too-large' ? (
            <FileFocusMessage icon={<FilePen size={15} />} label="This commit's diff exceeds the 8 MiB preview limit." />
          ) : segment.isBinary || segment.omittedReason === 'binary' ? (
            <FileFocusMessage icon={<FilePen size={15} />} label="Binary preview is unavailable for this commit." />
          ) : segment.patch ? (
            <PatchDiff
              key={`${segment.sha}:${diffStyle}`}
              className="gg-diff gg-diff-main"
              patch={segment.patch}
              options={diffOptions}
            />
          ) : (
            <FileFocusMessage icon={<FilePen size={15} />} label="No textual diff in this commit." />
          )}
        </section>
      ))}
    </div>
  );
}

type HunkStagingConfig = {
  hunks: StageablePatchHunk[];
  mode: 'stage' | 'unstage';
  isMutating: boolean;
  errorMessage?: string;
  onApplyHunk: (hunk: StageablePatchHunk) => void;
};

function HunkStagingPanel({ config }: { config: HunkStagingConfig }): ReactElement | null {
  if (config.hunks.length === 0) {
    return null;
  }

  const actionLabel = config.mode === 'stage' ? 'Stage' : 'Unstage';

  return (
    <div className="border-b border-[var(--border)] bg-[var(--bg-panel)] px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-3)]">
          {actionLabel} hunks
        </span>
        <span className="text-[11px] text-[var(--text-3)]">{config.hunks.length} line group{config.hunks.length === 1 ? '' : 's'}</span>
      </div>
      <div className="grid max-h-36 gap-1 overflow-y-auto">
        {config.hunks.map((hunk) => (
          <div
            key={hunk.id}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded border border-[var(--border)] bg-[var(--bg-field)] px-2 py-1.5 text-xs"
          >
            <div className="min-w-0">
              <p className="truncate text-[var(--text-2)]">{hunk.preview || hunk.header}</p>
              <p className="mt-0.5 text-[11px] text-[var(--text-3)]">
                <span className="text-[var(--success-text)]">+{hunk.additions}</span>{' '}
                <span className="text-[var(--danger-text)]">-{hunk.deletions}</span>{' '}
                <span className="mono">{hunk.header}</span>
              </p>
            </div>
            <button
              className="btn-subtle h-7 text-[11px]"
              type="button"
              disabled={config.isMutating}
              onClick={() => config.onApplyHunk(hunk)}
            >
              {config.isMutating ? <Loader2 size={12} className="animate-spin" /> : config.mode === 'stage' ? <Check size={12} /> : <RotateCcw size={12} />}
              {actionLabel}
            </button>
          </div>
        ))}
      </div>
      {config.errorMessage ? <p className="mt-2 text-[11px] text-[var(--danger-text)]">{config.errorMessage}</p> : null}
    </div>
  );
}


function isPatchStageableFile(file: GitFileChangeDetail): boolean {
  return !file.conflicted && file.status !== 'renamed' && file.status !== 'copied';
}

function eventIncludesDiff(event: MouseEvent<HTMLElement>): boolean {
  return event.nativeEvent.composedPath().some(
    (target: EventTarget) => target instanceof HTMLElement && target.tagName.toLowerCase() === 'diffs-container'
  );
}

function selectedCommitSubjects(commits: Extract<GitRepositoryDetail, { kind: 'selection' }>['commits']): string {
  const visibleCommits = commits.slice(0, 5);
  const summary = visibleCommits.map((commit) => `${commit.shortSha} ${commit.subject}`).join(' | ');
  const hiddenCount = commits.length - visibleCommits.length;
  return hiddenCount > 0 ? `${summary} | +${hiddenCount} more` : summary;
}

function FileFocusMessage({ icon, label }: { icon: ReactElement; label: string }): ReactElement {
  return (
    <div className="file-focus-message">
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
    </div>
  );
}

function StatusIcon({ status }: { status: GitStatusCode }): ReactElement {
  const iconKind = fileChangeIconKind(status);
  const label = status === 'conflicted'
    ? 'Conflicted file'
    : status === 'copied'
      ? 'Copied file'
      : `${iconKind[0]?.toUpperCase()}${iconKind.slice(1)} file`;

  if (iconKind === 'modified') {
    return <Pencil size={12} className="shrink-0" style={{ color: FILE_STATUS_COLORS.modified }} aria-label={label} />;
  }

  if (iconKind === 'added') {
    return <Plus size={13} className="shrink-0" style={{ color: FILE_STATUS_COLORS.added }} aria-label={label} />;
  }

  if (iconKind === 'renamed') {
    return <ArrowRight size={13} className="shrink-0 text-[var(--accent-2)]" aria-label={label} />;
  }

  return <Minus size={13} className="shrink-0" style={{ color: FILE_STATUS_COLORS.deleted }} aria-label={label} />;
}

function splitPath(path: string): { directory: string; basename: string } {
  const separatorIndex = path.lastIndexOf('/');

  if (separatorIndex === -1) {
    return { directory: '', basename: path };
  }

  return {
    directory: path.slice(0, separatorIndex + 1),
    basename: path.slice(separatorIndex + 1)
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
