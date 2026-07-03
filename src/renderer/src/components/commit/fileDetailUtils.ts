import type { FileDiffOptions } from '@pierre/diffs';
import type { GitStatusEntry } from '@pierre/trees';

import type { CommitGraphRow, GitFileChangeDetail, GitFileDiffRequest, GitStatusCode } from '@shared/types';

export type FileViewMode = 'path' | 'tree';
export type DiffStyle = 'unified' | 'split';
export type WipDiffScope = 'unstaged' | 'staged';

export type FileStatusCounts = Record<'modified' | 'added' | 'deleted' | 'renamed' | 'conflicted', number>;

export const DIFF_OPTIONS_BASE = {
  themeType: 'dark',
  diffIndicators: 'bars',
  hunkSeparators: 'line-info',
  lineDiffType: 'word',
  overflow: 'wrap',
  stickyHeader: true
} satisfies FileDiffOptions<undefined>;

export function findFile(files: GitFileChangeDetail[], selectedFile: string | undefined): GitFileChangeDetail | undefined {
  return selectedFile ? files.find((file) => file.path === selectedFile) : undefined;
}

export function selectWipScope(file: GitFileChangeDetail, storedScope: WipDiffScope | undefined): WipDiffScope {
  if (file.staged && !file.unstaged) {
    return 'staged';
  }

  if (file.unstaged && !file.staged) {
    return 'unstaged';
  }

  return storedScope ?? 'unstaged';
}

export function createDiffRequest(
  row: CommitGraphRow | undefined,
  file: GitFileChangeDetail | undefined,
  scope: WipDiffScope
): GitFileDiffRequest | undefined {
  if (!row || !file) {
    return undefined;
  }

  if (row.node.kind === 'wip') {
    return {
      kind: 'wip',
      path: file.path,
      staged: scope === 'staged'
    };
  }

  return {
    kind: 'commit',
    sha: row.sha,
    path: file.path,
    originalPath: file.originalPath
  };
}

export function countByStatus(files: GitFileChangeDetail[]): FileStatusCounts {
  const counts: FileStatusCounts = { modified: 0, added: 0, deleted: 0, renamed: 0, conflicted: 0 };

  for (const file of files) {
    if (file.conflicted || file.status === 'conflicted') {
      counts.conflicted += 1;
      continue;
    }

    if (file.status === 'renamed' || file.status === 'copied') {
      counts.renamed += 1;
      continue;
    }

    counts[graphFileStatus(file.status)] += 1;
  }

  return counts;
}

export function graphFileStatus(status: GitStatusCode): 'modified' | 'added' | 'deleted' {
  if (status === 'added' || status === 'untracked' || status === 'copied') {
    return 'added';
  }

  if (status === 'deleted') {
    return 'deleted';
  }

  return 'modified';
}

export function treeStatus(status: GitStatusCode): GitStatusEntry['status'] {
  if (status === 'added' || status === 'untracked' || status === 'copied') {
    return status === 'untracked' ? 'untracked' : 'added';
  }

  if (status === 'deleted') {
    return 'deleted';
  }

  if (status === 'renamed') {
    return 'renamed';
  }

  if (status === 'ignored') {
    return 'ignored';
  }

  return 'modified';
}

export function treeHeight(fileCount: number): number {
  return Math.min(280, Math.max(120, fileCount * 28 + 28));
}
