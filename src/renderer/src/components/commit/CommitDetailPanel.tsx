import type { MouseEvent, PointerEvent, ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { prepareFileTreeInput, type GitStatusEntry } from '@pierre/trees';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDownAZ,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FilePen,
  FolderOpen,
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
  Trash2
} from 'lucide-react';

import {
  invalidateRepositoryQueries,
  useCommitDetail,
  useWipDetail
} from '@renderer/queries/repository';
import {
  countByStatus,
  findFile,
  graphFileStatus,
  treeHeight,
  treeStatus,
  type FileStatusCounts,
  type FileViewMode
} from '@renderer/components/commit/fileDetailUtils';
import { AuthorAvatar } from '@renderer/components/avatar/AuthorAvatar';
import { FILE_STATUS_COLORS } from '@shared/graph';
import type { CommitGraphRow, GitCommitPerson, GitFileChangeDetail, GitRepositoryDetail, GitStatusCode, RepoProfileState } from '@shared/types';
import {
  DEFAULT_DETAIL_PANEL_WIDTH,
  MAX_DETAIL_PANEL_WIDTH,
  MIN_DETAIL_PANEL_WIDTH,
  normalizeDetailPanelWidth
} from '@shared/workspace';

type CommitDetailPanelProps = {
  repoPath?: string;
  row?: CommitGraphRow;
  parentSha?: string;
  selectedFile?: string;
  wipDirtyCount?: number;
  profileState?: RepoProfileState;
  commitFocusSignal: number;
  isOperationBusy: boolean;
  width?: number;
  isCollapsed?: boolean;
  remoteAvatars?: boolean;
  onToggleCollapsed?: () => void;
  onResize?: (width: number) => void;
  onResizeCommit?: (width: number) => void;
  onSelectFile: (path: string | undefined) => void;
  onOpenWipChanges: () => void;
  onDiscardAllWip: () => void;
  onDiscardWipFile: (file: GitFileChangeDetail) => void;
  onOpenWipFile: (file: GitFileChangeDetail) => void;
  onRevealWipFile: (file: GitFileChangeDetail) => void;
};

export function CommitDetailPanel({
  repoPath,
  row,
  parentSha,
  selectedFile,
  wipDirtyCount = 0,
  profileState,
  commitFocusSignal,
  isOperationBusy,
  width = 382,
  isCollapsed = false,
  remoteAvatars = false,
  onToggleCollapsed,
  onResize,
  onResizeCommit,
  onSelectFile,
  onOpenWipChanges,
  onDiscardAllWip,
  onDiscardWipFile,
  onOpenWipFile,
  onRevealWipFile
}: CommitDetailPanelProps): ReactElement {
  const queryClient = useQueryClient();
  const resizeStateRef = useRef<{ startX: number; startWidth: number; width: number } | undefined>(undefined);
  const [fileView, setFileView] = useState<FileViewMode>('path');
  const [commitMessage, setCommitMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const isWip = row?.node.kind === 'wip';
  const commitQuery = useCommitDetail(repoPath, row && !isWip ? row.sha : undefined);
  const wipQuery = useWipDetail(repoPath, Boolean(row && isWip));
  const headCommitQuery = useCommitDetail(repoPath, row && isWip ? row.parentShas[0] : undefined);
  const detail = (isWip ? wipQuery.data : commitQuery.data) as GitRepositoryDetail | undefined;
  const detailError = isWip ? wipQuery.error : commitQuery.error;
  const isDetailLoading = isWip ? wipQuery.isLoading : commitQuery.isLoading;
  const files = detail?.files ?? [];
  const selectedFileDetail = findFile(files, selectedFile);
  const stageFileMutation = useMutation({
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
      <aside className="commit-detail-panel flex w-10 shrink-0 flex-col items-center border-l border-[var(--border)] bg-[var(--bg-panel)] py-2" aria-label="Commit details">
        <button className="icon-btn" type="button" onClick={onToggleCollapsed} aria-label="Expand commit details" title="Expand commit details">
          <PanelRightOpen size={15} />
        </button>
      </aside>
    );
  }

  if (!row || !repoPath) {
    return (
      <aside className="commit-detail-panel relative flex shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-panel)]" style={{ width: normalizeDetailPanelWidth(width) }} aria-label="Commit details">
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
    isOperationBusy;
  const detailErrorMessage = detailError instanceof Error ? detailError.message : undefined;

  function renderFilesSection(): ReactElement | null {
    if (!detail) {
      return null;
    }

    return (
      <>
        <FilesToolbar
          counts={counts}
          fileView={fileView}
          isWip={isWip}
          onSetFileView={setFileView}
        />

        <div className="px-2 pb-3 pt-1">
          {isWip && selectedFileDetail ? (
            <WipFileActionStrip
              file={selectedFileDetail}
              isMutating={activeMutation}
              onStage={() => stageFileMutation.mutate(selectedFileDetail.path)}
              onUnstage={() => unstageFileMutation.mutate(selectedFileDetail.path)}
              onDiscard={() => onDiscardWipFile(selectedFileDetail)}
              onOpen={() => onOpenWipFile(selectedFileDetail)}
              onReveal={() => onRevealWipFile(selectedFileDetail)}
            />
          ) : null}
          {files.length === 0 ? (
            <EmptyFiles />
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
              onOpenWipFile={onOpenWipFile}
              onRevealWipFile={onRevealWipFile}
            />
          ) : (
            <ChangedFilesTree
              key={files.map((file) => `${file.status}:${file.path}`).join('\0')}
              files={files}
              selectedPath={selectedFileDetail?.path}
              onSelectPath={onSelectFile}
            />
          )}
        </div>
      </>
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
        commitError={commitMutation.error instanceof Error ? commitMutation.error.message : undefined}
        onChangeMessage={setCommitMessage}
        onChangeAmend={(value) => {
          setAmend(value);

          if (value && !commitMessage && headCommitQuery.data?.message) {
            setCommitMessage(headCommitQuery.data.message);
          }
        }}
        onCommit={() => commitMutation.mutate()}
      />
    );
  }

  return (
    <aside className="commit-detail-panel relative flex shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-panel)]" style={{ width: normalizeDetailPanelWidth(width) }} aria-label="Commit details">
      <DetailResizeHandle width={width} isActive={isResizing} onPointerDown={handleResizeStart} onResize={onResize} onResizeCommit={onResizeCommit} />
      <WorkingDirectoryBanner
        dirtyCount={wipDirtyCount}
        isViewingWip={isWip}
        onOpenWipChanges={onOpenWipChanges}
      />
      <PanelHeader
        row={row}
        detail={detail}
        isMutating={activeMutation}
        onDiscardAllWip={onDiscardAllWip}
        onToggleCollapsed={onToggleCollapsed}
      />

      {isDetailLoading && !detail ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <PanelMessage icon={<Loader2 size={15} className="animate-spin" />} label="Loading details..." />
        </div>
      ) : detailErrorMessage ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <PanelMessage icon={<RotateCcw size={15} />} label={detailErrorMessage} />
        </div>
      ) : detail && isWip ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {renderFilesSection()}
          </div>
          {renderWipCommitSection()}
        </div>
      ) : detail ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SummarySection detail={detail} parentSha={parentSha} remoteAvatars={remoteAvatars} />
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
    <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-[var(--select-border)] bg-[var(--worktree-banner-bg)] px-4 text-[13px] font-semibold text-[var(--text-1)]">
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
  isMutating,
  onDiscardAllWip,
  onToggleCollapsed
}: {
  row: CommitGraphRow;
  detail?: GitRepositoryDetail;
  isMutating: boolean;
  onDiscardAllWip: () => void;
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

  if (isWip) {
    const hasConflicts = (wipDetail?.conflictedCount ?? 0) > 0;
    const discardDisabled = !wipDetail || hasConflicts || isMutating;
    const discardTitle = hasConflicts
      ? 'Resolve or abort the in-progress operation before discarding all changes'
      : 'Discard all uncommitted changes';

    return (
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 text-xs text-[var(--text-2)]">
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
        <button className="icon-btn h-7 w-7" type="button" onClick={onToggleCollapsed} aria-label="Collapse commit details" title="Collapse commit details">
          <PanelRightClose size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-3 text-xs text-[var(--text-2)]">
      <span className="flex min-w-0 items-center gap-2">
        <FilePen size={14} className="shrink-0 text-[var(--text-3)]" />
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
      <button className="icon-btn h-7 w-7" type="button" onClick={onToggleCollapsed} aria-label="Collapse commit details" title="Collapse commit details">
        <PanelRightClose size={14} />
      </button>
    </div>
  );
}

function SummarySection({
  detail,
  parentSha,
  remoteAvatars
}: {
  detail: GitRepositoryDetail;
  parentSha?: string;
  remoteAvatars: boolean;
}): ReactElement | null {
  if (detail.kind === 'wip') {
    return null;
  }

  return (
    <>
      <div className="border-b border-[var(--border)] px-5 py-4">
        <h2 className="text-[17px] font-semibold leading-snug text-[var(--text-1)]">{detail.subject}</h2>
        {detail.body ? (
          <div className="mt-3 max-h-40 overflow-y-auto pr-2 text-[13px] leading-5 text-[var(--text-2)]">
            <p className="whitespace-pre-wrap">{detail.body}</p>
          </div>
        ) : null}
      </div>

      <div className="space-y-3 border-b border-[var(--border)] px-5 py-3.5">
        {parentSha ? (
          <p className="text-right text-[11px] text-[var(--text-3)]">
            parent: <span className="mono">{parentSha.slice(0, 8)}</span>
          </p>
        ) : null}
        <SignatureRow
          person={detail.author}
          action="authored"
          remoteAvatars={remoteAvatars}
        />
        {shouldShowCommitter(detail) ? (
          <SignatureRow
            person={detail.committer}
            action="committed"
            remoteAvatars={remoteAvatars}
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-4 pt-1 text-[12px] text-[var(--text-2)]">
          <span className="flex items-center gap-1.5">
            <FilePen size={13} className="text-[var(--text-3)]" />
            {detail.stats.filesChanged} changed
          </span>
          <span className="flex items-center gap-1.5 text-[var(--success-text)]">
            <Plus size={13} />
            {detail.stats.additions} added
          </span>
          <span className="flex items-center gap-1.5 text-[var(--danger-text)]">
            <Minus size={13} />
            {detail.stats.deletions} deleted
          </span>
        </div>
      </div>
    </>
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
    <div className="flex min-w-0 items-center gap-2.5">
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
  if (detail.kind === 'wip') {
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
  commitError?: string;
  onChangeMessage: (value: string) => void;
  onChangeAmend: (value: boolean) => void;
  onCommit: () => void;
};

function WipCommitSection({
  detail,
  profileState,
  commitMessage,
  focusSignal,
  amend,
  isCommitting,
  commitError,
  onChangeMessage,
  onChangeAmend,
  onCommit
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
      <textarea
        ref={textareaRef}
        className="h-20 w-full resize-none rounded-md border border-[var(--border)] bg-[var(--bg-field)] px-2.5 py-2 text-xs text-[var(--text-1)] placeholder-[var(--text-3)] outline-none transition focus:border-[var(--border-strong)]"
        placeholder={amend ? 'Amend commit message' : 'Commit summary'}
        value={commitMessage}
        onChange={(event) => onChangeMessage(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && canCommit) {
            event.preventDefault();
            onCommit();
          }
        }}
      />
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
  onSetFileView: (view: FileViewMode) => void;
};

function FilesToolbar({
  counts,
  fileView,
  isWip,
  onSetFileView
}: FilesToolbarProps): ReactElement {
  if (isWip) {
    return (
      <div className="border-b border-[var(--border)] px-4 py-2">
        <div className="flex items-center justify-between gap-3">
          <FileListControls fileView={fileView} onSetFileView={onSetFileView} />
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-[var(--border)] px-4 pb-2 pt-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3 text-xs">
          <StatusCount status="modified" count={counts.modified} />
          <StatusCount status="added" count={counts.added} />
          <StatusCount status="deleted" count={counts.deleted} />
          {counts.renamed > 0 ? <span className="text-[var(--text-2)]">{counts.renamed} renamed</span> : null}
          {counts.conflicted > 0 ? <span className="text-[var(--danger-text)]">{counts.conflicted} conflicted</span> : null}
        </div>
        <FileListControls fileView={fileView} onSetFileView={onSetFileView} />
      </div>
    </div>
  );
}

function FileListControls({
  fileView,
  onSetFileView
}: {
  fileView: FileViewMode;
  onSetFileView: (view: FileViewMode) => void;
}): ReactElement {
  return (
    <div className="flex shrink-0 items-center gap-3">
      <span className="inline-flex h-7 items-center gap-1.5 text-[11px] font-semibold uppercase text-[var(--text-3)]" title="Sorted by path">
        <ArrowDownAZ size={14} />
      </span>
      <FileViewToggle fileView={fileView} onSetFileView={onSetFileView} />
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
  onOpenWipFile: (file: GitFileChangeDetail) => void;
  onRevealWipFile: (file: GitFileChangeDetail) => void;
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
  onOpenWipFile,
  onRevealWipFile
}: PathFileRowsProps): ReactElement {
  function renderRow(file: GitFileChangeDetail, key: string): ReactElement {
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
        onOpen={() => onOpenWipFile(file)}
        onReveal={() => onRevealWipFile(file)}
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
            detail="Open a file, resolve its markers, then mark it resolved."
          />
          {conflictedFiles.map((file) => renderRow(file, `conflict:${file.path}`))}
        </>
      ) : null}
      <FileGroupHeader
        label={`Unstaged Files (${unstagedFiles.length})`}
        separated={conflictedFiles.length > 0}
        action={
          unstagedFiles.length > 0 ? (
            <button
              className="btn-subtle h-6 px-2 text-[11px]"
              type="button"
              disabled={isMutating}
              onClick={onStageAll}
              style={{ borderColor: 'var(--success-border)', color: 'var(--success-text)' }}
            >
              <Check size={12} />
              Stage All Changes
            </button>
          ) : undefined
        }
      />
      {unstagedFiles.map((file) => renderRow(file, `unstaged:${file.path}`))}
      <FileGroupHeader
        label={`Staged Files (${stagedFiles.length})`}
        separated
        action={
          stagedFiles.length > 0 ? (
            <button className="btn-subtle h-6 px-2 text-[11px]" type="button" disabled={isMutating} onClick={onUnstageAll}>
              <RotateCcw size={12} />
              Unstage All
            </button>
          ) : undefined
        }
      />
      {stagedFiles.map((file) => renderRow(file, `staged:${file.path}`))}
    </>
  );
}

function FileGroupHeader({
  label,
  separated = false,
  action,
  tone = 'default',
  detail
}: {
  label: string;
  separated?: boolean;
  action?: ReactElement;
  tone?: 'default' | 'danger';
  detail?: string;
}): ReactElement {
  return (
    <div
      className={`flex min-h-8 items-center justify-between gap-2 px-1 py-1 text-[12px] font-semibold ${tone === 'danger' ? 'text-[var(--danger-text)]' : 'text-[var(--text-2)]'}${separated ? ' mt-2 border-t border-[var(--border)] pt-2' : ''}`}
    >
      <div className="flex min-w-0 items-start gap-1.5">
        {tone === 'danger' ? <AlertTriangle size={13} className="mt-0.5 shrink-0" /> : <ChevronDown size={13} className="mt-0.5 shrink-0 text-[var(--text-3)]" />}
        <span className="min-w-0">
          <span className="block truncate">{label}</span>
          {detail ? <span className="mt-0.5 block text-[10.5px] font-normal leading-4 text-[var(--text-3)]">{detail}</span> : null}
        </span>
      </div>
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
  onOpen: () => void;
  onReveal: () => void;
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
  onOpen,
  onReveal
}: FileRowProps): ReactElement {
  const separatorIndex = file.path.lastIndexOf('/');
  const directory = separatorIndex === -1 ? '' : file.path.slice(0, separatorIndex + 1);
  const basename = separatorIndex === -1 ? file.path : file.path.slice(separatorIndex + 1);
  const canOpen = canOpenWorktreeFile(file);
  const canDiscard = canDiscardWipFile(file);

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

  return (
    <div
      className="group grid h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded px-2 text-xs transition hover:bg-[var(--bg-hover)]"
      style={{ background: isSelected ? 'var(--select-bg)' : undefined }}
    >
      <button
        className="flex h-full min-w-0 items-center gap-2 overflow-hidden text-left"
        type="button"
        title={file.path}
        onPointerDown={handleSelectPointerDown}
        onClick={handleSelectClick}
      >
        <StatusIcon status={file.status} />
        {directory ? <span className="min-w-0 truncate text-[var(--text-3)]">{directory}</span> : null}
        <span className="min-w-0 truncate text-[var(--text-2)]">{basename}</span>
        {file.conflicted ? <span className="badge-mini border-[var(--danger-border)] text-[var(--danger-text)]">conflict</span> : null}
        {!isWip && file.staged ? <span className="badge-mini">staged</span> : null}
        {!isWip && file.unstaged ? <span className="badge-mini">worktree</span> : null}
      </button>
      {isWip ? (
        <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
          <button className="icon-btn h-6 w-6" type="button" disabled={(!file.unstaged && !file.conflicted) || isMutating} onClick={onStage} title={file.conflicted ? 'Mark resolved by staging file' : 'Stage file'} aria-label={file.conflicted ? `Mark ${file.path} resolved` : `Stage ${file.path}`}>
            <Check size={12} />
          </button>
          <button className="icon-btn h-6 w-6" type="button" disabled={!file.staged || isMutating} onClick={onUnstage} title="Unstage file">
            <RotateCcw size={12} />
          </button>
          <button className="icon-btn h-6 w-6" type="button" disabled={!canOpen} onClick={onOpen} title="Open file">
            <ExternalLink size={12} />
          </button>
          <button className="icon-btn h-6 w-6" type="button" onClick={onReveal} title="Reveal in Finder">
            <FolderOpen size={12} />
          </button>
          <button className="icon-btn h-6 w-6" type="button" disabled={!canDiscard || isMutating} onClick={onDiscard} title="Discard file changes">
            <Trash2 size={12} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

type WipFileActionStripProps = {
  file: GitFileChangeDetail;
  isMutating: boolean;
  onStage: () => void;
  onUnstage: () => void;
  onDiscard: () => void;
  onOpen: () => void;
  onReveal: () => void;
};

function WipFileActionStrip({
  file,
  isMutating,
  onStage,
  onUnstage,
  onDiscard,
  onOpen,
  onReveal
}: WipFileActionStripProps): ReactElement {
  const canOpen = canOpenWorktreeFile(file);
  const canDiscard = canDiscardWipFile(file);

  return (
    <div className="mb-2 flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2 text-xs">
      <span className="min-w-0 flex-1 truncate text-[var(--text-2)]" title={file.path}>
        {file.path}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <button className="icon-btn h-6 w-6" type="button" disabled={(!file.unstaged && !file.conflicted) || isMutating} onClick={onStage} title={file.conflicted ? 'Mark resolved by staging file' : 'Stage file'} aria-label={file.conflicted ? `Mark ${file.path} resolved` : `Stage ${file.path}`}>
          <Check size={12} />
        </button>
        <button className="icon-btn h-6 w-6" type="button" disabled={!file.staged || isMutating} onClick={onUnstage} title="Unstage file">
          <RotateCcw size={12} />
        </button>
        <button className="icon-btn h-6 w-6" type="button" disabled={!canOpen} onClick={onOpen} title="Open file">
          <ExternalLink size={12} />
        </button>
        <button className="icon-btn h-6 w-6" type="button" onClick={onReveal} title="Reveal in Finder">
          <FolderOpen size={12} />
        </button>
        <button className="icon-btn h-6 w-6" type="button" disabled={!canDiscard || isMutating} onClick={onDiscard} title="Discard file changes">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

type ChangedFilesTreeProps = {
  files: GitFileChangeDetail[];
  selectedPath?: string;
  onSelectPath: (path: string | undefined) => void;
};

function ChangedFilesTree({ files, selectedPath, onSelectPath }: ChangedFilesTreeProps): ReactElement {
  const isSyncingSelectionRef = useRef(false);
  const paths = useMemo(() => files.map((file) => file.path), [files]);
  const pathSet = useMemo(() => new Set(paths), [paths]);
  const preparedInput = useMemo(() => prepareFileTreeInput(paths, { flattenEmptyDirectories: true }), [paths]);
  const gitStatus = useMemo<GitStatusEntry[]>(
    () =>
      files.map((file) => ({
        path: file.path,
        status: treeStatus(file.status)
      })),
    [files]
  );
  const { model } = useFileTree({
    preparedInput,
    gitStatus,
    initialExpansion: 'open',
    initialSelectedPaths: selectedPath ? [selectedPath] : [],
    onSelectionChange(selectedPaths) {
      if (isSyncingSelectionRef.current) {
        return;
      }

      onSelectPath(selectedPaths.find((path) => pathSet.has(path)));
    },
    search: files.length > 8,
    unsafeCSS: `
      :host {
        --trees-selected-bg-override: var(--select-bg);
        --trees-border-color-override: var(--border);
        --trees-fg-override: var(--text-2);
        --trees-muted-fg-override: var(--text-3);
        --trees-bg-override: transparent;
        --trees-hover-bg-override: var(--bg-hover);
        font-size: 12px;
      }
    `
  });

  useEffect(() => {
    const selectedPaths = model.getSelectedPaths();
    const currentSelectedPath = selectedPaths.find((path) => pathSet.has(path));

    if (currentSelectedPath === selectedPath && selectedPaths.length <= (selectedPath ? 1 : 0)) {
      return;
    }

    isSyncingSelectionRef.current = true;

    try {
      for (const path of selectedPaths) {
        if (path !== selectedPath) {
          model.getItem(path)?.deselect();
        }
      }

      if (selectedPath && pathSet.has(selectedPath)) {
        const selectedItem = model.getItem(selectedPath);

        if (!selectedItem?.isSelected()) {
          selectedItem?.select();
        }
      }
    } finally {
      isSyncingSelectionRef.current = false;
    }
  }, [model, pathSet, selectedPath]);

  return <FileTree className="gg-file-tree" model={model} style={{ height: treeHeight(files.length) }} />;
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

function EmptyFiles(): ReactElement {
  return <div className="px-2 py-3 text-xs text-[var(--text-3)]">No files to display.</div>;
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
