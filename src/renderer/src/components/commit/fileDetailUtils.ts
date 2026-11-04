import type { FileDiffOptions } from '@pierre/diffs';

import { getDiffThemeName } from '@renderer/components/diff/diffTheme';
import {
  createWhitespaceOnlyDiffPostRender,
  WHITESPACE_ONLY_DIFF_CSS
} from '@renderer/components/diff/whitespaceDiff';
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

const DIFF_SEPARATOR_CSS = `
  [data-separator="line-info"] {
    height: 1lh;
    margin-block: 0;
  }

  [data-separator="line-info"] [data-separator-content] {
    color: var(--text-3);
    font-family: var(--diffs-header-font-family);
    font-size: 11px;
  }

  [data-separator="line-info"] [data-expand-button] {
    color: var(--text-2);
  }

  [data-separator="line-info"] [data-expand-button]:hover {
    color: var(--text-1);
  }
`;

// Keep selected code readable across syntax themes. The edge carries selection;
// one foreground overrides the syntax renderer's inline token colours only while selected.
const DIFF_SELECTION_CSS = `
  [data-line][data-selected-line] {
    --mix-selection-dark: 100%;
    --mix-selection-light: 100%;
  }
  [data-column-number][data-selected-line] {
    box-shadow: inset -2px 0 var(--accent-2);
  }
  [data-line][data-selected-line] span {
    color: var(--diffs-fg) !important;
  }
`;

export const DIFF_OPTIONS_BASE = {
  themeType: 'dark',
  diffIndicators: 'classic',
  hunkSeparators: 'line-info',
  lineDiffType: 'char',
  overflow: 'wrap',
  stickyHeader: true,
  unsafeCSS: `${WHITESPACE_ONLY_DIFF_CSS}\n${DIFF_SEPARATOR_CSS}\n${DIFF_SELECTION_CSS}`
} satisfies FileDiffOptions<undefined>;

export function createDiffOptionsBase<LAnnotation = undefined>(
  theme: DiffSyntaxTheme
): FileDiffOptions<LAnnotation> {
  return {
    ...DIFF_OPTIONS_BASE,
    theme: getDiffThemeName(theme),
    onPostRender: createWhitespaceOnlyDiffPostRender<LAnnotation>()
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

export type WipFilePlacement = 'conflict' | 'unstaged' | 'staged';

export type WipFileGroups = Record<WipFilePlacement, GitFileChangeDetail[]>;

// Partially staged files appear in both groups; entries keep their original objects so callbacks see true flags.
export function groupWipFiles(files: GitFileChangeDetail[]): WipFileGroups {
  return {
    conflict: files.filter((file) => file.conflicted),
    unstaged: files.filter((file) => file.unstaged && !file.conflicted),
    staged: files.filter((file) => file.staged && !file.conflicted)
  };
}

export function conflictedFolderPaths(files: GitFileChangeDetail[]): Set<string> {
  return new Set(files.filter((file) => file.conflicted).flatMap((file) => fileTreeAncestorPaths(file.path)));
}

export type FolderStagingActions = {
  canStage: boolean;
  canUnstage: boolean;
  hasConflicts: boolean;
  primary?: 'stage' | 'unstage';
};

// Folder staging runs one pathspec over every descendant, so conflicted files only block it rather than count as work.
// Grouped trees render only part of a folder, so callers pass conflicts from the full folder via `conflictedFolders`.
export function folderStagingActions(
  node: ChangedFileTreeNode & { kind: 'directory' },
  { placement, conflictedFolders }: { placement?: WipFilePlacement; conflictedFolders?: ReadonlySet<string> } = {}
): FolderStagingActions {
  let canStage = false;
  let canUnstage = false;
  let hasConflicts = conflictedFolders?.has(node.path) ?? false;
  const pending: ChangedFileTreeNode[] = [...node.children];

  for (let child = pending.pop(); child; child = pending.pop()) {
    if (child.kind === 'directory') {
      pending.push(...child.children);
      continue;
    }

    if (child.file.conflicted) {
      hasConflicts = true;
      continue;
    }

    canStage ||= child.file.unstaged;
    canUnstage ||= child.file.staged;
  }

  if (placement) {
    canStage &&= placement === 'unstaged';
    canUnstage &&= placement === 'staged';
  }

  return {
    canStage,
    canUnstage,
    hasConflicts,
    primary: canStage ? 'stage' : canUnstage ? 'unstage' : undefined
  };
}

export function splitPath(path: string): { directory: string; basename: string } {
  const separatorIndex = path.lastIndexOf('/');

  if (separatorIndex === -1) {
    return { directory: '', basename: path };
  }

  return {
    directory: path.slice(0, separatorIndex + 1),
    basename: path.slice(separatorIndex + 1)
  };
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

const LIST_ITEM_PATTERN = /^\s*(?:[-*+]|\d+[.)])\s/;
const FENCE_PATTERN = /^\s*(?:```|~~~)/;
const TRAILER_PATTERN = /^[A-Za-z][\w-]*: \S/;
const VERBATIM_LINE_PATTERN = /^(?: {4}|\t|\s*[>#|])/;

/**
 * Removes the 72-column hard wraps of a commit body so prose wraps to the panel once.
 * Paragraph breaks, list items, code, quotes, and trailer blocks keep their line structure.
 */
export function reflowCommitBody(body: string): string {
  const output: string[] = [];
  let isInFence = false;
  let canContinue = false;
  let isInListItem = false;

  for (const line of body.split('\n')) {
    if (FENCE_PATTERN.test(line)) {
      isInFence = !isInFence;
      canContinue = false;
      output.push(line);
      continue;
    }

    const isBlank = line.trim().length === 0;
    const isListItem = LIST_ITEM_PATTERN.test(line);
    const isListContinuation: boolean = isInListItem && /^\s+\S/.test(line) && !isListItem;
    const isStructural = isInFence || isBlank || isListItem || TRAILER_PATTERN.test(line) ||
      (VERBATIM_LINE_PATTERN.test(line) && !isListContinuation);

    if (canContinue && !isStructural) {
      output[output.length - 1] = `${output.at(-1)} ${line.trim()}`;
    } else {
      output.push(line);
    }

    isInListItem = !isBlank && !isInFence && (isListItem || isListContinuation);
    canContinue = !isInFence && !isBlank && (!isStructural || isListItem) && !line.trimEnd().endsWith(':');
  }

  return output.join('\n');
}
