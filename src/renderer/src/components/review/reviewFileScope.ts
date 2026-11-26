import type { GitReviewChunk, GitReviewUnit } from '@shared/types';

/** One changed file of a pull-request review, with every hunk the current scope shows for it. */
export type ReviewScopeFile = {
  key: string;
  path: string;
  /** Hunks in file order. Chunk ids are the plan's, so viewed state, drafts and continuity still apply. */
  chunks: GitReviewChunk[];
  additions: number;
  deletions: number;
  status: ReviewFileStatus;
  viewed: boolean;
  /** Every hunk is hidden by the Show filters or the since-last-review scope; listed dimmed, never stacked. */
  hidden: boolean;
  /** Hunks of a file that shows which the filters or scope hide; revealing the file shows them too. */
  filteredChunks: GitReviewChunk[];
};

export type ReviewFileStatus = 'added' | 'deleted' | 'renamed' | 'modified';

export type ReviewFileScopeInput = {
  units: readonly GitReviewUnit[];
  /** Chunk ids the filters and continuity leave visible. */
  visibleChunkIds: ReadonlySet<string>;
  reviewedChunkIds: ReadonlySet<string>;
  /** Exactly these files in this order, ignoring filters. Without it: every file in tree order. */
  paths?: readonly string[];
};

/**
 * Presents a review plan as files. A file's hunks are spread over several grouping units; they are
 * merged and ordered by line. Without `paths` hidden files stay in the list (flagged) so the tree can
 * show them dimmed; with `paths` filters never hide a requested file.
 */
export function createReviewFileScope({ units, visibleChunkIds, reviewedChunkIds, paths }: ReviewFileScopeInput): ReviewScopeFile[] {
  const chunksByPath = new Map<string, GitReviewChunk[]>();
  for (const unit of units) {
    for (const chunk of unit.chunks) {
      const chunks = chunksByPath.get(chunk.path);
      if (chunks) chunks.push(chunk);
      else chunksByPath.set(chunk.path, [chunk]);
    }
  }

  const order = paths
    ? [...new Set(paths)].filter((path) => chunksByPath.has(path))
    : [...chunksByPath.keys()].sort(compareReviewTreePaths);

  return order.map((path) => {
    const all = chunksByPath.get(path)!;
    const visible = paths ? all : all.filter((chunk) => visibleChunkIds.has(chunk.id));
    const hidden = visible.length === 0;
    // A hidden file keeps its hunks so revealing it needs no second lookup.
    const chunks = [...(hidden ? all : visible)].sort((a, b) => a.startLine - b.startLine);
    return {
      key: path,
      path,
      chunks,
      additions: chunks.reduce((sum, chunk) => sum + chunk.additions, 0),
      deletions: chunks.reduce((sum, chunk) => sum + chunk.deletions, 0),
      status: reviewFileStatus(all),
      viewed: !hidden && chunks.every((chunk) => reviewedChunkIds.has(chunk.id)),
      hidden,
      filteredChunks: hidden ? [] : all.filter((chunk) => !visible.includes(chunk))
    };
  });
}

/** File-tree order: at each level directories come before files, then natural name order. */
export function compareReviewTreePaths(left: string, right: string): number {
  const a = left.split('/');
  const b = right.split('/');
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] === b[index]) continue;
    const aIsFile = index === a.length - 1;
    const bIsFile = index === b.length - 1;
    if (aIsFile !== bIsFile) return aIsFile ? 1 : -1;
    return a[index]!.localeCompare(b[index]!, undefined, { numeric: true, sensitivity: 'base' }) ||
      (a[index]! < b[index]! ? -1 : 1);
  }
  return a.length - b.length;
}

function reviewFileStatus(chunks: readonly GitReviewChunk[]): ReviewFileStatus {
  if (chunks.some((chunk) => chunk.originalPath && chunk.originalPath !== chunk.path)) return 'renamed';
  const status = chunks.find((chunk) => chunk.fileStatus)?.fileStatus;
  if (status === 'added' || status === 'untracked') return 'added';
  if (status === 'deleted') return 'deleted';
  if (status === 'renamed') return 'renamed';
  if (status) return 'modified';
  const types = new Set(chunks.map((chunk) => chunk.changeType));
  return types.size === 1 && !types.has('modified') ? [...types][0] as 'added' | 'deleted' : 'modified';
}

export type ReviewTreeNode =
  | { kind: 'directory'; id: string; name: string; depth: number; children: ReviewTreeNode[] }
  | { kind: 'file'; id: string; name: string; depth: number; file: ReviewScopeFile };

/**
 * Builds the files panel tree in the scope's order. Directory chains with a single child directory
 * and no files are compressed into one row (`src/renderer/src`), as the previous tree did.
 */
export function buildReviewFileTree(files: readonly ReviewScopeFile[]): ReviewTreeNode[] {
  type Draft = { name: string; path: string; directories: Map<string, Draft>; entries: Array<Draft | ReviewScopeFile> };
  const root: Draft = { name: '', path: '', directories: new Map(), entries: [] };
  for (const file of files) {
    const segments = file.path.split('/');
    let directory = root;
    for (const segment of segments.slice(0, -1)) {
      let child = directory.directories.get(segment);
      if (!child) {
        child = { name: segment, path: directory.path ? `${directory.path}/${segment}` : segment, directories: new Map(), entries: [] };
        directory.directories.set(segment, child);
        directory.entries.push(child);
      }
      directory = child;
    }
    directory.entries.push(file);
  }

  const toNodes = (directory: Draft, depth: number): ReviewTreeNode[] => directory.entries.map((entry) => {
    if (!('directories' in entry)) {
      return { kind: 'file', id: entry.path, name: entry.path.split('/').pop()!, depth, file: entry };
    }
    let draft = entry;
    let name = entry.name;
    while (draft.entries.length === 1 && 'directories' in draft.entries[0]!) {
      draft = draft.entries[0] as Draft;
      name = `${name}/${draft.name}`;
    }
    return { kind: 'directory', id: `dir:${draft.path}`, name, depth, children: toNodes(draft, depth + 1) };
  });
  return toNodes(root, 0);
}

/** Files whose path contains every whitespace-separated term, ignoring case. */
export function filterReviewFiles(files: readonly ReviewScopeFile[], query: string): readonly ReviewScopeFile[] {
  const terms = query.toLowerCase().split(/\s+/u).filter(Boolean);
  if (terms.length === 0) return files;
  return files.filter((file) => {
    const path = file.path.toLowerCase();
    return terms.every((term) => path.includes(term));
  });
}

/** Rows a tree shows with the given directories collapsed, in display order. */
export function visibleReviewTreeRows(nodes: readonly ReviewTreeNode[], collapsed: ReadonlySet<string>): ReviewTreeNode[] {
  return nodes.flatMap((node) => node.kind === 'directory' && !collapsed.has(node.id)
    ? [node, ...visibleReviewTreeRows(node.children, collapsed)]
    : [node]);
}

/** Rough height of a hunk before its diff mounts, so the scrollbar and "File N of M" stay stable. */
export function estimateReviewChunkHeight(chunk: Pick<GitReviewChunk, 'patch' | 'omittedReason'>, lineHeight = 20, chrome = 30): number {
  if (chunk.omittedReason) return 112;
  let rows = 0;
  let inHunk = false;
  for (const line of chunk.patch.split('\n')) {
    if (line.startsWith('@@')) inHunk = true;
    else if (inHunk && line.length > 0 && line[0] !== '\\') rows += 1;
  }
  return rows * lineHeight + chrome;
}

/**
 * Size rules for the pull-request layout's left panel. The files panel and a caller's side panel (the Tour
 * narrative) share the limits but each remembers its own width, so a narrow tree never squeezes the Tour.
 */
export function reviewPanelSize(repoPath: string, panel: 'files' | 'side') {
  const repo = encodeURIComponent(repoPath);
  return {
    storageKey: panel === 'files' ? `git-gud:review-files-panel-width:v1:${repo}` : `git-gud:review-side-panel-width:v1:${repo}`,
    defaultWidth: panel === 'files' ? 300 : 340,
    expandedWidth: 440,
    minWidth: 220,
    maxWidth: 560,
    minRemainingWidth: 480,
    edge: 'right'
  } as const;
}
