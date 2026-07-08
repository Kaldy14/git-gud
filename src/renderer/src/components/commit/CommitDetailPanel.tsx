import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { prepareFileTreeInput, type GitStatusEntry } from '@pierre/trees';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownAZ,
  Check,
  ChevronDown,
  ExternalLink,
  FilePen,
  FolderOpen,
  FolderTree,
  GitCommit,
  List,
  Loader2,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
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

type CommitDetailPanelProps = {
  repoPath?: string;
  row?: CommitGraphRow;
  parentSha?: string;
  selectedFile?: string;
  wipDirtyCount?: number;
  profileState?: RepoProfileState;
  commitFocusSignal: number;
  isOperationBusy: boolean;
  onSelectFile: (path: string | undefined) => void;
  onOpenWipChanges: () => void;
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
  onSelectFile,
  onOpenWipChanges,
  onDiscardWipFile,
  onOpenWipFile,
  onRevealWipFile
}: CommitDetailPanelProps): ReactElement {
  const queryClient = useQueryClient();
  const [fileView, setFileView] = useState<FileViewMode>('path');
  const [commitMessage, setCommitMessage] = useState('');
  const [amend, setAmend] = useState(false);
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
      void invalidateRepositoryQueries(queryClient, result.repoPath);
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
      void invalidateRepositoryQueries(queryClient, result.repoPath);
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
      void invalidateRepositoryQueries(queryClient, result.repoPath);
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
      void invalidateRepositoryQueries(queryClient, result.repoPath);
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

      void invalidateRepositoryQueries(queryClient, result.repoPath);
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

  if (!row || !repoPath) {
    return (
      <aside className="flex w-[428px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-panel)]">
        <div className="grid flex-1 place-items-center px-8 text-center text-xs leading-5 text-[var(--text-3)]">
          Select a commit in the graph to inspect it.
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
    <aside className="flex w-[428px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-panel)]">
      <WorkingDirectoryBanner
        dirtyCount={wipDirtyCount}
        isViewingWip={isWip}
        onOpenWipChanges={onOpenWipChanges}
      />
      <PanelHeader row={row} detail={detail} />

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
          <SummarySection detail={detail} parentSha={parentSha} />
          {renderFilesSection()}
        </div>
      ) : null}
    </aside>
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

function PanelHeader({ row, detail }: { row: CommitGraphRow; detail?: GitRepositoryDetail }): ReactElement {
  const isWip = row.node.kind === 'wip';
  const wipDetail = detail?.kind === 'wip' ? detail : undefined;

  if (isWip) {
    return (
      <div className="grid h-9 shrink-0 grid-cols-[40px_minmax(0,1fr)_40px] items-center border-b border-[var(--border)] px-2 text-xs text-[var(--text-2)]">
        <button
          className="icon-btn h-7 w-7 justify-self-start rounded border border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-text)]"
          type="button"
          disabled
          title="Discard all changes is not implemented yet."
          style={{
            background: 'var(--danger-bg)',
            borderColor: 'var(--danger-border)',
            color: 'var(--danger-text)',
            opacity: 1
          }}
        >
          <Trash2 size={14} />
        </button>
        <div className="flex min-w-0 items-center justify-center gap-2">
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
        <button
          className="icon-btn h-7 w-7 justify-self-end rounded border border-[var(--ai-border)] bg-[var(--ai-bg)] text-[var(--ai-text)]"
          type="button"
          disabled
          title="Compose commits with AI is not implemented yet."
          style={{
            background: 'var(--ai-bg)',
            borderColor: 'var(--ai-border)',
            color: 'var(--ai-text)',
            opacity: 1
          }}
        >
          <Sparkles size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-3 text-xs text-[var(--text-2)]">
      <span className="flex min-w-0 items-center gap-2">
        <FilePen size={14} className="shrink-0 text-[var(--text-3)]" />
        <span className="shrink-0">commit:</span>
        <span className="mono min-w-0 truncate text-[var(--text-1)]">{row.sha.slice(0, 12)}</span>
      </span>
      <button
        className="inline-flex h-7 shrink-0 items-center gap-2 rounded border border-[var(--ai-border)] bg-[var(--ai-bg)] px-2.5 text-xs font-semibold text-[var(--ai-text)] disabled:opacity-100"
        type="button"
        disabled
        title="Explain commit is not part of the local Git workflow scope."
      >
        <Sparkles size={13} />
        <span>Explain commit</span>
      </button>
    </div>
  );
}

function SummarySection({ detail, parentSha }: { detail: GitRepositoryDetail; parentSha?: string }): ReactElement | null {
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
        />
        {shouldShowCommitter(detail) ? (
          <SignatureRow
            person={detail.committer}
            action="committed"
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
  action
}: {
  person: GitCommitPerson;
  action: 'authored' | 'committed';
}): ReactElement {
  const email = person.email;

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <AuthorAvatar
        name={person.name}
        email={email}
        avatarUrl={person.avatarUrl}
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
  const identity = profileState?.effectiveIdentity;
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
        <button className="btn-accent h-8 text-xs" type="button" disabled={!canCommit} onClick={onCommit}>
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
      <label className="inline-flex h-7 items-center gap-2 text-[11px] text-[var(--text-2)]" title="Showing changed files only in this build.">
        <input type="checkbox" disabled />
        View all files
      </label>
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

  const unstagedFiles = files.filter((file) => file.unstaged);
  const stagedFiles = files.filter((file) => file.staged);

  return (
    <>
      <FileGroupHeader
        label={`Unstaged Files (${unstagedFiles.length})`}
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
  action
}: {
  label: string;
  separated?: boolean;
  action?: ReactElement;
}): ReactElement {
  return (
    <div
      className={`flex h-8 items-center justify-between gap-2 px-1 text-[12px] font-semibold text-[var(--text-2)]${separated ? ' mt-2 border-t border-[var(--border)] pt-2' : ''}`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <ChevronDown size={13} className="shrink-0 text-[var(--text-3)]" />
        <span className="truncate">{label}</span>
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

  return (
    <div
      className="group grid h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded px-2 text-xs transition hover:bg-[var(--bg-hover)]"
      style={{ background: isSelected ? 'var(--select-bg)' : undefined }}
    >
      <button className="flex min-w-0 items-center gap-2 overflow-hidden text-left" type="button" title={file.path} onClick={onSelect}>
        <StatusIcon status={file.status} />
        {directory ? <span className="min-w-0 truncate text-[var(--text-3)]">{directory}</span> : null}
        <span className="min-w-0 truncate text-[var(--text-2)]">{basename}</span>
        {!isWip && file.staged ? <span className="badge-mini">staged</span> : null}
        {!isWip && file.unstaged ? <span className="badge-mini">worktree</span> : null}
      </button>
      {isWip ? (
        <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
          <button className="icon-btn h-6 w-6" type="button" disabled={!file.unstaged || isMutating} onClick={onStage} title="Stage file">
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
        <button className="icon-btn h-6 w-6" type="button" disabled={!file.unstaged || isMutating} onClick={onStage} title="Stage file">
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
  return file.status !== 'deleted' && !file.conflicted;
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
