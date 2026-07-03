import type { ReactElement } from 'react';
import { useMemo } from 'react';
import type { FileDiffOptions } from '@pierre/diffs';
import { PatchDiff } from '@pierre/diffs/react';
import {
  Columns2,
  FilePen,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Minus,
  RotateCcw,
  Rows3,
  X
} from 'lucide-react';

import { useCommitDetail, useFileDiff, useWipDetail } from '@renderer/queries/repository';
import {
  createDiffRequest,
  DIFF_OPTIONS_BASE,
  findFile,
  graphFileStatus,
  selectWipScope,
  type DiffStyle,
  type WipDiffScope
} from '@renderer/components/commit/fileDetailUtils';
import { FILE_STATUS_COLORS } from '@shared/graph';
import type { CommitGraphRow, GitFileChangeDetail, GitRepositoryDetail, GitStatusCode } from '@shared/types';

type FileFocusViewProps = {
  repoPath?: string;
  row?: CommitGraphRow;
  selectedFile?: string;
  diffStyle: DiffStyle;
  wipScopeByPath: Record<string, WipDiffScope>;
  onSetDiffStyle: (style: DiffStyle) => void;
  onChangeWipScope: (path: string, scope: WipDiffScope) => void;
  onClose: () => void;
};

export function FileFocusView({
  repoPath,
  row,
  selectedFile,
  diffStyle,
  wipScopeByPath,
  onSetDiffStyle,
  onChangeWipScope,
  onClose
}: FileFocusViewProps): ReactElement {
  const isWip = row?.node.kind === 'wip';
  const commitQuery = useCommitDetail(repoPath, row && !isWip ? row.sha : undefined);
  const wipQuery = useWipDetail(repoPath, Boolean(row && isWip));
  const detail = (isWip ? wipQuery.data : commitQuery.data) as GitRepositoryDetail | undefined;
  const detailError = isWip ? wipQuery.error : commitQuery.error;
  const isDetailLoading = isWip ? wipQuery.isLoading : commitQuery.isLoading;
  const files = detail?.files ?? [];
  const selectedFileDetail = findFile(files, selectedFile);
  const selectedWipScope = selectedFileDetail ? selectWipScope(selectedFileDetail, wipScopeByPath[selectedFileDetail.path]) : 'unstaged';
  const diffRequest = useMemo(
    () => createDiffRequest(row, selectedFileDetail, selectedWipScope),
    [row, selectedFileDetail, selectedWipScope]
  );
  const diffQuery = useFileDiff(repoPath, diffRequest);
  const diffOptions = useMemo<FileDiffOptions<undefined>>(
    () => ({
      ...DIFF_OPTIONS_BASE,
      diffStyle
    }),
    [diffStyle]
  );
  const headerPath = selectedFileDetail?.path ?? selectedFile ?? 'No file selected';
  const { directory, basename } = splitPath(headerPath);
  const detailErrorMessage = detailError instanceof Error ? detailError.message : undefined;

  return (
    <section className="file-focus">
      <div className="file-focus-pathbar">
        <div className="flex min-w-0 items-center gap-2">
          {selectedFileDetail ? <StatusIcon status={selectedFileDetail.status} /> : <FileText size={13} className="text-[var(--text-3)]" />}
          {directory ? <span className="truncate text-[var(--text-3)]">{directory}</span> : null}
          <span className="truncate font-semibold text-[var(--text-1)]">{basename}</span>
          {selectedFileDetail?.originalPath ? <span className="truncate text-[11px] text-[var(--text-3)]">from {selectedFileDetail.originalPath}</span> : null}
        </div>
        <div className="flex shrink-0 items-center gap-3 text-[11px] text-[var(--text-3)]">
          <span>UTF-8</span>
          <button className="icon-btn h-7 w-7" type="button" onClick={onClose} title="Close file view" aria-label="Close file view">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="file-focus-toolbar">
        <div className="file-focus-toolbar-group justify-start">
          <button className="file-focus-outline" type="button" disabled title="Opening files in an external editor lands in a later milestone">
            <FilePen size={13} />
            <span>Edit in Working Directory</span>
          </button>
          {isWip && selectedFileDetail?.staged && selectedFileDetail.unstaged ? (
            <div className="segmented">
              <button type="button" data-active={selectedWipScope === 'unstaged'} onClick={() => onChangeWipScope(selectedFileDetail.path, 'unstaged')}>
                Worktree
              </button>
              <button type="button" data-active={selectedWipScope === 'staged'} onClick={() => onChangeWipScope(selectedFileDetail.path, 'staged')}>
                Staged
              </button>
            </div>
          ) : null}
        </div>

        <div className="file-focus-toolbar-group justify-center">
          <div className="segmented">
            <button type="button" disabled title="File view lands in a later milestone">
              File View
            </button>
            <button type="button" data-active>
              Diff View
            </button>
          </div>
        </div>

        <div className="file-focus-toolbar-group justify-end">
          <div className="segmented">
            <button type="button" data-active={diffStyle === 'unified'} onClick={() => onSetDiffStyle('unified')} title="Unified diff">
              <Rows3 size={12} />
            </button>
            <button type="button" data-active={diffStyle === 'split'} onClick={() => onSetDiffStyle('split')} title="Split diff">
              <Columns2 size={12} />
            </button>
          </div>
        </div>
      </div>

      <div className="file-focus-content">
        <div className="diff-shell diff-shell-main">
          {renderDiffContent({
            detail,
            isDetailLoading,
            detailErrorMessage,
            selectedFile,
            selectedFileDetail,
            diffStyle,
            diffOptions,
            diffQuery
          })}
        </div>
      </div>
    </section>
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
};

function renderDiffContent({
  detail,
  isDetailLoading,
  detailErrorMessage,
  selectedFile,
  selectedFileDetail,
  diffStyle,
  diffOptions,
  diffQuery
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

  if (diffQuery.data?.isBinary) {
    return <FileFocusMessage icon={<FilePen size={15} />} label="Binary file diff cannot be rendered as text." />;
  }

  if (diffQuery.data?.patch) {
    return (
      <PatchDiff
        key={`${diffQuery.data.mode}:${diffQuery.data.path}:${diffStyle}:${diffQuery.data.loadedAt}`}
        className="gg-diff gg-diff-main"
        patch={diffQuery.data.patch}
        options={diffOptions}
        disableWorkerPool
      />
    );
  }

  return <FileFocusMessage icon={<FilePen size={15} />} label="No textual diff for this selection." />;
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
  const graphStatus = graphFileStatus(status);

  if (graphStatus === 'modified') {
    return <Pencil size={12} className="shrink-0" style={{ color: FILE_STATUS_COLORS.modified }} />;
  }

  if (graphStatus === 'added') {
    return <Plus size={13} className="shrink-0" style={{ color: FILE_STATUS_COLORS.added }} />;
  }

  return <Minus size={13} className="shrink-0" style={{ color: FILE_STATUS_COLORS.deleted }} />;
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
