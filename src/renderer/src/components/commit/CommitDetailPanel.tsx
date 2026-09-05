import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent, PointerEvent, ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ContextMenu as ContextMenuPrimitive } from 'radix-ui';
import {
  AlertTriangle,
  ArrowDownAZ,
  BookOpenCheck,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FilePen,
  FolderTree,
  GitCommit,
  List,
  Loader2,
  Minus,
  Pencil,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X
} from 'lucide-react';

import { openContextMenuFromKeyboard } from '@renderer/components/accessibility/menuKeyboard';

import {
  invalidateRepositoryQueries,
  useCommitDetail,
  useCommitSelectionDetail,
  useWipDetail
} from '@renderer/queries/repository';
import {
  buildChangedFileTree,
  countByStatus,
  expandFileTreePathAncestors,
  fileTreeAncestorPaths,
  findFile,
  graphFileStatus,
  toggleFileTreePath,
  type ChangedFileTreeNode,
  type FileStatusCounts,
  type FileViewMode
} from '@renderer/components/commit/fileDetailUtils';
import { AuthorAvatar } from '@renderer/components/avatar/AuthorAvatar';
import { FILE_STATUS_COLORS } from '@shared/graph';
import type { CommitGraphRow, GitCommitPerson, GitFileChangeDetail, GitIgnoreInput, GitRepositoryDetail, GitStatusCode, RepoProfileState } from '@shared/types';
import {
  DEFAULT_DETAIL_PANEL_WIDTH,
  MAX_DETAIL_PANEL_WIDTH,
  MIN_DETAIL_PANEL_WIDTH,
  normalizeDetailPanelWidth
} from '@shared/workspace';

type CommitDetailPanelProps = {
  repoPath?: string;
  row?: CommitGraphRow;
  selectedShas?: string[];
  parentSha?: string;
  headSha?: string;
  selectedFile?: string;
  wipDirtyCount?: number;
  showWorkingDirectoryBanner?: boolean;
  profileState?: RepoProfileState;
  commitFocusSignal: number;
  isOperationBusy: boolean;
  width?: number;
  isCollapsed?: boolean;
  remoteAvatars?: boolean;
  isReviewOpen?: boolean;
  onToggleCollapsed?: () => void;
  onResize?: (width: number) => void;
  onResizeCommit?: (width: number) => void;
  onSelectCommit: (sha: string) => void;
  onSelectFile: (path: string | undefined) => void;
  onSetReviewOpen: (open: boolean) => void;
  onOpenWipChanges: () => void;
  onDiscardAllWip: () => void;
  onDiscardWipFile: (file: GitFileChangeDetail) => void;
  onIgnoreWipFile: (file: GitFileChangeDetail, mode: GitIgnoreInput['mode']) => void;
  onInspectWipFile: (file: GitFileChangeDetail, mode: 'history' | 'blame') => void;
  onCopyWipFilePath: (file: GitFileChangeDetail) => void;
  onOpenWipFile: (file: GitFileChangeDetail) => void;
  onRevealWipFile: (file: GitFileChangeDetail) => void;
  onStashWipFile: (file: GitFileChangeDetail) => void;
};

const DEFAULT_COMMIT_MESSAGE_EDITOR_HEIGHT = 220;
const MIN_COMMIT_MESSAGE_EDITOR_HEIGHT = 96;
const MAX_COMMIT_MESSAGE_EDITOR_HEIGHT = 520;

export function CommitDetailPanel({
  repoPath,
  row,
  selectedShas = [],
  parentSha,
  headSha,
  selectedFile,
  wipDirtyCount = 0,
  showWorkingDirectoryBanner = false,
  profileState,
  commitFocusSignal,
  isOperationBusy,
  width = 382,
  isCollapsed = false,
  remoteAvatars = false,
  isReviewOpen = false,
  onToggleCollapsed,
  onResize,
  onResizeCommit,
  onSelectCommit,
  onSelectFile,
  onSetReviewOpen,
  onOpenWipChanges,
  onDiscardAllWip,
  onDiscardWipFile,
  onIgnoreWipFile,
  onInspectWipFile,
  onCopyWipFilePath,
  onOpenWipFile,
  onRevealWipFile,
  onStashWipFile
}: CommitDetailPanelProps): ReactElement {
  const queryClient = useQueryClient();
  const resizeStateRef = useRef<{ startX: number; startWidth: number; width: number } | undefined>(undefined);
  const [fileView, setFileView] = useState<FileViewMode>('path');
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [commitMessageState, setCommitMessageState] = useState<{ repoPath?: string; value: string }>({
    repoPath,
    value: ''
  });
  const [commitMessageDraft, setCommitMessageDraft] = useState('');
  const [editingCommitSha, setEditingCommitSha] = useState<string>();
  const [amendState, setAmendState] = useState<{ repoPath?: string; value: boolean }>({
    repoPath,
    value: false
  });
  const [isResizing, setIsResizing] = useState(false);
  const commitMessage = commitMessageState.repoPath === repoPath ? commitMessageState.value : '';
  const amend = amendState.repoPath === repoPath ? amendState.value : false;
  const isWip = row?.node.kind === 'wip';
  const isCommitSelection = !isWip && selectedShas.length > 1;
  const commitQuery = useCommitDetail(repoPath, row && !isWip && !isCommitSelection ? row.sha : undefined);
  const commitSelectionQuery = useCommitSelectionDetail(repoPath, isCommitSelection ? selectedShas : []);
  const wipQuery = useWipDetail(repoPath, Boolean(row && isWip));
  const headCommitQuery = useCommitDetail(repoPath, row && isWip ? row.parentShas[0] : undefined);
  const detailQuery = isWip ? wipQuery : isCommitSelection ? commitSelectionQuery : commitQuery;
  const detail = detailQuery.data;
  const detailError = detailQuery.error;
  const isDetailLoading = detailQuery.isLoading;
  const files = detail?.files ?? [];
  const selectedFileDetail = findFile(files, selectedFile);
  const stageFileMutation = useMutation({
    mutationKey: ['repository-mutation', repoPath],
    mutationFn: async (path: string) => {
      if (!repoPath) {
        throw new Error('Repository path is required.');
      }

      return window.api.stageFile(repoPath, path);
    },
    onSuccess: (result) => {
      void invalidateRepositoryQueries(queryClient, result.repoPath, result.invalidates ?? []);
    }
  });
  const unstageFileMutation = useMutation({
    mutationKey: ['repository-mutation', repoPath],
    mutationFn: async (path: string) => {
      if (!repoPath) {
        throw new Error('Repository path is required.');
      }

      return window.api.unstageFile(repoPath, path);
    },
    onSuccess: (result) => {
      void invalidateRepositoryQueries(queryClient, result.repoPath, result.invalidates ?? []);
    }
  });
  const stageAllMutation = useMutation({
    mutationKey: ['repository-mutation', repoPath],
    mutationFn: async () => {
      if (!repoPath) {
        throw new Error('Repository path is required.');
      }

      return window.api.stageAll(repoPath);
    },
    onSuccess: (result) => {
      void invalidateRepositoryQueries(queryClient, result.repoPath, result.invalidates ?? []);
    }
  });
  const unstageAllMutation = useMutation({
    mutationKey: ['repository-mutation', repoPath],
    mutationFn: async () => {
      if (!repoPath) {
        throw new Error('Repository path is required.');
      }

      return window.api.unstageAll(repoPath);
    },
    onSuccess: (result) => {
      void invalidateRepositoryQueries(queryClient, result.repoPath, result.invalidates ?? []);
    }
  });
  const commitMutation = useMutation({
    mutationKey: ['repository-mutation', repoPath],
    mutationFn: async () => {
      if (!repoPath) {
        throw new Error('Repository path is required.');
      }

      return window.api.commitChanges(repoPath, { message: commitMessage, amend });
    },
    onSuccess: (result) => {
      if (!amend) {
        setCommitMessage('');
      }

      void invalidateRepositoryQueries(queryClient, result.repoPath, result.invalidates ?? []);
    }
  });
  const generateCommitMessageMutation = useMutation({
    mutationKey: ['generate-commit-message', repoPath],
    mutationFn: async () => {
      if (!repoPath) {
        throw new Error('Repository path is required.');
      }

      return {
        repoPath,
        message: await window.api.generateCommitMessage(repoPath)
      };
    },
    onSuccess: (result) => {
      if (result.repoPath === repoPath) {
        setCommitMessage(result.message);
      }
    }
  });
  const updateCommitMessageMutation = useMutation({
    mutationKey: ['repository-mutation', repoPath],
    mutationFn: async () => {
      if (!repoPath || !row || row.node.kind === 'wip' || row.node.kind === 'stash') {
        throw new Error('A checked-out commit is required.');
      }

      return window.api.commitChanges(repoPath, {
        message: commitMessageDraft,
        amend: true,
        expectedHead: row.sha,
        messageOnly: true
      });
    },
    onSuccess: (result) => {
      setEditingCommitSha(undefined);
      setCommitMessageDraft('');

      if (result.undoEntry?.headAfter) {
        onSelectCommit(result.undoEntry.headAfter);
      }

      void invalidateRepositoryQueries(queryClient, result.repoPath, result.invalidates ?? []);
    }
  });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key.toLowerCase() !== 't') {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();
      setFileView((value) => (value === 'tree' ? 'path' : 'tree'));
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function handlePointerMove(event: globalThis.PointerEvent): void {
      const state = resizeStateRef.current;

      if (!state) {
        return;
      }

      const nextWidth = normalizeDetailPanelWidth(state.startWidth + state.startX - event.clientX);
      state.width = nextWidth;
      onResize?.(nextWidth);
    }

    function stopResize(): void {
      const nextWidth = resizeStateRef.current?.width;
      resizeStateRef.current = undefined;
      setIsResizing(false);

      if (typeof nextWidth === 'number') {
        onResizeCommit?.(nextWidth);
      }
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizing, onResize, onResizeCommit]);

  function handleResizeStart(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    resizeStateRef.current = { startX: event.clientX, startWidth: width, width };
    setIsResizing(true);
  }

  if (isCollapsed) {
    return (
      <aside className="commit-detail-panel flex min-h-0 w-10 shrink-0 flex-col items-center overflow-hidden border-l border-[var(--border)] bg-[var(--bg-sidebar)] py-2" aria-label="Commit details">
        <button className="icon-btn" type="button" onClick={onToggleCollapsed} aria-label="Expand commit details" title="Expand commit details">
          <PanelRightOpen size={15} />
        </button>
      </aside>
    );
  }

  if (!row || !repoPath) {
    return (
      <aside className="commit-detail-panel relative flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--bg-sidebar)]" style={{ width: normalizeDetailPanelWidth(width) }} aria-label="Commit details">
        <DetailResizeHandle width={width} isActive={isResizing} onPointerDown={handleResizeStart} onResize={onResize} onResizeCommit={onResizeCommit} />
        <div className="flex h-10 shrink-0 items-center justify-end border-b border-[var(--border)] px-2">
          <button className="icon-btn" type="button" onClick={onToggleCollapsed} aria-label="Collapse commit details" title="Collapse commit details">
            <PanelRightClose size={15} />
          </button>
        </div>
        <div className="grid flex-1 place-items-center px-8 text-center text-xs leading-5 text-[var(--text-3)]">
          Select a commit to inspect its message, author, and changed files.
        </div>
      </aside>
    );
  }

  const counts = countByStatus(files);
  const activeMutation =
    stageFileMutation.isPending ||
    unstageFileMutation.isPending ||
    stageAllMutation.isPending ||
    unstageAllMutation.isPending ||
    commitMutation.isPending ||
    generateCommitMessageMutation.isPending ||
    updateCommitMessageMutation.isPending ||
    isOperationBusy;
  const detailErrorMessage = detailError instanceof Error ? detailError.message : undefined;
  const isEditingCommitMessage =
    Boolean(detail?.kind === 'commit' && editingCommitSha === detail.sha);
  const canEditCommitMessage =
    Boolean(detail?.kind === 'commit' && headSha && detail.sha === headSha);

  function beginCommitMessageEdit(): void {
    if (detail?.kind !== 'commit') {
      return;
    }

    setCommitMessageDraft(detail.message);
    setEditingCommitSha(detail.sha);
    updateCommitMessageMutation.reset();
  }

  function setCommitMessage(value: string): void {
    setCommitMessageState({ repoPath, value });
  }

  function setAmend(value: boolean): void {
    setAmendState({ repoPath, value });
  }

  function renderFilesSection(): ReactElement | null {
    if (!detail) {
      return null;
    }

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <FilesToolbar
          counts={counts}
          fileView={fileView}
          isWip={isWip}
          showAllFiles={showAllFiles}
          onSetFileView={(view) => {
            setFileView(view);
            onSetReviewOpen(false);
          }}
          onSetShowAllFiles={setShowAllFiles}
        />

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-1">
          {files.length === 0 ? (
            <EmptyFiles isWip={isWip} />
          ) : fileView === 'path' ? (
            <PathFileRows
              files={files}
              isWip={isWip}
              selectedPath={selectedFileDetail?.path}
              isMutating={activeMutation}
              onSelectFile={onSelectFile}
              onStageFile={(path) => stageFileMutation.mutate(path)}
              onUnstageFile={(path) => unstageFileMutation.mutate(path)}
              onStageAll={() => stageAllMutation.mutate()}
              onUnstageAll={() => unstageAllMutation.mutate()}
              onDiscardWipFile={onDiscardWipFile}
              onIgnoreWipFile={onIgnoreWipFile}
              onInspectWipFile={onInspectWipFile}
              onCopyWipFilePath={onCopyWipFilePath}
              onOpenWipFile={onOpenWipFile}
              onRevealWipFile={onRevealWipFile}
              onStashWipFile={onStashWipFile}
            />
          ) : (
            <ChangedFilesTree
              key={files.map((file) => `${file.status}:${file.path}`).join('\0')}
              files={files}
              selectedPath={selectedFileDetail?.path}
              isWip={isWip}
              isMutating={activeMutation}
              onSelectPath={onSelectFile}
              onStageFile={(path) => stageFileMutation.mutate(path)}
              onUnstageFile={(path) => unstageFileMutation.mutate(path)}
              onDiscardWipFile={onDiscardWipFile}
              onIgnoreWipFile={onIgnoreWipFile}
              onInspectWipFile={onInspectWipFile}
              onCopyWipFilePath={onCopyWipFilePath}
              onOpenWipFile={onOpenWipFile}
              onRevealWipFile={onRevealWipFile}
              onStashWipFile={onStashWipFile}
            />
          )}
        </div>
      </div>
    );
  }

  function renderWipCommitSection(): ReactElement | null {
    if (!detail || detail.kind !== 'wip') {
      return null;
    }

    return (
      <WipCommitSection
        detail={detail}
        profileState={profileState}
        commitMessage={commitMessage}
        focusSignal={commitFocusSignal}
        amend={amend}
        isCommitting={commitMutation.isPending}
        isGeneratingMessage={generateCommitMessageMutation.isPending}
        commitError={
          commitMutation.error instanceof Error
            ? commitMutation.error.message
            : generateCommitMessageMutation.error instanceof Error
              ? generateCommitMessageMutation.error.message
              : undefined
        }
        onChangeMessage={setCommitMessage}
        onChangeAmend={(value) => {
          setAmend(value);

          if (value && !commitMessage && headCommitQuery.data?.message) {
            setCommitMessage(headCommitQuery.data.message);
          }
        }}
        onCommit={() => commitMutation.mutate()}
        onGenerateMessage={() => generateCommitMessageMutation.mutate()}
      />
    );
  }

  return (
    <aside className="commit-detail-panel relative flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--bg-sidebar)]" style={{ width: normalizeDetailPanelWidth(width) }} aria-label="Commit details">
      <DetailResizeHandle width={width} isActive={isResizing} onPointerDown={handleResizeStart} onResize={onResize} onResizeCommit={onResizeCommit} />
      {showWorkingDirectoryBanner ? (
        <WorkingDirectoryBanner
          dirtyCount={wipDirtyCount}
          isViewingWip={isWip}
          onOpenWipChanges={onOpenWipChanges}
        />
      ) : null}
      <PanelHeader
        row={row}
        detail={detail}
        selectionCount={selectedShas.length}
        isMutating={activeMutation}
        isReviewOpen={isReviewOpen}
        canReview={Boolean(row && !isCommitSelection && row.node.kind !== 'stash')}
        canEditCommitMessage={canEditCommitMessage}
        isEditingCommitMessage={isEditingCommitMessage}
        onEditCommitMessage={beginCommitMessageEdit}
        onDiscardAllWip={onDiscardAllWip}
        onOpenReview={() => onSetReviewOpen(true)}
        onToggleCollapsed={onToggleCollapsed}
      />

      {isDetailLoading && !detail ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <PanelMessage icon={<Loader2 size={15} className="animate-spin" />} label="Loading details…" />
        </div>
      ) : detailErrorMessage ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-6 py-8" role="alert">
            <p className="flex items-center justify-center gap-2 text-center text-xs leading-5 text-[var(--danger-text)]">
              <AlertTriangle size={15} className="shrink-0" />
              {detailErrorMessage}
            </p>
            <div className="mt-3 flex justify-center">
              <button
                className="btn-subtle h-6 px-2 text-[11px]"
                type="button"
                disabled={detailQuery.isFetching}
                onClick={() => void detailQuery.refetch()}
              >
                <RotateCcw size={12} />
                Retry
              </button>
            </div>
          </div>
        </div>
      ) : detail && isWip ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {renderFilesSection()}
          {renderWipCommitSection()}
        </div>
      ) : detail ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {detail.kind === 'commit' && isEditingCommitMessage ? (
            <>
              <CommitMessageEditor
                originalMessage={detail.message}
                message={commitMessageDraft}
                isUpdating={updateCommitMessageMutation.isPending}
                error={
                  updateCommitMessageMutation.error instanceof Error
                    ? updateCommitMessageMutation.error.message
                    : undefined
                }
                onChange={setCommitMessageDraft}
                onUpdate={() => updateCommitMessageMutation.mutate()}
                onCancel={() => {
                  setEditingCommitSha(undefined);
                  setCommitMessageDraft('');
                  updateCommitMessageMutation.reset();
                }}
              />
              <CommitSignatureSection
                detail={detail}
                parentSha={parentSha}
                remoteAvatars={remoteAvatars}
              />
            </>
          ) : (
            <SummarySection
              detail={detail}
              parentSha={parentSha}
              remoteAvatars={remoteAvatars}
              canEditCommitMessage={canEditCommitMessage}
              isMutating={activeMutation}
              onEditCommitMessage={beginCommitMessageEdit}
            />
          )}
          {renderFilesSection()}
        </div>
      ) : null}
    </aside>
  );
}

function DetailResizeHandle({
  width,
  isActive,
  onPointerDown,
  onResize,
  onResizeCommit
}: {
  width: number;
  isActive: boolean;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onResize?: (width: number) => void;
  onResizeCommit?: (width: number) => void;
}): ReactElement {
  function commitWidth(nextWidth: number): void {
    const normalizedWidth = normalizeDetailPanelWidth(nextWidth);
    onResize?.(normalizedWidth);
    onResizeCommit?.(normalizedWidth);
  }

  return (
    <div
      className="detail-panel-resizer"
      role="separator"
      tabIndex={0}
      aria-label="Resize commit details"
      aria-orientation="vertical"
      aria-valuemin={MIN_DETAIL_PANEL_WIDTH}
      aria-valuemax={MAX_DETAIL_PANEL_WIDTH}
      aria-valuenow={normalizeDetailPanelWidth(width)}
      data-active={isActive ? 'true' : undefined}
      title="Drag to resize. Double-click to reset."
      onPointerDown={onPointerDown}
      onDoubleClick={() => commitWidth(DEFAULT_DETAIL_PANEL_WIDTH)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 48 : 16;

        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          commitWidth(width + step);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          commitWidth(width - step);
        } else if (event.key === 'Home') {
          event.preventDefault();
          commitWidth(MIN_DETAIL_PANEL_WIDTH);
        } else if (event.key === 'End') {
          event.preventDefault();
          commitWidth(MAX_DETAIL_PANEL_WIDTH);
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          commitWidth(DEFAULT_DETAIL_PANEL_WIDTH);
        }
      }}
    />
  );
}

function WorkingDirectoryBanner({
  dirtyCount,
  isViewingWip,
  onOpenWipChanges
}: {
  dirtyCount: number;
  isViewingWip: boolean;
  onOpenWipChanges: () => void;
}): ReactElement | null {
  if (dirtyCount <= 0) {
    return null;
  }

  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-[var(--select-border)] bg-[var(--worktree-banner-bg)] px-4 text-[13px] font-semibold text-[var(--text-1)]">
      <span className="min-w-0 truncate">{formatFileChangeLabel(dirtyCount)} in working directory</span>
      <button
        className="h-7 shrink-0 rounded border border-[var(--control-active-border)] bg-[var(--control-active-bg)] px-3 text-xs font-semibold text-[var(--text-1)] transition hover:bg-[var(--bg-hover)] disabled:opacity-65"
        type="button"
        disabled={isViewingWip}
        title={isViewingWip ? 'Already viewing working directory changes' : 'View working directory changes'}
        onClick={onOpenWipChanges}
      >
        {isViewingWip ? 'Viewing Changes' : 'View Changes'}
      </button>
    </div>
  );
}

function PanelHeader({
  row,
  detail,
  selectionCount,
  isMutating,
  isReviewOpen,
  canReview,
  canEditCommitMessage,
  isEditingCommitMessage,
  onEditCommitMessage,
  onDiscardAllWip,
  onOpenReview,
  onToggleCollapsed
}: {
  row: CommitGraphRow;
  detail?: GitRepositoryDetail;
  selectionCount: number;
  isMutating: boolean;
  isReviewOpen: boolean;
  canReview: boolean;
  canEditCommitMessage: boolean;
  isEditingCommitMessage: boolean;
  onEditCommitMessage: () => void;
  onDiscardAllWip: () => void;
  onOpenReview: () => void;
  onToggleCollapsed?: () => void;
}): ReactElement {
  const isWip = row.node.kind === 'wip';
  const wipDetail = detail?.kind === 'wip' ? detail : undefined;
  const [copyResult, setCopyResult] = useState<{ sha: string; status: 'copied' | 'failed' }>();
  const copyStatus = copyResult?.sha === row.sha ? copyResult.status : undefined;

  useEffect(() => {
    if (!copyResult) {
      return;
    }

    const timeoutId = window.setTimeout(() => setCopyResult(undefined), 1600);
    return () => window.clearTimeout(timeoutId);
  }, [copyResult]);

  async function handleCopySha(): Promise<void> {
    try {
      await navigator.clipboard.writeText(row.sha);
      setCopyResult({ sha: row.sha, status: 'copied' });
    } catch {
      setCopyResult({ sha: row.sha, status: 'failed' });
    }
  }

  const headerActions = (
    <span className="flex shrink-0 items-center gap-1">
      {canReview ? (
        <button
          className="icon-btn h-7 w-7"
          type="button"
          data-active={isReviewOpen}
          onClick={onOpenReview}
          aria-label="Open context review"
          title="Context review"
          style={{ background: isReviewOpen ? 'var(--control-active-bg)' : undefined }}
        >
          <BookOpenCheck size={14} />
        </button>
      ) : null}
      <button className="icon-btn h-7 w-7" type="button" onClick={onToggleCollapsed} aria-label="Collapse commit details" title="Collapse commit details">
        <PanelRightClose size={14} />
      </button>
    </span>
  );

  if (isWip) {
    const hasConflicts = (wipDetail?.conflictedCount ?? 0) > 0;
    const discardDisabled = !wipDetail || hasConflicts || isMutating;
    const discardTitle = hasConflicts
      ? 'Resolve or abort the in-progress operation before discarding all changes'
      : 'Discard all uncommitted changes';

    return (
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 text-xs text-[var(--text-2)]">
        <button
          className="icon-btn h-7 w-7 shrink-0 rounded border border-[var(--danger-border)] text-[var(--danger-text)]"
          type="button"
          disabled={discardDisabled}
          onClick={onDiscardAllWip}
          aria-label="Discard all uncommitted changes"
          title={discardTitle}
        >
          <Trash2 size={14} />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {wipDetail ? (
            <>
              <span className="min-w-0 truncate font-semibold text-[var(--text-1)]">{formatFileChangeLabel(wipDetail.dirtyCount)} on</span>
              <span className="shrink-0 rounded bg-[var(--accent)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--bg-field)]">
                {wipDetail.branch.head}
              </span>
            </>
          ) : (
            <span className="font-semibold text-[var(--text-1)]">File changes</span>
          )}
        </div>
        {headerActions}
      </div>
    );
  }

  if (selectionCount > 1) {
    return (
      <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-3 text-xs text-[var(--text-2)]">
        <span className="flex min-w-0 items-center gap-2">
          <GitCommit size={14} className="shrink-0 text-[var(--accent-2)]" />
          <span className="truncate font-semibold text-[var(--text-1)]">
            {selectionCount} commits selected
          </span>
        </span>
        {headerActions}
      </div>
    );
  }

  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-3 text-xs text-[var(--text-2)]">
      <span className="flex min-w-0 items-center gap-2">
        {canEditCommitMessage ? (
          <button
            className="icon-btn h-7 w-7 shrink-0"
            type="button"
            data-active={isEditingCommitMessage}
            disabled={isMutating || isEditingCommitMessage}
            onClick={onEditCommitMessage}
            aria-label="Amend commit message"
            title={isEditingCommitMessage ? 'Editing commit message' : 'Amend commit message'}
          >
            <FilePen size={14} />
          </button>
        ) : (
          <FilePen size={14} className="shrink-0 text-[var(--text-3)]" />
        )}
        <span className="shrink-0">commit:</span>
        <button
          className="mono flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[var(--text-1)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent-2)]"
          type="button"
          onClick={() => void handleCopySha()}
          title={copyStatus === 'copied' ? 'Copied full commit SHA' : copyStatus === 'failed' ? 'Could not copy commit SHA' : 'Copy full commit SHA'}
          aria-label={copyStatus === 'copied' ? 'Commit SHA copied' : copyStatus === 'failed' ? 'Could not copy commit SHA' : `Copy commit SHA ${row.sha}`}
        >
          <span className="min-w-0 truncate">{row.sha.slice(0, 12)}</span>
          {copyStatus === 'copied' ? (
            <Check size={12} className="shrink-0 text-[var(--success-text)]" aria-hidden="true" />
          ) : copyStatus === 'failed' ? (
            <AlertTriangle size={12} className="shrink-0 text-[var(--danger-text)]" aria-hidden="true" />
          ) : (
            <Copy size={12} className="shrink-0 text-[var(--text-3)]" aria-hidden="true" />
          )}
        </button>
      </span>
      {headerActions}
    </div>
  );
}

function CommitMessageEditor({
  originalMessage,
  message,
  isUpdating,
  error,
  onChange,
  onUpdate,
  onCancel
}: {
  originalMessage: string;
  message: string;
  isUpdating: boolean;
  error?: string;
  onChange: (value: string) => void;
  onUpdate: () => void;
  onCancel: () => void;
}): ReactElement {
  const summaryInputRef = useRef<HTMLInputElement>(null);
  const resizeStateRef = useRef<{ startY: number; startHeight: number } | undefined>(undefined);
  const [descriptionHeight, setDescriptionHeight] = useState(DEFAULT_COMMIT_MESSAGE_EDITOR_HEIGHT);
  const [isResizing, setIsResizing] = useState(false);
  const { summary, description } = splitCommitMessage(message);
  const canUpdate =
    Boolean(summary.trim()) &&
    message.trim() !== originalMessage.trim() &&
    !isUpdating;

  useEffect(() => {
    const input = summaryInputRef.current;

    if (!input) {
      return;
    }

    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    function handlePointerMove(event: globalThis.PointerEvent): void {
      const state = resizeStateRef.current;

      if (!state) {
        return;
      }

      setDescriptionHeight(
        normalizeCommitMessageEditorHeight(
          state.startHeight + event.clientY - state.startY
        )
      );
    }

    function stopResize(): void {
      resizeStateRef.current = undefined;
      setIsResizing(false);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizing]);

  function handleEditorKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
  ): void {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canUpdate) {
      event.preventDefault();
      onUpdate();
    } else if (event.key === 'Escape' && !isUpdating) {
      event.preventDefault();
      onCancel();
    }
  }

  function commitDescriptionHeight(nextHeight: number): void {
    setDescriptionHeight(normalizeCommitMessageEditorHeight(nextHeight));
  }

  return (
    <section
      className="shrink-0 border-b border-[var(--border)] px-3 pb-3 pt-3"
      aria-label="Amend commit message"
    >
      <div className="commit-message-editor-card">
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] pr-3">
          <input
            ref={summaryInputRef}
            className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-[15px] font-semibold leading-5 text-[var(--text-1)] outline-none"
            aria-label="Commit summary"
            placeholder="Commit summary"
            spellCheck
            value={summary}
            disabled={isUpdating}
            onChange={(event) => onChange(joinCommitMessage(event.target.value, description))}
            onKeyDown={handleEditorKeyDown}
          />
          <span
            className="mono shrink-0 text-[10.5px] text-[var(--text-3)]"
            data-over-limit={summary.length > 72 ? 'true' : undefined}
            title="Characters remaining in the recommended 72-character summary"
          >
            {72 - summary.length}
          </span>
        </div>
        <textarea
          className="block w-full resize-none bg-transparent px-3 py-2.5 text-[13px] leading-5 text-[var(--text-1)] outline-none"
          style={{ height: descriptionHeight }}
          aria-label="Commit description"
          placeholder="Description"
          spellCheck
          value={description}
          disabled={isUpdating}
          onChange={(event) => onChange(joinCommitMessage(summary, event.target.value))}
          onKeyDown={handleEditorKeyDown}
        />
      </div>

      <div
        className="commit-message-editor-resizer"
        role="separator"
        tabIndex={0}
        aria-label="Resize commit message editor"
        aria-orientation="horizontal"
        aria-valuemin={MIN_COMMIT_MESSAGE_EDITOR_HEIGHT}
        aria-valuemax={MAX_COMMIT_MESSAGE_EDITOR_HEIGHT}
        aria-valuenow={descriptionHeight}
        data-active={isResizing ? 'true' : undefined}
        title="Drag to resize the message editor. Double-click to reset."
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }

          event.preventDefault();
          resizeStateRef.current = {
            startY: event.clientY,
            startHeight: descriptionHeight
          };
          setIsResizing(true);
        }}
        onDoubleClick={() => commitDescriptionHeight(DEFAULT_COMMIT_MESSAGE_EDITOR_HEIGHT)}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 48 : 16;

          if (event.key === 'ArrowUp') {
            event.preventDefault();
            commitDescriptionHeight(descriptionHeight - step);
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            commitDescriptionHeight(descriptionHeight + step);
          } else if (event.key === 'Home') {
            event.preventDefault();
            commitDescriptionHeight(MIN_COMMIT_MESSAGE_EDITOR_HEIGHT);
          } else if (event.key === 'End') {
            event.preventDefault();
            commitDescriptionHeight(MAX_COMMIT_MESSAGE_EDITOR_HEIGHT);
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            commitDescriptionHeight(DEFAULT_COMMIT_MESSAGE_EDITOR_HEIGHT);
          }
        }}
      />

      <div className="shrink-0 space-y-2">
        <div className="flex items-center justify-between gap-3 text-[10.5px] text-[var(--text-3)]">
          <span>Updating creates a new commit SHA.</span>
          <span className="shrink-0">⌘↵ update · Esc cancel</span>
        </div>
        {error ? (
          <p className="text-[11px] text-[var(--danger-text)]" role="alert">
            {error}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <button
            className="commit-message-action"
            data-tone="success"
            type="button"
            disabled={!canUpdate}
            onClick={onUpdate}
          >
            {isUpdating ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Update Message
          </button>
          <button
            className="commit-message-action"
            data-tone="danger"
            type="button"
            disabled={isUpdating}
            onClick={onCancel}
          >
            <X size={14} />
            Cancel Amend
          </button>
        </div>
      </div>
    </section>
  );
}

function SummarySection({
  detail,
  parentSha,
  remoteAvatars,
  canEditCommitMessage,
  isMutating,
  onEditCommitMessage
}: {
  detail: GitRepositoryDetail;
  parentSha?: string;
  remoteAvatars: boolean;
  canEditCommitMessage: boolean;
  isMutating: boolean;
  onEditCommitMessage: () => void;
}): ReactElement | null {
  if (detail.kind === 'wip') {
    return null;
  }

  if (detail.kind === 'selection') {
    const newest = detail.commits[0];
    const oldest = detail.commits.at(-1);

    return (
      <div className="max-h-48 shrink-0 overflow-x-hidden overflow-y-auto border-b border-[var(--border)] px-5 py-2.5">
        <h2 className="text-[17px] font-semibold leading-snug text-[var(--text-1)]">
          Combined changes
        </h2>
        <p className="mt-1 text-[11px] text-[var(--text-3)]">
          {detail.isContiguous && oldest && newest
            ? `${oldest.shortSha} → ${newest.shortSha}`
            : `${detail.commits.length} individually selected commits`}
        </p>
        <div className="mt-3 space-y-1.5" data-testid="selected-commit-summary">
          {detail.commits.slice().reverse().map((commit, index) => (
            <div key={commit.sha} className="flex min-w-0 items-center gap-2 text-[12px] text-[var(--text-2)]">
              <span className="mono w-14 shrink-0 text-[10.5px] text-[var(--text-3)]">{commit.shortSha}</span>
              <span className="truncate">{commit.subject}</span>
              <span className="ml-auto shrink-0 text-[10px] text-[var(--text-3)]">{index + 1}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <CommitMessageSummary
        subject={detail.subject}
        body={detail.body}
        isEditable={canEditCommitMessage}
        isDisabled={isMutating}
        onEdit={onEditCommitMessage}
      />
      <CommitSignatureSection
        detail={detail}
        parentSha={parentSha}
        remoteAvatars={remoteAvatars}
      />
    </>
  );
}

function CommitMessageSummary({
  subject,
  body,
  isEditable,
  isDisabled,
  onEdit
}: {
  subject: string;
  body?: string;
  isEditable: boolean;
  isDisabled: boolean;
  onEdit: () => void;
}): ReactElement {
  const content = (
    <>
      <span className="block text-[17px] font-semibold leading-snug text-[var(--text-1)]">
        {subject}
      </span>
      {body ? (
        <span className="mt-3 block pr-2 text-[13px] leading-5 text-[var(--text-2)]">
          <span className="block whitespace-pre-wrap [overflow-wrap:anywhere]">{body}</span>
        </span>
      ) : null}
    </>
  );

  return (
    <div className="shrink-0 border-b border-[var(--border)] p-2.5">
      {isEditable ? (
        <button
          className="commit-message-summary max-h-40 w-full overflow-x-hidden overflow-y-auto text-left"
          type="button"
          disabled={isDisabled}
          aria-label="Amend commit message"
          title="Click to amend your commit message"
          onClick={onEdit}
        >
          {content}
        </button>
      ) : (
        <div className="max-h-40 overflow-x-hidden overflow-y-auto px-2.5">{content}</div>
      )}
    </div>
  );
}

function CommitSignatureSection({
  detail,
  parentSha,
  remoteAvatars
}: {
  detail: Extract<GitRepositoryDetail, { kind: 'commit' }>;
  parentSha?: string;
  remoteAvatars: boolean;
}): ReactElement {
  return (
    <div className="shrink-0 space-y-1.5 px-5 py-2.5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <SignatureRow
          person={detail.author}
          action="authored"
          remoteAvatars={remoteAvatars}
        />
        {parentSha ? (
          <p className="shrink-0 pt-1 text-right text-[11px] text-[var(--text-3)]">
            parent: <span className="mono">{parentSha.slice(0, 8)}</span>
          </p>
        ) : null}
      </div>
      {shouldShowCommitter(detail) ? (
        <SignatureRow
          person={detail.committer}
          action="committed"
          remoteAvatars={remoteAvatars}
        />
      ) : null}
    </div>
  );
}

function splitCommitMessage(message: string): { summary: string; description: string } {
  const normalizedMessage = message.replace(/\r\n/g, '\n');
  const firstLineBreak = normalizedMessage.indexOf('\n');

  if (firstLineBreak === -1) {
    return { summary: normalizedMessage, description: '' };
  }

  return {
    summary: normalizedMessage.slice(0, firstLineBreak),
    description: normalizedMessage.slice(firstLineBreak + 1).replace(/^\n/, '')
  };
}

function joinCommitMessage(summary: string, description: string): string {
  return description ? `${summary}\n\n${description}` : summary;
}

function normalizeCommitMessageEditorHeight(height: number): number {
  return Math.min(
    MAX_COMMIT_MESSAGE_EDITOR_HEIGHT,
    Math.max(MIN_COMMIT_MESSAGE_EDITOR_HEIGHT, Math.round(height))
  );
}

function SignatureRow({
  person,
  action,
  remoteAvatars
}: {
  person: GitCommitPerson;
  action: 'authored' | 'committed';
  remoteAvatars: boolean;
}): ReactElement {
  const email = person.email;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5">
      <AuthorAvatar
        name={person.name}
        email={email}
        avatarUrl={remoteAvatars ? person.avatarUrl : undefined}
        size={38}
      />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-[var(--text-1)]">{person.name || 'Unknown author'}</p>
        <p className="truncate text-[12px] text-[var(--text-3)]" title={email}>
          {action} {formatCommitDate(person.date)}
        </p>
      </div>
    </div>
  );
}

function shouldShowCommitter(detail: GitRepositoryDetail): boolean {
  if (detail.kind !== 'commit') {
    return false;
  }

  return (
    detail.committer.name !== detail.author.name ||
    detail.committer.email !== detail.author.email ||
    detail.committer.date !== detail.author.date
  );
}

function formatCommitDate(value: string | undefined): string {
  if (!value) {
    return 'date unknown';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'date unknown';
  }

  const day = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(date);

  return `${day} @ ${time}`;
}

type WipCommitSectionProps = {
  detail: GitRepositoryDetail;
  profileState?: RepoProfileState;
  commitMessage: string;
  focusSignal: number;
  amend: boolean;
  isCommitting: boolean;
  isGeneratingMessage: boolean;
  commitError?: string;
  onChangeMessage: (value: string) => void;
  onChangeAmend: (value: boolean) => void;
  onCommit: () => void;
  onGenerateMessage: () => void;
};

function WipCommitSection({
  detail,
  profileState,
  commitMessage,
  focusSignal,
  amend,
  isCommitting,
  isGeneratingMessage,
  commitError,
  onChangeMessage,
  onChangeAmend,
  onCommit,
  onGenerateMessage
}: WipCommitSectionProps): ReactElement | null {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusSignal > 0) {
      textareaRef.current?.focus();
    }
  }, [focusSignal]);

  if (detail.kind !== 'wip') {
    return null;
  }

  const hasStagedFiles = detail.stagedCount > 0;
  const identity = profileState?.activeProfile
    ? {
        name: profileState.activeProfile.name,
        email: profileState.activeProfile.email,
        source: 'profile' as const
      }
    : profileState?.effectiveIdentity;
  const canCommit = Boolean(commitMessage.trim()) && (hasStagedFiles || amend) && !isCommitting;

  return (
    <div className="shrink-0 space-y-2.5 border-t border-[var(--border)] px-4 py-3.5">
      <div className="flex items-center justify-between gap-3 text-[11px] text-[var(--text-3)]">
        <span className="min-w-0 truncate">
          {identity?.name || 'Unknown author'} {identity?.email ? `<${identity.email}>` : ''}
        </span>
        <span className="shrink-0">{identity?.source ?? 'unknown'}</span>
      </div>
      <div className="relative">
        <textarea
          ref={textareaRef}
          className="h-20 w-full resize-none rounded-md border border-[var(--border)] bg-[var(--bg-field)] py-2 pl-2.5 pr-11 text-xs text-[var(--text-1)] placeholder-[var(--text-3)] outline-none transition focus:border-[var(--border-strong)]"
          placeholder={amend ? 'Amend commit message' : 'Commit summary'}
          value={commitMessage}
          disabled={isGeneratingMessage}
          onChange={(event) => onChangeMessage(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canCommit) {
              event.preventDefault();
              onCommit();
            }
          }}
        />
        <span
          className="commit-message-ai-control"
          tabIndex={!hasStagedFiles ? 0 : undefined}
          aria-describedby={!hasStagedFiles ? 'commit-message-ai-tooltip' : undefined}
        >
          <button
            className="commit-message-ai-button"
            type="button"
            aria-label="Generate commit message with AI"
            disabled={!hasStagedFiles || isGeneratingMessage || isCommitting}
            onClick={onGenerateMessage}
          >
            {isGeneratingMessage ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          </button>
          {!hasStagedFiles ? (
            <span id="commit-message-ai-tooltip" className="commit-message-ai-tooltip" role="tooltip">
              You must have staged changes to generate a commit message.
            </span>
          ) : null}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <label className="flex min-w-0 items-center gap-2 text-xs text-[var(--text-2)]">
          <input
            type="checkbox"
            checked={amend}
            onChange={(event) => onChangeAmend(event.target.checked)}
          />
          Amend previous commit
        </label>
        <button className="btn-primary h-8 text-xs" type="button" disabled={!canCommit} onClick={onCommit}>
          {isCommitting ? <Loader2 size={13} className="animate-spin" /> : <GitCommit size={13} />}
          <span>{amend ? 'Amend' : 'Commit'}</span>
        </button>
      </div>
      {commitError ? <p className="text-[11px] text-[var(--danger-text)]">{commitError}</p> : null}
    </div>
  );
}

type FilesToolbarProps = {
  counts: FileStatusCounts;
  fileView: FileViewMode;
  isWip: boolean;
  showAllFiles: boolean;
  onSetFileView: (view: FileViewMode) => void;
  onSetShowAllFiles: (showAllFiles: boolean) => void;
};

function FilesToolbar({
  counts,
  fileView,
  isWip,
  showAllFiles,
  onSetFileView,
  onSetShowAllFiles
}: FilesToolbarProps): ReactElement {
  if (isWip) {
    return (
      <div className="shrink-0 border-b border-[var(--border)] px-4 py-2">
        <div className="flex items-center justify-between gap-3">
          <FileListControls
            fileView={fileView}
            showAllFiles={showAllFiles}
            onSetFileView={onSetFileView}
            onSetShowAllFiles={onSetShowAllFiles}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 space-y-1.5 border-b border-[var(--border)] px-5 pb-2 pt-1">
      <div className="flex min-w-0 flex-wrap items-center gap-3 text-xs">
        <StatusCount status="modified" count={counts.modified} />
        <StatusCount status="added" count={counts.added} />
        <StatusCount status="deleted" count={counts.deleted} />
        {counts.renamed > 0 ? <span className="text-[var(--text-2)]">{counts.renamed} renamed</span> : null}
        {counts.conflicted > 0 ? <span className="text-[var(--danger-text)]">{counts.conflicted} conflicted</span> : null}
      </div>
      <FileListControls
        fileView={fileView}
        showAllFiles={showAllFiles}
        onSetFileView={onSetFileView}
        onSetShowAllFiles={onSetShowAllFiles}
      />
    </div>
  );
}

function FileListControls({
  fileView,
  showAllFiles,
  onSetFileView,
  onSetShowAllFiles
}: {
  fileView: FileViewMode;
  showAllFiles: boolean;
  onSetFileView: (view: FileViewMode) => void;
  onSetShowAllFiles: (showAllFiles: boolean) => void;
}): ReactElement {
  return (
    <div className="flex w-full shrink-0 items-center justify-between gap-3">
      <span className="inline-flex h-7 items-center gap-1.5 text-[11px] font-semibold uppercase text-[var(--text-3)]" title="Sorted by path">
        <ArrowDownAZ size={14} />
      </span>
      <div className="flex min-w-0 items-center gap-5">
        <FileViewToggle fileView={fileView} onSetFileView={onSetFileView} />
        <label className="flex shrink-0 items-center gap-2 text-[12px] text-[var(--text-2)]">
          <input
            className="h-3 w-3 accent-[var(--accent-2)]"
            type="checkbox"
            checked={showAllFiles}
            onChange={(event) => onSetShowAllFiles(event.target.checked)}
          />
          View all files
        </label>
      </div>
    </div>
  );
}

function FileViewToggle({
  fileView,
  onSetFileView
}: {
  fileView: FileViewMode;
  onSetFileView: (view: FileViewMode) => void;
}): ReactElement {
  return (
    <div className="segmented shrink-0">
      <button type="button" data-active={fileView === 'path'} onClick={() => onSetFileView('path')} title="Path list">
        <List size={12} />
        Path
      </button>
      <button type="button" data-active={fileView === 'tree'} onClick={() => onSetFileView('tree')} title="File tree">
        <FolderTree size={12} />
        Tree
      </button>
    </div>
  );
}

function StatusCount({ status, count }: { status: 'modified' | 'added' | 'deleted'; count: number }): ReactElement | null {
  if (count === 0) {
    return null;
  }

  const label = status === 'modified' ? 'modified' : status === 'added' ? 'added' : 'deleted';
  const Icon = status === 'modified' ? Pencil : status === 'added' ? Plus : Minus;

  return (
    <span className="flex items-center gap-1.5" style={{ color: FILE_STATUS_COLORS[status] }}>
      <Icon size={12} />
      {count} {label}
    </span>
  );
}

function formatFileChangeLabel(count: number): string {
  return `${count} file change${count === 1 ? '' : 's'}`;
}

type PathFileRowsProps = {
  files: GitFileChangeDetail[];
  isWip: boolean;
  selectedPath?: string;
  isMutating: boolean;
  onSelectFile: (path: string | undefined) => void;
  onStageFile: (path: string) => void;
  onUnstageFile: (path: string) => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
  onDiscardWipFile: (file: GitFileChangeDetail) => void;
  onIgnoreWipFile: (file: GitFileChangeDetail, mode: GitIgnoreInput['mode']) => void;
  onInspectWipFile: (file: GitFileChangeDetail, mode: 'history' | 'blame') => void;
  onCopyWipFilePath: (file: GitFileChangeDetail) => void;
  onOpenWipFile: (file: GitFileChangeDetail) => void;
  onRevealWipFile: (file: GitFileChangeDetail) => void;
  onStashWipFile: (file: GitFileChangeDetail) => void;
};

function PathFileRows({
  files,
  isWip,
  selectedPath,
  isMutating,
  onSelectFile,
  onStageFile,
  onUnstageFile,
  onStageAll,
  onUnstageAll,
  onDiscardWipFile,
  onIgnoreWipFile,
  onInspectWipFile,
  onCopyWipFilePath,
  onOpenWipFile,
  onRevealWipFile,
  onStashWipFile
}: PathFileRowsProps): ReactElement {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<'conflicts' | 'unstaged' | 'staged'>>(() => new Set());

  function toggleGroup(group: 'conflicts' | 'unstaged' | 'staged'): void {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  }

  function renderRow(
    file: GitFileChangeDetail,
    key: string,
    placement?: 'conflict' | 'unstaged' | 'staged'
  ): ReactElement {
    return (
      <FileRow
        key={key}
        file={file}
        isWip={isWip}
        isSelected={selectedPath === file.path}
        isMutating={isMutating}
        onSelect={() => onSelectFile(file.path)}
        onStage={() => onStageFile(file.path)}
        onUnstage={() => onUnstageFile(file.path)}
        onDiscard={() => onDiscardWipFile(file)}
        onIgnore={(mode) => onIgnoreWipFile(file, mode)}
        onInspect={(mode) => onInspectWipFile(file, mode)}
        onCopyPath={() => onCopyWipFilePath(file)}
        onOpen={() => onOpenWipFile(file)}
        onReveal={() => onRevealWipFile(file)}
        onStash={() => onStashWipFile(file)}
        placement={placement}
      />
    );
  }

  if (!isWip) {
    return <>{files.map((file) => renderRow(file, file.path))}</>;
  }

  const conflictedFiles = files.filter((file) => file.conflicted);
  const unstagedFiles = files.filter((file) => file.unstaged && !file.conflicted);
  const stagedFiles = files.filter((file) => file.staged && !file.conflicted);

  return (
    <>
      {conflictedFiles.length > 0 ? (
        <>
          <FileGroupHeader
            label={`Conflicts (${conflictedFiles.length})`}
            tone="danger"
            detail="Select a file to compare both versions in the merge tool."
            expanded={!collapsedGroups.has('conflicts')}
            onToggle={() => toggleGroup('conflicts')}
          />
          {!collapsedGroups.has('conflicts')
            ? conflictedFiles.map((file) => renderRow(file, `conflict:${file.path}`, 'conflict'))
            : null}
        </>
      ) : null}
      <FileGroupHeader
        label={`Unstaged Files (${unstagedFiles.length})`}
        separated={conflictedFiles.length > 0}
        expanded={!collapsedGroups.has('unstaged')}
        onToggle={() => toggleGroup('unstaged')}
        action={
          unstagedFiles.length > 0 ? (
            <button
              className="btn-subtle h-6 px-2 text-[11px]"
              type="button"
              disabled={isMutating || conflictedFiles.length > 0}
              onClick={onStageAll}
              title={conflictedFiles.length > 0
                ? 'Resolve conflicts before staging all changes'
                : 'Stage every working directory change'}
              style={{ borderColor: 'var(--success-border)', color: 'var(--success-text)' }}
            >
              <Check size={12} />
              Stage All Changes
            </button>
          ) : undefined
        }
      />
      {!collapsedGroups.has('unstaged')
        ? (unstagedFiles.length > 0
          ? unstagedFiles.map((file) => renderRow(file, `unstaged:${file.path}`, 'unstaged'))
          : <UnstagedEmpty />)
        : null}
      <FileGroupHeader
        label={`Staged Files (${stagedFiles.length})`}
        separated
        expanded={!collapsedGroups.has('staged')}
        onToggle={() => toggleGroup('staged')}
        action={
          stagedFiles.length > 0 ? (
            <button className="btn-subtle h-6 px-2 text-[11px]" type="button" disabled={isMutating} onClick={onUnstageAll}>
              <RotateCcw size={12} />
              Unstage All
            </button>
          ) : undefined
        }
      />
      {!collapsedGroups.has('staged')
        ? (stagedFiles.length > 0
          ? stagedFiles.map((file) => renderRow(file, `staged:${file.path}`, 'staged'))
          : <StagedEmpty
              isMutating={isMutating || conflictedFiles.length > 0}
              onStageAll={unstagedFiles.length > 0 ? onStageAll : undefined}
            />)
        : null}
    </>
  );
}

function FileGroupHeader({
  label,
  separated = false,
  action,
  tone = 'default',
  detail,
  expanded = true,
  onToggle
}: {
  label: string;
  separated?: boolean;
  action?: ReactElement;
  tone?: 'default' | 'danger';
  detail?: string;
  expanded?: boolean;
  onToggle?: () => void;
}): ReactElement {
  return (
    <div
      className={`flex min-h-9 items-center justify-between gap-2 border-b border-[var(--border)] px-1 py-1 text-[13px] font-semibold ${tone === 'danger' ? 'text-[var(--danger-text)]' : 'text-[var(--text-2)]'}${separated ? ' mt-2 border-t border-[var(--border)] pt-2' : ''}`}
    >
      <button
        className="flex min-w-0 items-start gap-1.5 rounded px-0.5 py-1 text-left outline-none hover:text-[var(--text-1)] focus-visible:ring-1 focus-visible:ring-[var(--select-border)]"
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        {tone === 'danger' ? <AlertTriangle size={13} className="mt-0.5 shrink-0" /> : null}
        {expanded ? <ChevronDown size={13} className="mt-0.5 shrink-0 text-[var(--text-3)]" /> : <ChevronRight size={13} className="mt-0.5 shrink-0 text-[var(--text-3)]" />}
        <span className="min-w-0">
          <span className="block truncate">{label}</span>
          {detail ? <span className="mt-0.5 block text-[10.5px] font-normal leading-4 text-[var(--text-3)]">{detail}</span> : null}
        </span>
      </button>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

type FileRowProps = {
  file: GitFileChangeDetail;
  isWip: boolean;
  isSelected: boolean;
  isMutating: boolean;
  onSelect: () => void;
  onStage: () => void;
  onUnstage: () => void;
  onDiscard: () => void;
  onIgnore: (mode: GitIgnoreInput['mode']) => void;
  onInspect: (mode: 'history' | 'blame') => void;
  onCopyPath: () => void;
  onOpen: () => void;
  onReveal: () => void;
  onStash: () => void;
  placement?: 'conflict' | 'unstaged' | 'staged';
};

function FileRow({
  file,
  isWip,
  isSelected,
  isMutating,
  onSelect,
  onStage,
  onUnstage,
  onDiscard,
  onIgnore,
  onInspect,
  onCopyPath,
  onOpen,
  onReveal,
  onStash,
  placement
}: FileRowProps): ReactElement {
  const separatorIndex = file.path.lastIndexOf('/');
  const directory = separatorIndex === -1 ? '' : file.path.slice(0, separatorIndex);
  const basename = separatorIndex === -1 ? file.path : file.path.slice(separatorIndex + 1);
  const actionBackground = isSelected
    ? 'linear-gradient(90deg, transparent, var(--select-bg) 18px)'
    : 'linear-gradient(90deg, transparent, var(--bg-hover) 18px)';
  const primaryAction = placement === 'conflict'
    ? { label: 'Resolve', onClick: onSelect, disabled: isMutating, tone: 'conflict' as const }
    : placement === 'staged'
      ? { label: 'Unstage File', onClick: onUnstage, disabled: isMutating, tone: 'unstage' as const }
      : { label: 'Stage File', onClick: onStage, disabled: !file.unstaged || isMutating, tone: 'stage' as const };

  function handleSelectPointerDown(event: PointerEvent<HTMLButtonElement>): void {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    onSelect();
  }

  function handleSelectClick(event: MouseEvent<HTMLButtonElement>): void {
    if (event.detail === 0) {
      onSelect();
    }
  }

  const row = (
    <div
      className="wip-file-row group relative flex h-9 items-center overflow-hidden px-2 text-[13px] transition hover:bg-[var(--bg-hover)] focus-within:bg-[var(--bg-hover)]"
      data-selected={isSelected ? 'true' : undefined}
      style={{ background: isSelected ? 'var(--select-bg)' : undefined }}
    >
      <button
        className="flex h-full w-full min-w-0 items-center gap-1.5 overflow-hidden pr-1 text-left"
        type="button"
        title={file.path}
        onPointerDown={handleSelectPointerDown}
        onClick={handleSelectClick}
      >
        <StatusIcon status={file.status} />
        <span className="flex min-w-0 flex-1 items-center overflow-hidden">
          {directory ? (
            <>
              <span className="min-w-0 truncate text-[var(--text-3)]">{directory}</span>
              <span className="shrink-0 text-[var(--text-3)]">/</span>
            </>
          ) : null}
          <span className="max-w-[72%] shrink-0 truncate text-[var(--text-2)]">{basename}</span>
        </span>
        {file.conflicted ? <span className="badge-mini border-[var(--danger-border)] text-[var(--danger-text)]">conflict</span> : null}
        {!isWip && file.staged ? <span className="badge-mini">staged</span> : null}
        {!isWip && file.unstaged ? <span className="badge-mini">worktree</span> : null}
      </button>
      {isWip ? (
        <div className="wip-file-row-action" style={{ background: actionBackground }}>
          <button
            className="wip-file-primary-action"
            data-tone={primaryAction.tone}
            type="button"
            disabled={primaryAction.disabled}
            onClick={primaryAction.onClick}
            title={primaryAction.label}
            aria-label={`${primaryAction.label} ${file.path}`}
          >
            {primaryAction.label}
          </button>
        </div>
      ) : null}
    </div>
  );

  return isWip
    ? <WipFileContextMenu
        file={file}
        isMutating={isMutating}
        onStage={onStage}
        onUnstage={onUnstage}
        onResolve={onSelect}
        onDiscard={onDiscard}
        onIgnore={onIgnore}
        onInspect={onInspect}
        onCopyPath={onCopyPath}
        onOpen={onOpen}
        onReveal={onReveal}
        onStash={onStash}
      >{row}</WipFileContextMenu>
    : row;
}

function WipFileContextMenu({
  file,
  isMutating,
  onStage,
  onUnstage,
  onResolve,
  onDiscard,
  onIgnore,
  onInspect,
  onCopyPath,
  onOpen,
  onReveal,
  onStash,
  children
}: {
  file: GitFileChangeDetail;
  isMutating: boolean;
  onStage: () => void;
  onUnstage: () => void;
  onResolve: () => void;
  onDiscard: () => void;
  onIgnore: (mode: GitIgnoreInput['mode']) => void;
  onInspect: (mode: 'history' | 'blame') => void;
  onCopyPath: () => void;
  onOpen: () => void;
  onReveal: () => void;
  onStash: () => void;
  children: ReactElement;
}): ReactElement {
  const extension = fileExtension(file.path);
  const folder = containingFolder(file.path);
  const canOpen = canOpenWorktreeFile(file);
  const canDiscard = canDiscardWipFile(file);
  const canShowHistory = file.status !== 'untracked';
  const canBlame = canOpen && file.status !== 'untracked' && file.status !== 'added';

  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild onKeyDown={openContextMenuFromKeyboard}>
        {children}
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content
          className="context-menu-surface w-64"
          collisionPadding={8}
          aria-label={`File actions for ${file.path}`}
        >
          {file.conflicted ? (
            <ContextMenuPrimitive.Item className="menu-row" disabled={isMutating} onSelect={onResolve}>
              <span>Resolve conflict</span>
            </ContextMenuPrimitive.Item>
          ) : null}
          {file.unstaged && !file.conflicted ? (
            <ContextMenuPrimitive.Item className="menu-row" disabled={file.conflicted || isMutating} onSelect={onStage}>
              <span>Stage</span>
            </ContextMenuPrimitive.Item>
          ) : null}
          {file.staged && !file.conflicted ? (
            <ContextMenuPrimitive.Item className="menu-row" disabled={file.conflicted || isMutating} onSelect={onUnstage}>
              <span>Unstage</span>
            </ContextMenuPrimitive.Item>
          ) : null}
          <ContextMenuPrimitive.Item className="menu-row" disabled={!canDiscard || isMutating} onSelect={onDiscard}>
            <span>Discard changes</span>
          </ContextMenuPrimitive.Item>
          {file.status === 'untracked' ? (
            <ContextMenuPrimitive.Sub>
              <ContextMenuPrimitive.SubTrigger className="menu-row">
                <span>Ignore</span>
                <span className="ml-auto pl-8 text-[var(--context-menu-text-muted)]" aria-hidden="true">›</span>
              </ContextMenuPrimitive.SubTrigger>
              <ContextMenuPrimitive.Portal>
                <ContextMenuPrimitive.SubContent className="context-menu-surface" sideOffset={4} collisionPadding={8}>
                  <ContextMenuPrimitive.Item className="menu-row" onSelect={() => onIgnore('file')}>
                    <span>Ignore this file</span>
                  </ContextMenuPrimitive.Item>
                  {extension ? (
                    <ContextMenuPrimitive.Item className="menu-row" onSelect={() => onIgnore('extension')}>
                      <span>Ignore all {extension} files</span>
                    </ContextMenuPrimitive.Item>
                  ) : null}
                  {folder ? (
                    <ContextMenuPrimitive.Item className="menu-row" onSelect={() => onIgnore('folder')}>
                      <span>Ignore folder {folder}</span>
                    </ContextMenuPrimitive.Item>
                  ) : null}
                </ContextMenuPrimitive.SubContent>
              </ContextMenuPrimitive.Portal>
            </ContextMenuPrimitive.Sub>
          ) : null}
          <ContextMenuPrimitive.Item className="menu-row" disabled={file.conflicted || isMutating} onSelect={onStash}>
            <span>Stash file</span>
          </ContextMenuPrimitive.Item>
          <ContextMenuPrimitive.Separator className="context-menu-separator" />
          <ContextMenuPrimitive.Item className="menu-row" disabled={!canShowHistory} onSelect={() => onInspect('history')}>
            <span>File History</span>
          </ContextMenuPrimitive.Item>
          <ContextMenuPrimitive.Item className="menu-row" disabled={!canBlame} onSelect={() => onInspect('blame')}>
            <span>File Blame</span>
          </ContextMenuPrimitive.Item>
          <ContextMenuPrimitive.Separator className="context-menu-separator" />
          <ContextMenuPrimitive.Item className="menu-row" disabled={!canOpen} onSelect={onOpen}>
            <span>Open file</span>
          </ContextMenuPrimitive.Item>
          <ContextMenuPrimitive.Item className="menu-row" onSelect={onReveal}>
            <span>Show in Finder</span>
          </ContextMenuPrimitive.Item>
          <ContextMenuPrimitive.Separator className="context-menu-separator" />
          <ContextMenuPrimitive.Item className="menu-row" onSelect={onCopyPath}>
            <span>Copy file path</span>
          </ContextMenuPrimitive.Item>
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}

function fileExtension(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const separatorIndex = name.lastIndexOf('.');
  return separatorIndex > 0 ? name.slice(separatorIndex) : undefined;
}

function containingFolder(path: string): string | undefined {
  const separatorIndex = path.lastIndexOf('/');
  return separatorIndex > 0 ? path.slice(0, separatorIndex) : undefined;
}

type ChangedFilesTreeProps = {
  files: GitFileChangeDetail[];
  selectedPath?: string;
  isWip: boolean;
  isMutating: boolean;
  onSelectPath: (path: string | undefined) => void;
  onStageFile: (path: string) => void;
  onUnstageFile: (path: string) => void;
  onDiscardWipFile: (file: GitFileChangeDetail) => void;
  onIgnoreWipFile: (file: GitFileChangeDetail, mode: GitIgnoreInput['mode']) => void;
  onInspectWipFile: (file: GitFileChangeDetail, mode: 'history' | 'blame') => void;
  onCopyWipFilePath: (file: GitFileChangeDetail) => void;
  onOpenWipFile: (file: GitFileChangeDetail) => void;
  onRevealWipFile: (file: GitFileChangeDetail) => void;
  onStashWipFile: (file: GitFileChangeDetail) => void;
};

function ChangedFilesTree({
  files,
  selectedPath,
  isWip,
  isMutating,
  onSelectPath,
  onStageFile,
  onUnstageFile,
  onDiscardWipFile,
  onIgnoreWipFile,
  onInspectWipFile,
  onCopyWipFilePath,
  onOpenWipFile,
  onRevealWipFile,
  onStashWipFile
}: ChangedFilesTreeProps): ReactElement {
  const nodes = useMemo(() => buildChangedFileTree(files), [files]);
  const allDirectoryPaths = useMemo(() => collectDirectoryPaths(nodes), [nodes]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(selectedPath ? fileTreeAncestorPaths(selectedPath) : [])
  );

  useEffect(() => {
    if (!selectedPath) {
      return;
    }

    // Keep manual expansion/focus state while revealing files selected outside this tree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpandedPaths((current) => expandFileTreePathAncestors(current, selectedPath));
  }, [selectedPath]);

  function toggleDirectory(path: string): void {
    setExpandedPaths((current) => toggleFileTreePath(current, path));
  }

  return (
    <div className="pb-2">
      <button
        className="mb-1 flex h-8 items-center rounded px-2 text-left text-[12px] text-[var(--text-2)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-1)]"
        type="button"
        onClick={() => setExpandedPaths(new Set(allDirectoryPaths))}
      >
        Expand All
      </button>
      <ul aria-label="Changed files">
        {nodes.map((node) => (
          <ChangedFileTreeRow
            key={`${node.kind}:${node.path}`}
            node={node}
            depth={0}
            expandedPaths={expandedPaths}
            selectedPath={selectedPath}
            isWip={isWip}
            isMutating={isMutating}
            onToggleDirectory={toggleDirectory}
            onSelectPath={onSelectPath}
            onStageFile={onStageFile}
            onUnstageFile={onUnstageFile}
            onDiscardWipFile={onDiscardWipFile}
            onIgnoreWipFile={onIgnoreWipFile}
            onInspectWipFile={onInspectWipFile}
            onCopyWipFilePath={onCopyWipFilePath}
            onOpenWipFile={onOpenWipFile}
            onRevealWipFile={onRevealWipFile}
            onStashWipFile={onStashWipFile}
          />
        ))}
      </ul>
    </div>
  );
}

function ChangedFileTreeRow({
  node,
  depth,
  expandedPaths,
  selectedPath,
  isWip,
  isMutating,
  onToggleDirectory,
  onSelectPath,
  onStageFile,
  onUnstageFile,
  onDiscardWipFile,
  onIgnoreWipFile,
  onInspectWipFile,
  onCopyWipFilePath,
  onOpenWipFile,
  onRevealWipFile,
  onStashWipFile
}: {
  node: ChangedFileTreeNode;
  depth: number;
  expandedPaths: ReadonlySet<string>;
  selectedPath?: string;
  isWip: boolean;
  isMutating: boolean;
  onToggleDirectory: (path: string) => void;
  onSelectPath: (path: string | undefined) => void;
  onStageFile: (path: string) => void;
  onUnstageFile: (path: string) => void;
  onDiscardWipFile: (file: GitFileChangeDetail) => void;
  onIgnoreWipFile: (file: GitFileChangeDetail, mode: GitIgnoreInput['mode']) => void;
  onInspectWipFile: (file: GitFileChangeDetail, mode: 'history' | 'blame') => void;
  onCopyWipFilePath: (file: GitFileChangeDetail) => void;
  onOpenWipFile: (file: GitFileChangeDetail) => void;
  onRevealWipFile: (file: GitFileChangeDetail) => void;
  onStashWipFile: (file: GitFileChangeDetail) => void;
}): ReactElement {
  const paddingLeft = depth * 15 + 2;

  if (node.kind === 'file') {
    const isSelected = selectedPath === node.path;
    const primaryAction = node.file.conflicted
      ? {
          label: 'Resolve',
          tone: 'conflict' as const,
          disabled: isMutating,
          onClick: () => onSelectPath(node.path)
        }
      : node.file.unstaged
        ? {
            label: 'Stage File',
            tone: 'stage' as const,
            disabled: isMutating,
            onClick: () => onStageFile(node.path)
          }
        : {
            label: 'Unstage File',
            tone: 'unstage' as const,
            disabled: isMutating,
            onClick: () => onUnstageFile(node.path)
          };

    const row = (
      <div className="wip-file-row group relative flex h-9 items-center overflow-hidden">
        <button
          className="flex h-full w-full min-w-0 items-center gap-2 pr-2 text-left text-[13px] transition hover:bg-[var(--bg-hover)]"
          style={{ paddingLeft, background: isSelected ? 'var(--select-bg)' : undefined }}
          type="button"
          aria-current={isSelected ? 'true' : undefined}
          title={node.path}
          onClick={() => onSelectPath(node.path)}
        >
          <span className="w-3 shrink-0" aria-hidden="true" />
          <StatusIcon status={node.file.status} />
          <span className="min-w-0 truncate text-[var(--text-2)]">{node.name}</span>
        </button>
        {isWip ? (
          <div
            className="wip-file-row-action"
            style={{ background: isSelected
              ? 'linear-gradient(90deg, transparent, var(--select-bg) 18px)'
              : 'linear-gradient(90deg, transparent, var(--bg-hover) 18px)' }}
          >
            <button
              className="wip-file-primary-action"
              data-tone={primaryAction.tone}
              type="button"
              disabled={primaryAction.disabled}
              onClick={primaryAction.onClick}
              aria-label={`${primaryAction.label} ${node.path}`}
            >
              {primaryAction.label}
            </button>
          </div>
        ) : null}
      </div>
    );

    return (
      <li>
        {isWip ? (
          <WipFileContextMenu
            file={node.file}
            isMutating={isMutating}
            onStage={() => onStageFile(node.path)}
            onUnstage={() => onUnstageFile(node.path)}
            onResolve={() => onSelectPath(node.path)}
            onDiscard={() => onDiscardWipFile(node.file)}
            onIgnore={(mode) => onIgnoreWipFile(node.file, mode)}
            onInspect={(mode) => onInspectWipFile(node.file, mode)}
            onCopyPath={() => onCopyWipFilePath(node.file)}
            onOpen={() => onOpenWipFile(node.file)}
            onReveal={() => onRevealWipFile(node.file)}
            onStash={() => onStashWipFile(node.file)}
          >
            {row}
          </WipFileContextMenu>
        ) : row}
      </li>
    );
  }

  const isExpanded = expandedPaths.has(node.path);

  return (
    <li>
      <button
        className="flex h-8 w-full min-w-0 items-center gap-1 rounded pr-2 text-left text-[12px] text-[var(--text-3)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-2)]"
        style={{ paddingLeft }}
        type="button"
        aria-expanded={isExpanded}
        title={node.path}
        onClick={() => onToggleDirectory(node.path)}
      >
        {isExpanded ? <ChevronDown size={13} className="shrink-0" /> : <ChevronRight size={13} className="shrink-0" />}
        <span className="min-w-0 truncate">{node.name}</span>
        {!isExpanded ? <DirectoryStatusCounts counts={node.counts} /> : null}
      </button>
      {isExpanded ? (
        <ul>
          {node.children.map((child) => (
            <ChangedFileTreeRow
              key={`${child.kind}:${child.path}`}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              selectedPath={selectedPath}
              isWip={isWip}
              isMutating={isMutating}
              onToggleDirectory={onToggleDirectory}
              onSelectPath={onSelectPath}
              onStageFile={onStageFile}
              onUnstageFile={onUnstageFile}
              onDiscardWipFile={onDiscardWipFile}
              onIgnoreWipFile={onIgnoreWipFile}
              onInspectWipFile={onInspectWipFile}
              onCopyWipFilePath={onCopyWipFilePath}
              onOpenWipFile={onOpenWipFile}
              onRevealWipFile={onRevealWipFile}
              onStashWipFile={onStashWipFile}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function DirectoryStatusCounts({ counts }: { counts: FileStatusCounts }): ReactElement {
  const modifiedCount = counts.modified + counts.renamed + counts.conflicted;

  return (
    <span className="ml-2 flex shrink-0 items-center gap-2 text-[11px]">
      {modifiedCount > 0 ? (
        <span className="flex items-center gap-1" style={{ color: FILE_STATUS_COLORS.modified }}>
          <Pencil size={11} />
          {modifiedCount}
        </span>
      ) : null}
      {counts.added > 0 ? (
        <span className="flex items-center gap-1" style={{ color: FILE_STATUS_COLORS.added }}>
          <Plus size={12} />
          {counts.added}
        </span>
      ) : null}
      {counts.deleted > 0 ? (
        <span className="flex items-center gap-1" style={{ color: FILE_STATUS_COLORS.deleted }}>
          <Minus size={12} />
          {counts.deleted}
        </span>
      ) : null}
    </span>
  );
}

function collectDirectoryPaths(nodes: ChangedFileTreeNode[]): string[] {
  const paths: string[] = [];

  for (const node of nodes) {
    if (node.kind !== 'directory') {
      continue;
    }

    paths.push(node.path, ...collectDirectoryPaths(node.children));
  }

  return paths;
}

function PanelMessage({ icon, label }: { icon: ReactElement; label: string }): ReactElement {
  return (
    <div className="grid min-h-[120px] place-items-center px-6 py-8 text-center text-xs leading-5 text-[var(--text-3)]">
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
    </div>
  );
}

function EmptyFiles({ isWip }: { isWip: boolean }): ReactElement {
  if (!isWip) {
    return <div className="px-2 py-3 text-xs text-[var(--text-3)]">No files in this commit.</div>;
  }

  return (
    <div>
      <UnstagedEmpty />
      <div className="border-t border-[var(--border)]">
        <StagedEmpty />
      </div>
    </div>
  );
}

function UnstagedEmpty(): ReactElement {
  return <div className="px-2 py-3 text-xs text-[var(--text-3)]">No unstaged changes.</div>;
}

function StagedEmpty({
  isMutating = false,
  onStageAll
}: {
  isMutating?: boolean;
  onStageAll?: () => void;
}): ReactElement {
  return (
    <div className="px-2 py-3 text-xs text-[var(--text-3)]">
      <p>No staged files. Stage files to include them in the next commit.</p>
      {onStageAll ? (
        <button
          className="btn-subtle mt-2 h-6 px-2 text-[11px]"
          type="button"
          disabled={isMutating}
          onClick={onStageAll}
        >
          <Check size={12} />
          Stage all
        </button>
      ) : null}
    </div>
  );
}

function StatusIcon({ status }: { status: GitStatusCode }): ReactElement {
  const graphStatus = graphFileStatus(status);

  if (graphStatus === 'modified') {
    return <Pencil size={12} className="shrink-0" style={{ color: FILE_STATUS_COLORS.modified }} />;
  }

  if (graphStatus === 'added') {
    return <Plus size={13} className="shrink-0" style={{ color: FILE_STATUS_COLORS.added }} />;
  }

  return <Minus size={13} className="shrink-0" style={{ color: FILE_STATUS_COLORS.deleted }} />;
}

function canOpenWorktreeFile(file: GitFileChangeDetail): boolean {
  return file.status !== 'deleted';
}

function canDiscardWipFile(file: GitFileChangeDetail): boolean {
  return !file.conflicted && (file.staged || file.unstaged);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
