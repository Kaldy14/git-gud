import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileDiff } from '@pierre/diffs/react';
import { Eye, GitBranch, Loader2, Minus, Monitor, Pencil, Plus, Unplug, X } from 'lucide-react';

import { createDiffOptionsBase, type DiffStyle } from '@renderer/components/commit/fileDetailUtils';
import { FILE_STATUS_COLORS } from '@shared/graph';
import { normalizeDetailPanelWidth } from '@shared/workspace';
import type { DiffSyntaxTheme, GitFileChange, RemoteMachineRepository } from '@shared/types';

import { machineFileGroups, selectMachineFileDiff, type MachineFileSelection } from './machineFiles';

export type { MachineFileSelection } from './machineFiles';


/** Read-only details for another machine's working directory. Offers no stage, discard, or commit actions. */
export function MachineWipPanel({
  snapshot,
  width,
  selectedFile,
  onSelectFile
}: {
  snapshot: RemoteMachineRepository | undefined;
  width: number;
  selectedFile: MachineFileSelection | undefined;
  onSelectFile: (file: MachineFileSelection | undefined) => void;
}): ReactElement {
  const groups = useMemo(() => machineFileGroups(snapshot?.status?.files ?? []), [snapshot?.status?.files]);
  const branch = snapshot?.status?.branch;
  const currentBranch = snapshot?.branches.find((candidate) => candidate.current);

  return (
    <aside
      className="commit-detail-panel relative flex min-h-0 shrink-0 flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--bg-sidebar)]"
      style={{ width: normalizeDetailPanelWidth(width) }}
      aria-label="Other machine working directory"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3">
        <Monitor size={14} className="shrink-0 text-[var(--machine)]" aria-hidden="true" />
        <span className="truncate text-[13px] font-semibold text-[var(--text-1)]">{snapshot?.machine.name ?? 'Machine'}</span>
        <span className="truncate text-[12px] text-[var(--text-3)]">working directory</span>
        <span className="machine-badge ml-auto" title="git-gud only reads this machine; nothing here changes it.">
          <Eye size={11} aria-hidden="true" />
          Read-only
        </span>
      </div>

      {snapshot ? (
        <div className="border-b border-[var(--border)] px-3 py-2.5 text-[12px] leading-5">
          <div className="flex min-w-0 items-center gap-1.5 text-[var(--text-1)]">
            <GitBranch size={13} className="shrink-0 text-[var(--text-3)]" aria-hidden="true" />
            <span className="truncate font-medium">{branch?.isDetached ? `detached at ${branch.oid?.slice(0, 7) ?? '?'}` : branch?.head ?? 'unknown branch'}</span>
            {currentBranch && (currentBranch.ahead > 0 || currentBranch.behind > 0) ? (
              <span className="shrink-0 tabular-nums text-[var(--text-3)]">
                {currentBranch.ahead > 0 ? `↑${currentBranch.ahead}` : ''}{currentBranch.behind > 0 ? ` ↓${currentBranch.behind}` : ''}
              </span>
            ) : null}
          </div>
          <div className="truncate text-[var(--text-3)]" title={`${snapshot.machine.sshHost}:${snapshot.remotePath}`}>
            {snapshot.remotePath} · via {snapshot.machine.sshHost} · {snapshot.current ? 'checked' : 'last seen'} {formatTime(snapshot.checkedAt)}
          </div>
          {!snapshot.current ? (
            <div className="mt-1 flex items-start gap-1.5 text-[var(--text-2)]">
              <Unplug size={13} className="mt-0.5 shrink-0 text-[var(--machine)]" aria-hidden="true" />
              <span>Unreachable now. Showing the last snapshot. {snapshot.message}</span>
            </div>
          ) : snapshot.message ? (
            <div className="mt-1 text-[var(--text-2)]">{snapshot.message}</div>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {groups.map((group) => (
          <section key={group.label} aria-label={group.label}>
            <h3 className="px-1 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-3)]">
              {group.label} · {group.files.length}
            </h3>
            {group.files.map((file) => {
              const isSelected = selectedFile?.path === file.path && selectedFile.staged === group.staged && selectedFile.untracked === group.untracked;
              return (
                <MachineFileRow
                  key={file.path}
                  file={file}
                  isSelected={isSelected}
                  onSelect={() => onSelectFile(isSelected ? undefined : { path: file.path, originalPath: file.originalPath, staged: group.staged, untracked: group.untracked })}
                />
              );
            })}
          </section>
        ))}
        {snapshot && groups.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-[var(--text-3)]">No uncommitted changes.</p>
        ) : null}
      </div>

      <div className="flex items-start gap-2 border-t border-[var(--border)] px-3 py-2.5 text-[11.5px] leading-4 text-[var(--text-3)]">
        <Eye size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
        No stage or commit actions here. Click a file to see its diff.
      </div>
    </aside>
  );
}

function MachineFileRow({ file, isSelected, onSelect }: { file: GitFileChange; isSelected: boolean; onSelect: () => void }): ReactElement {
  const separatorIndex = file.path.lastIndexOf('/');
  const directory = separatorIndex === -1 ? '' : file.path.slice(0, separatorIndex);
  const basename = separatorIndex === -1 ? file.path : file.path.slice(separatorIndex + 1);

  return (
    <button
      type="button"
      className="flex h-8 w-full min-w-0 items-center gap-1.5 rounded px-2 text-left text-[13px] hover:bg-[var(--bg-hover)]"
      style={{ background: isSelected ? 'var(--select-bg)' : undefined }}
      aria-pressed={isSelected}
      title={file.path}
      onClick={onSelect}
    >
      <MachineFileStatusIcon file={file} />
      {directory ? <span className="min-w-0 truncate text-[var(--text-3)]">{directory}/</span> : null}
      <span className="max-w-[72%] shrink-0 truncate text-[var(--text-2)]">{basename}</span>
    </button>
  );
}

function MachineFileStatusIcon({ file }: { file: GitFileChange }): ReactElement {
  if (file.status === 'deleted') {
    return <Minus size={13} className="shrink-0" style={{ color: FILE_STATUS_COLORS.deleted }} aria-label="deleted" />;
  }
  if (file.status === 'added' || file.status === 'untracked' || file.status === 'copied') {
    return <Plus size={13} className="shrink-0" style={{ color: FILE_STATUS_COLORS.added }} aria-label="added" />;
  }
  return <Pencil size={12} className="shrink-0" style={{ color: FILE_STATUS_COLORS.modified }} aria-label="modified" />;
}

/** Diff of one file from another machine, fetched over SSH on demand. */
export function MachineFileDiffView({
  repoPath,
  machineId,
  machineName,
  file,
  diffStyle,
  diffSyntaxTheme,
  onClose
}: {
  repoPath: string;
  machineId: string;
  machineName: string;
  file: MachineFileSelection;
  diffStyle: DiffStyle;
  diffSyntaxTheme: DiffSyntaxTheme;
  onClose: () => void;
}): ReactElement {
  const diff = useQuery({
    queryKey: ['machine-file-diff', repoPath, machineId, file.path, file.staged, file.untracked, file.originalPath],
    queryFn: () => window.api.getMachineFileDiff(repoPath, { machineId, ...file }),
    retry: false,
    staleTime: 10_000
  });
  const options = useMemo(() => ({ ...createDiffOptionsBase(diffSyntaxTheme), diffStyle }), [diffStyle, diffSyntaxTheme]);
  const selectedDiff = useMemo(() => diff.data ? selectMachineFileDiff(diff.data, file.path) : undefined, [diff.data, file.path]);
  const scope = file.untracked ? 'untracked' : file.staged ? 'staged' : 'unstaged';

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-[var(--bg-app)]" aria-label={`${file.path} on ${machineName}`}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 text-[13px]">
        <Monitor size={14} className="shrink-0 text-[var(--machine)]" aria-hidden="true" />
        <span className="shrink-0 text-[var(--text-3)]">{machineName}</span>
        <span className="min-w-0 truncate font-medium text-[var(--text-1)]">{file.path}</span>
        <span className="badge-mini shrink-0">{scope}</span>
        <button className="icon-btn ml-auto" type="button" onClick={onClose} aria-label="Close diff" title="Close diff">
          <X size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {diff.isLoading ? (
          <p className="flex items-center justify-center gap-2 py-10 text-xs text-[var(--text-3)]">
            <Loader2 size={13} aria-hidden="true" /> Reading diff from {machineName}…
          </p>
        ) : diff.error ? (
          <p className="py-10 text-center text-xs text-[var(--danger-text)]">{diff.error instanceof Error ? diff.error.message : 'Could not read the diff.'}</p>
        ) : selectedDiff ? (
          <FileDiff className="gg-diff" fileDiff={selectedDiff} options={options} />
        ) : diff.data?.trim() ? (
          <p className="py-10 text-center text-xs text-[var(--danger-text)]">The remote diff did not include the selected file.</p>
        ) : (
          <p className="py-10 text-center text-xs text-[var(--text-3)]">No textual changes (binary file or mode change).</p>
        )}
      </div>
    </section>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
