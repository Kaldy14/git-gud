import type { ReactElement } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { prepareFileTreeInput, type GitStatusEntry } from '@pierre/trees';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  FilePen,
  FolderTree,
  GitCommit,
  List,
  Loader2,
  Minus,
  Pencil,
  Plus,
  RotateCcw
} from 'lucide-react';

import {
  commitDetailQueryKey,
  repositoryOverviewQueryKey,
  useCommitDetail,
  useWipDetail,
  wipDetailQueryKey
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
import { FILE_STATUS_COLORS } from '@shared/graph';
import type { CommitGraphRow, GitFileChangeDetail, GitRepositoryDetail, GitStatusCode, RepoProfileState } from '@shared/types';

type CommitDetailPanelProps = {
  repoPath?: string;
  row?: CommitGraphRow;
  parentSha?: string;
  selectedFile?: string;
  profileState?: RepoProfileState;
  commitFocusSignal: number;
  onSelectFile: (path: string | undefined) => void;
};

export function CommitDetailPanel({
  repoPath,
  row,
  parentSha,
  selectedFile,
  profileState,
  commitFocusSignal,
  onSelectFile
}: CommitDetailPanelProps): ReactElement {
  const queryClient = useQueryClient();
  const [fileView, setFileView] = useState<FileViewMode>('tree');
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
      void invalidateRepository(queryClient, result.repoPath, row?.sha);
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
      void invalidateRepository(queryClient, result.repoPath, row?.sha);
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
      void invalidateRepository(queryClient, result.repoPath, row?.sha);
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
      void invalidateRepository(queryClient, result.repoPath, row?.sha);
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

      void invalidateRepository(queryClient, result.repoPath, row?.sha);
    }
  });

  if (!row || !repoPath) {
    return (
      <aside className="flex w-[460px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-panel)]">
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
    commitMutation.isPending;
  const detailErrorMessage = detailError instanceof Error ? detailError.message : undefined;

  return (
    <aside className="flex w-[460px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-panel)]">
      <PanelHeader row={row} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isDetailLoading && !detail ? (
          <PanelMessage icon={<Loader2 size={15} className="animate-spin" />} label="Loading details..." />
        ) : detailErrorMessage ? (
          <PanelMessage icon={<RotateCcw size={15} />} label={detailErrorMessage} />
        ) : detail ? (
          <>
            <SummarySection detail={detail} parentSha={parentSha} />

            {isWip ? (
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
            ) : null}

            <FilesToolbar
              counts={counts}
              fileView={fileView}
              isWip={isWip}
              detail={detail}
              isMutating={activeMutation}
              onSetFileView={setFileView}
              onStageAll={() => stageAllMutation.mutate()}
              onUnstageAll={() => unstageAllMutation.mutate()}
            />

            <div className="px-2 pb-3 pt-1">
              {files.length === 0 ? (
                <EmptyFiles />
              ) : fileView === 'path' ? (
                files.map((file) => (
                  <FileRow
                    key={file.path}
                    file={file}
                    isWip={isWip}
                    isSelected={selectedFileDetail?.path === file.path}
                    isMutating={activeMutation}
                    onSelect={() => onSelectFile(file.path)}
                    onStage={() => stageFileMutation.mutate(file.path)}
                    onUnstage={() => unstageFileMutation.mutate(file.path)}
                  />
                ))
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
        ) : null}
      </div>
    </aside>
  );
}

function PanelHeader({ row }: { row: CommitGraphRow }): ReactElement {
  const isWip = row.node.kind === 'wip';

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 text-xs text-[var(--text-2)]">
      <FilePen size={13} className="text-[var(--text-3)]" />
      {isWip ? (
        <span className="font-medium">Work in progress</span>
      ) : (
        <span>
          commit: <span className="mono text-[var(--text-1)]">{row.sha.slice(0, 12)}</span>
        </span>
      )}
    </div>
  );
}

function SummarySection({ detail, parentSha }: { detail: GitRepositoryDetail; parentSha?: string }): ReactElement {
  if (detail.kind === 'wip') {
    return (
      <div className="border-b border-[var(--border)] px-4 py-3.5">
        <h2 className="text-[15px] font-semibold italic text-[var(--text-2)]">// WIP</h2>
        <p className="mt-1.5 text-xs text-[var(--text-3)]">
          {detail.dirtyCount} changed file{detail.dirtyCount === 1 ? '' : 's'} on {detail.branch.head}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="border-b border-[var(--border)] px-4 py-3.5">
        <h2 className="text-[15px] font-semibold leading-snug text-[var(--text-1)]">{detail.subject}</h2>
        {detail.body ? <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[var(--text-2)]">{detail.body}</p> : null}
      </div>

      <div className="space-y-3 border-b border-[var(--border)] px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold text-[var(--avatar-fg)]"
              style={{ background: detail.author.name ? avatarColor(detail.author.name) : 'var(--accent)' }}
            >
              {initials(detail.author.name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-[var(--text-1)]">{detail.author.name || 'Unknown author'}</p>
              <p className="truncate text-[11px] text-[var(--text-3)]">{detail.author.email}</p>
            </div>
          </div>
          {parentSha ? (
            <p className="shrink-0 pt-1 text-[11px] text-[var(--text-3)]">
              parent: <span className="mono">{parentSha.slice(0, 8)}</span>
            </p>
          ) : null}
        </div>
        <div className="grid grid-cols-3 gap-2 pl-[42px] text-[11px] text-[var(--text-3)]">
          <span>{detail.stats.filesChanged} files</span>
          <span className="text-[var(--success-text)]">+{detail.stats.additions}</span>
          <span className="text-[var(--danger-text)]">-{detail.stats.deletions}</span>
        </div>
      </div>
    </>
  );
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
    <div className="space-y-2.5 border-b border-[var(--border)] px-4 py-3.5">
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
  detail: GitRepositoryDetail;
  isMutating: boolean;
  onSetFileView: (view: FileViewMode) => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
};

function FilesToolbar({
  counts,
  fileView,
  isWip,
  detail,
  isMutating,
  onSetFileView,
  onStageAll,
  onUnstageAll
}: FilesToolbarProps): ReactElement {
  const stagedCount = detail.kind === 'wip' ? detail.stagedCount : 0;
  const unstagedCount = detail.kind === 'wip' ? detail.unstagedCount : 0;

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
      </div>
      {isWip ? (
        <div className="mt-2 flex items-center gap-2">
          <button className="btn-subtle h-7 text-[11px]" type="button" disabled={unstagedCount === 0 || isMutating} onClick={onStageAll}>
            <Check size={12} />
            Stage all
          </button>
          <button className="btn-subtle h-7 text-[11px]" type="button" disabled={stagedCount === 0 || isMutating} onClick={onUnstageAll}>
            <RotateCcw size={12} />
            Unstage all
          </button>
        </div>
      ) : null}
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

type FileRowProps = {
  file: GitFileChangeDetail;
  isWip: boolean;
  isSelected: boolean;
  isMutating: boolean;
  onSelect: () => void;
  onStage: () => void;
  onUnstage: () => void;
};

function FileRow({ file, isWip, isSelected, isMutating, onSelect, onStage, onUnstage }: FileRowProps): ReactElement {
  const separatorIndex = file.path.lastIndexOf('/');
  const directory = separatorIndex === -1 ? '' : file.path.slice(0, separatorIndex + 1);
  const basename = separatorIndex === -1 ? file.path : file.path.slice(separatorIndex + 1);

  return (
    <div
      className="group grid h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 text-xs transition hover:bg-[var(--bg-hover)]"
      style={{ background: isSelected ? 'var(--select-bg)' : undefined }}
    >
      <button className="flex min-w-0 items-center gap-2 text-left" type="button" title={file.path} onClick={onSelect}>
        <StatusIcon status={file.status} />
        {directory ? <span className="min-w-0 truncate text-[var(--text-3)]">{directory}</span> : null}
        <span className="shrink-0 text-[var(--text-2)]">{basename}</span>
        {file.staged ? <span className="badge-mini">staged</span> : null}
        {file.unstaged ? <span className="badge-mini">worktree</span> : null}
      </button>
      {isWip ? (
        <div className="flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
          <button className="icon-btn h-6 w-6" type="button" disabled={!file.unstaged || isMutating} onClick={onStage} title="Stage file">
            <Check size={12} />
          </button>
          <button className="icon-btn h-6 w-6" type="button" disabled={!file.staged || isMutating} onClick={onUnstage} title="Unstage file">
            <RotateCcw size={12} />
          </button>
        </div>
      ) : null}
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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?').concat(parts[1]?.[0] ?? '').toUpperCase();
}

function avatarColor(value: string): string {
  const colors = [
    'var(--avatar-1)',
    'var(--avatar-2)',
    'var(--avatar-3)',
    'var(--avatar-4)',
    'var(--avatar-5)',
    'var(--avatar-6)'
  ];
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) % colors.length;
  }

  return colors[hash] ?? colors[0];
}

async function invalidateRepository(
  queryClient: ReturnType<typeof useQueryClient>,
  repoPath: string,
  selectedSha: string | undefined
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: repositoryOverviewQueryKey(repoPath) }),
    queryClient.invalidateQueries({ queryKey: ['commit-graph', repoPath] }),
    queryClient.invalidateQueries({ queryKey: wipDetailQueryKey(repoPath) }),
    queryClient.invalidateQueries({ queryKey: ['file-diff', repoPath] }),
    selectedSha && selectedSha !== 'wip'
      ? queryClient.invalidateQueries({ queryKey: commitDetailQueryKey(repoPath, selectedSha) })
      : Promise.resolve()
  ]);
}
