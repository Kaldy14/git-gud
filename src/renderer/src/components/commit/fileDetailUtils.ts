import type { FileDiffOptions } from '@pierre/diffs';

import { getDiffThemeName } from '@renderer/components/diff/diffTheme';
import type {
  CommitGraphRow,
  DiffSyntaxTheme,
  GitFileChangeDetail,
  GitFileDiffRequest,
  GitStatusCode
} from '@shared/types';

export type FileViewMode = 'path' | 'tree';
export type DiffStyle = 'unified' | 'split';
export type WipDiffScope = 'unstaged' | 'staged';
export type FileChangeIconKind = 'modified' | 'added' | 'deleted' | 'renamed';

export type FileStatusCounts = Record<'modified' | 'added' | 'deleted' | 'renamed' | 'conflicted', number>;
export type ChangedFileTreeNode =
  | {
      kind: 'directory';
      name: string;
      path: string;
      children: ChangedFileTreeNode[];
      counts: FileStatusCounts;
    }
  | {
      kind: 'file';
      name: string;
      path: string;
      file: GitFileChangeDetail;
    };

export const DIFF_OPTIONS_BASE = {
  themeType: 'dark',
  diffIndicators: 'bars',
  hunkSeparators: 'line-info',
  lineDiffType: 'word',
  overflow: 'wrap',
  stickyHeader: true
} satisfies FileDiffOptions<undefined>;

export function createDiffOptionsBase<LAnnotation = undefined>(
  theme: DiffSyntaxTheme
): FileDiffOptions<LAnnotation> {
  return {
    ...DIFF_OPTIONS_BASE,
    theme: getDiffThemeName(theme)
  };
}

export function findFile(files: GitFileChangeDetail[], selectedFile: string | undefined): GitFileChangeDetail | undefined {
  return selectedFile ? files.find((file) => file.path === selectedFile) : undefined;
}

export function findAdjacentFilePath(
  files: GitFileChangeDetail[],
  selectedFile: string | undefined,
  direction: -1 | 1
): string | undefined {
  if (files.length === 0) {
    return undefined;
  }

  const selectedIndex = selectedFile ? files.findIndex((file) => file.path === selectedFile) : -1;

  if (selectedIndex === -1) {
    return direction === 1 ? files[0]?.path : files[files.length - 1]?.path;
  }

  return files[selectedIndex + direction]?.path;
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
  scope: WipDiffScope,
  selectedShas: readonly string[] = []
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

  if (selectedShas.length > 1) {
    return {
      kind: 'selection',
      shas: [...selectedShas],
      path: file.path,
      originalPath: file.originalPath
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

export function buildChangedFileTree(files: GitFileChangeDetail[]): ChangedFileTreeNode[] {
  const root = createDirectoryBuilder('', '');

  for (const file of files) {
    const segments = file.path.split('/').filter(Boolean);

    if (segments.length === 0) {
      continue;
    }

    let parent = root;

    for (const [index, segment] of segments.entries()) {
      const path = segments.slice(0, index + 1).join('/');

      if (index === segments.length - 1) {
        parent.children.set(`file:${segment}`, {
          kind: 'file',
          name: segment,
          path,
          file
        });
        incrementTreeCounts(parent, file);
        continue;
      }

      const key = `directory:${segment}`;
      const existing = parent.children.get(key);
      const directory = existing?.kind === 'directory'
        ? existing
        : createDirectoryBuilder(segment, path);

      parent.children.set(key, directory);
      incrementTreeCounts(parent, file);
      parent = directory;
    }
  }

  return finalizeDirectoryChildren(root);
}

export function fileTreeAncestorPaths(path: string): string[] {
  const segments = path.split('/').filter(Boolean);
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'));
}

export function expandFileTreePathAncestors(paths: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(paths);

  for (const ancestor of fileTreeAncestorPaths(path)) {
    next.add(ancestor);
  }

  return next;
}

export function toggleFileTreePath(paths: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(paths);

  if (next.has(path)) {
    next.delete(path);
  } else {
    next.add(path);
  }

  return next;
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

export function fileChangeIconKind(status: GitStatusCode): FileChangeIconKind {
  if (status === 'added' || status === 'untracked') {
    return 'added';
  }

  if (status === 'deleted') {
    return 'deleted';
  }

  if (status === 'renamed' || status === 'copied') {
    return 'renamed';
  }

  return 'modified';
}

type DirectoryBuilder = {
  kind: 'directory';
  name: string;
  path: string;
  children: Map<string, DirectoryBuilder | ChangedFileTreeNode & { kind: 'file' }>;
  counts: FileStatusCounts;
};

function createDirectoryBuilder(name: string, path: string): DirectoryBuilder {
  return {
    kind: 'directory',
    name,
    path,
    children: new Map(),
    counts: { modified: 0, added: 0, deleted: 0, renamed: 0, conflicted: 0 }
  };
}

function incrementTreeCounts(directory: DirectoryBuilder, file: GitFileChangeDetail): void {
  if (file.conflicted || file.status === 'conflicted') {
    directory.counts.conflicted += 1;
    return;
  }

  if (file.status === 'renamed' || file.status === 'copied') {
    directory.counts.renamed += 1;
    return;
  }

  directory.counts[graphFileStatus(file.status)] += 1;
}

function finalizeDirectoryChildren(directory: DirectoryBuilder): ChangedFileTreeNode[] {
  return [...directory.children.values()]
    .map((node): ChangedFileTreeNode => {
      if (node.kind === 'file') {
        return node;
      }

      return {
        kind: 'directory',
        name: node.name,
        path: node.path,
        counts: node.counts,
        children: finalizeDirectoryChildren(node)
      };
    })
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === 'directory' ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });
}
