import type { GitFileChange, RemoteMachineFileDiffRequest } from '@shared/types';

export type MachineFileSelection = Omit<RemoteMachineFileDiffRequest, 'machineId'>;

export type MachineFileGroup = { label: string; staged: boolean; untracked: boolean; files: GitFileChange[] };

export function machineFileGroups(files: readonly GitFileChange[]): MachineFileGroup[] {
  const visible = files.filter((file) => file.status !== 'ignored');
  return [
    { label: 'Conflicted', staged: false, untracked: false, files: visible.filter((file) => file.conflicted) },
    { label: 'Staged', staged: true, untracked: false, files: visible.filter((file) => file.staged) },
    { label: 'Unstaged', staged: false, untracked: false, files: visible.filter((file) => file.unstaged && file.status !== 'untracked') },
    { label: 'Untracked', staged: false, untracked: true, files: visible.filter((file) => file.status === 'untracked') }
  ].filter((group) => group.files.length > 0);
}
