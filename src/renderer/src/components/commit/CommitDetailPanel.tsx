import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { FilePen, FolderClosed, FolderTree, List, Minus, Pencil, Plus } from 'lucide-react';

import type { CommitGraphRow, GraphFile, GraphFileStatus } from '@shared/types';

type CommitDetailPanelProps = {
  row?: CommitGraphRow;
  parentSha?: string;
};

export function CommitDetailPanel({ row, parentSha }: CommitDetailPanelProps): ReactElement {
  const [fileView, setFileView] = useState<'path' | 'tree'>('path');
  const [selectedFile, setSelectedFile] = useState<string>();

  if (!row) {
    return (
      <aside className="flex w-[380px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-panel)]">
        <div className="grid flex-1 place-items-center px-8 text-center text-xs leading-5 text-[var(--text-3)]">
          Select a commit in the graph to inspect it.
        </div>
      </aside>
    );
  }

  const isWip = row.node.kind === 'wip';
  const counts = countByStatus(row.files);

  return (
    <aside className="flex w-[380px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--bg-panel)]">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 text-xs text-[var(--text-2)]">
        <FilePen size={13} className="text-[var(--text-3)]" />
        {isWip ? (
          <span className="font-medium">Work in progress</span>
        ) : (
          <span>
            commit: <span className="mono text-[var(--text-1)]">{row.sha}</span>
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-[var(--border)] px-4 py-3.5">
          <h2 className={isWip ? 'text-[15px] font-semibold italic text-[var(--text-2)]' : 'text-[15px] font-semibold leading-snug text-[var(--text-1)]'}>
            {row.subject}
          </h2>
          {row.body ? <p className="mt-2 text-xs leading-5 text-[var(--text-2)]">{row.body}</p> : null}
        </div>

        {!isWip ? (
          <div className="space-y-3 border-b border-[var(--border)] px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold text-[#0b0f14]"
                  style={{ background: row.author.color }}
                >
                  {row.author.initials}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-[var(--text-1)]">{row.author.name}</p>
                  <p className="text-[11px] text-[var(--text-3)]">authored {row.dateLabel}</p>
                </div>
              </div>
              {parentSha ? (
                <p className="shrink-0 pt-1 text-[11px] text-[var(--text-3)]">
                  parent: <span className="mono">{parentSha}</span>
                </p>
              ) : null}
            </div>
            <p className="pl-[42px] text-[11px] text-[var(--text-3)]">committed {row.dateLabel}</p>
          </div>
        ) : (
          <div className="border-b border-[var(--border)] px-4 py-3.5">
            <textarea
              className="h-16 w-full resize-none rounded-md border border-[var(--border)] bg-[var(--bg-field)] px-2.5 py-2 text-xs text-[var(--text-1)] placeholder-[var(--text-3)] outline-none transition focus:border-[var(--border-strong)]"
              placeholder="Commit summary"
            />
            <button className="btn-accent mt-2.5 h-8 w-full text-xs" type="button" disabled title="Committing lands in M3">
              Commit changes to main
            </button>
          </div>
        )}

        <div className="flex items-center justify-between px-4 pb-1.5 pt-3">
          <div className="flex items-center gap-3 text-xs">
            {counts.modified > 0 ? (
              <span className="flex items-center gap-1.5 text-[#f0b35f]">
                <Pencil size={12} />
                {counts.modified} modified
              </span>
            ) : null}
            {counts.added > 0 ? (
              <span className="flex items-center gap-1.5 text-[#4cc38a]">
                <Plus size={13} />
                {counts.added} added
              </span>
            ) : null}
            {counts.deleted > 0 ? (
              <span className="flex items-center gap-1.5 text-[#ef6a6a]">
                <Minus size={13} />
                {counts.deleted} deleted
              </span>
            ) : null}
          </div>
          <div className="segmented">
            <button type="button" data-active={fileView === 'path'} onClick={() => setFileView('path')}>
              <List size={12} />
              Path
            </button>
            <button type="button" data-active={fileView === 'tree'} onClick={() => setFileView('tree')}>
              <FolderTree size={12} />
              Tree
            </button>
          </div>
        </div>

        <div className="px-2 pb-4 pt-1">
          {fileView === 'path' ? (
            row.files.length > 0 ? (
              row.files.map((file) => (
                <FileRow
                  key={file.path}
                  file={file}
                  isSelected={selectedFile === file.path}
                  onSelect={() => setSelectedFile(file.path)}
                />
              ))
            ) : (
              <EmptyFiles />
            )
          ) : (
            row.files.length > 0 ? (
              <FileTreeView files={row.files} selectedFile={selectedFile} onSelectFile={setSelectedFile} />
            ) : (
              <EmptyFiles />
            )
          )}
        </div>
      </div>
    </aside>
  );
}

function countByStatus(files: GraphFile[]): Record<GraphFileStatus, number> {
  const counts: Record<GraphFileStatus, number> = { modified: 0, added: 0, deleted: 0 };

  for (const file of files) {
    counts[file.status] += 1;
  }

  return counts;
}

function StatusIcon({ status }: { status: GraphFileStatus }): ReactElement {
  if (status === 'modified') {
    return <Pencil size={12} className="shrink-0 text-[#f0b35f]" />;
  }

  if (status === 'added') {
    return <Plus size={13} className="shrink-0 text-[#4cc38a]" />;
  }

  return <Minus size={13} className="shrink-0 text-[#ef6a6a]" />;
}

type FileRowProps = {
  file: GraphFile;
  isSelected: boolean;
  onSelect: () => void;
  indent?: boolean;
  hideDirectory?: boolean;
};

function FileRow({ file, isSelected, onSelect, indent = false, hideDirectory = false }: FileRowProps): ReactElement {
  const separatorIndex = file.path.lastIndexOf('/');
  const directory = separatorIndex === -1 ? '' : file.path.slice(0, separatorIndex + 1);
  const basename = separatorIndex === -1 ? file.path : file.path.slice(separatorIndex + 1);

  return (
    <button
      className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs transition hover:bg-[var(--bg-hover)]"
      style={{
        paddingLeft: indent ? 26 : undefined,
        background: isSelected ? 'var(--select-bg)' : undefined
      }}
      type="button"
      title={file.path}
      onClick={onSelect}
    >
      <StatusIcon status={file.status} />
      {!hideDirectory && directory ? <span className="min-w-0 truncate text-[var(--text-3)]">{directory}</span> : null}
      <span className="shrink-0 text-[var(--text-2)]">{basename}</span>
    </button>
  );
}

type FileTreeViewProps = {
  files: GraphFile[];
  selectedFile?: string;
  onSelectFile: (path: string) => void;
};

function FileTreeView({ files, selectedFile, onSelectFile }: FileTreeViewProps): ReactElement {
  const groups = useMemo(() => {
    const byDirectory = new Map<string, GraphFile[]>();

    for (const file of files) {
      const separatorIndex = file.path.lastIndexOf('/');
      const directory = separatorIndex === -1 ? '' : file.path.slice(0, separatorIndex);
      const bucket = byDirectory.get(directory) ?? [];
      bucket.push(file);
      byDirectory.set(directory, bucket);
    }

    return [...byDirectory.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [files]);

  return (
    <div>
      {groups.map(([directory, groupFiles]) => (
        <div key={directory || '(root)'}>
          {directory ? (
            <div className="flex h-6.5 items-center gap-2 px-2 text-[11px] text-[var(--text-3)]">
              <FolderClosed size={12} className="shrink-0" />
              <span className="min-w-0 truncate">{directory}</span>
            </div>
          ) : null}
          {groupFiles.map((file) => (
            <FileRow
              key={file.path}
              file={file}
              isSelected={selectedFile === file.path}
              onSelect={() => onSelectFile(file.path)}
              indent={Boolean(directory)}
              hideDirectory
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function EmptyFiles(): ReactElement {
  return (
    <div className="px-2 py-3 text-xs text-[var(--text-3)]">
      No files to display.
    </div>
  );
}
