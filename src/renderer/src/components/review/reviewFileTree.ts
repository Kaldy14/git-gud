import type { GitStatusEntry } from '@pierre/trees';

import type { GitReviewChunk } from '@shared/types';

import type { VisibleReviewUnit } from './reviewFilters';

export type ReviewFileTreeEntry = GitStatusEntry & {
  path: string;
};

const REVIEW_FILE_TREE_STORAGE_PREFIX = 'git-gud:review-file-tree:v1:';

export function createReviewFileTreeEntries(
  units: readonly VisibleReviewUnit[]
): ReviewFileTreeEntry[] {
  const chunksByPath = new Map<string, GitReviewChunk[]>();

  for (const unit of units) {
    for (const chunk of unit.visibleChunks) {
      const chunks = chunksByPath.get(chunk.path) ?? [];
      chunks.push(chunk);
      chunksByPath.set(chunk.path, chunks);
    }
  }

  const visible = [...chunksByPath].map(([path, chunks]) => ({
    path,
    status: reviewFileTreeStatus(chunks)
  }));
  // Files the filters hide stay in the tree, dimmed, so coverage gaps are visible.
  const hidden = [...new Set(units.flatMap((unit) => (unit.skippedChunks ?? []).map((chunk) => chunk.path)))]
    .filter((path) => !chunksByPath.has(path))
    .map((path) => ({ path, status: 'ignored' as const }));
  return [...visible, ...hidden];
}

function reviewFileTreeStatus(
  chunks: readonly GitReviewChunk[]
): ReviewFileTreeEntry['status'] {
  if (chunks.some((chunk) => chunk.originalPath && chunk.originalPath !== chunk.path)) {
    return 'renamed';
  }

  const fileStatuses = new Set(
    chunks.flatMap((chunk) => {
      switch (chunk.fileStatus) {
        case 'added':
        case 'deleted':
        case 'ignored':
        case 'modified':
        case 'renamed':
          return [chunk.fileStatus];
        case 'untracked':
          return ['added' as const];
        case 'conflicted':
        case 'copied':
        case 'unmodified':
          return ['modified' as const];
        default:
          return [];
      }
    })
  );

  if (fileStatuses.size === 1) {
    return [...fileStatuses][0]!;
  }

  if (fileStatuses.size > 1) {
    return 'modified';
  }

  const chunkTypes = new Set(chunks.map((chunk) => chunk.changeType));
  return chunkTypes.size === 1 ? [...chunkTypes][0]! : 'modified';
}

export function findReviewUnitIdForPath(
  units: readonly VisibleReviewUnit[],
  path: string
): string | undefined {
  return units.find((unit) =>
    unit.visibleChunks.some((chunk) => chunk.path === path)
  )?.unit.id;
}

export function findAdjacentReviewFilePath(
  chunks: readonly GitReviewChunk[],
  selectedPath: string | undefined,
  direction: -1 | 1
): string | undefined {
  const paths = [...new Set(chunks.map((chunk) => chunk.path))];

  if (paths.length === 0) {
    return undefined;
  }

  const selectedIndex = selectedPath ? paths.indexOf(selectedPath) : -1;

  if (selectedIndex === -1) {
    return direction === 1 ? paths[0] : paths[paths.length - 1];
  }

  return paths[selectedIndex + direction];
}

export function loadReviewFileTreeOpen(
  storage: Pick<Storage, 'getItem'>,
  repoPath: string
): boolean {
  return storage.getItem(reviewFileTreeStorageKey(repoPath)) !== 'false';
}

export function saveReviewFileTreeOpen(
  storage: Pick<Storage, 'setItem'>,
  repoPath: string,
  isOpen: boolean
): void {
  storage.setItem(reviewFileTreeStorageKey(repoPath), String(isOpen));
}

function reviewFileTreeStorageKey(repoPath: string): string {
  return `${REVIEW_FILE_TREE_STORAGE_PREFIX}${encodeURIComponent(repoPath)}`;
}
