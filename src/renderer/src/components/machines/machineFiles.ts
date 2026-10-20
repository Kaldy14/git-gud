import type { GitFileChange, RemoteMachineFileDiffRequest } from '@shared/types';
import { parsePatchFiles } from '@pierre/diffs';

export type MachineFileSelection = Omit<RemoteMachineFileDiffRequest, 'machineId'>;

export type MachineFileGroup = { label: string; staged: boolean; untracked: boolean; files: GitFileChange[] };

/** Including a rename/copy source can also return its own patch. Show only the selected destination. */
export function selectMachineFileDiff(patch: string, path: string) {
  for (const file of parsePatchFiles(patch).flatMap((entry) => entry.files)) {
    const name = decodePatchPath(file.name);
    if (name === path) return { ...file, name, ...(file.prevName ? { prevName: decodePatchPath(file.prevName) } : {}) };
  }
}

/** The patch parser retains Git's C escapes and sometimes the surrounding quotes. */
function decodePatchPath(value: string): string {
  const unquoted = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
  return unquoted.replace(/(?:\\[0-7]{3})+|\\[abfnrtv"\\]/g, (escape) => {
    if (/^\\[0-7]/.test(escape)) {
      const bytes = Uint8Array.from(escape.split('\\').slice(1), (octal) => Number.parseInt(octal, 8));
      return new TextDecoder().decode(bytes);
    }
    switch (escape) {
      case '\\a': return '\x07';
      case '\\b': return '\b';
      case '\\f': return '\f';
      case '\\n': return '\n';
      case '\\r': return '\r';
      case '\\t': return '\t';
      case '\\v': return '\v';
      default: return escape.slice(1);
    }
  });
}

export function machineFileGroups(files: readonly GitFileChange[]): MachineFileGroup[] {
  const visible = files.filter((file) => file.status !== 'ignored');
  return [
    { label: 'Conflicted', staged: false, untracked: false, files: visible.filter((file) => file.conflicted) },
    { label: 'Staged', staged: true, untracked: false, files: visible.filter((file) => file.staged) },
    { label: 'Unstaged', staged: false, untracked: false, files: visible.filter((file) => file.unstaged && file.status !== 'untracked') },
    { label: 'Untracked', staged: false, untracked: true, files: visible.filter((file) => file.status === 'untracked') }
  ].filter((group) => group.files.length > 0);
}
