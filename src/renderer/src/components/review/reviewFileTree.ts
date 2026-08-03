import type { GitStatusEntry } from '@pierre/trees';

import type { GitReviewChunk } from '@shared/types';

import type { VisibleReviewUnit } from './reviewFilters';

export type ReviewFileTreeEntry = GitStatusEntry & {
  path: string;
};

const REVIEW_FILE_TREE_STORAGE_PREFIX = 'git-gud:review-file-tree:v1:';
const REVIEW_FILE_TREE_WIDTH_STORAGE_PREFIX = 'git-gud:review-file-tree-width:v1:';

export const DEFAULT_REVIEW_FILE_TREE_WIDTH = 260;
export const MIN_REVIEW_FILE_TREE_WIDTH = 180;
export const MAX_REVIEW_FILE_TREE_WIDTH = 520;

export function createReviewFileTreeEntries(
  units: readonly VisibleReviewUnit[]
): ReviewFileTreeEntry[] {
  const entries = new Map<string, ReviewFileTreeEntry>();

  for (const unit of units) {
    for (const chunk of unit.visibleChunks) {
      if (!entries.has(chunk.path)) {
        entries.set(chunk.path, {
          path: chunk.path,
          status:
            chunk.originalPath && chunk.originalPath !== chunk.path
              ? 'renamed'
              : chunk.changeType
        });
      }
    }
  }

  return [...entries.values()];
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

export function normalizeReviewFileTreeWidth(width: number): number {
  return Math.min(
    MAX_REVIEW_FILE_TREE_WIDTH,
    Math.max(MIN_REVIEW_FILE_TREE_WIDTH, Math.round(width))
  );
}

export function loadReviewFileTreeWidth(
  storage: Pick<Storage, 'getItem'>,
  repoPath: string
): number {
  const storedWidth = storage.getItem(reviewFileTreeWidthStorageKey(repoPath));

  if (storedWidth === null) {
    return DEFAULT_REVIEW_FILE_TREE_WIDTH;
  }

  const width = Number(storedWidth);
  return Number.isFinite(width)
    ? normalizeReviewFileTreeWidth(width)
    : DEFAULT_REVIEW_FILE_TREE_WIDTH;
}

export function saveReviewFileTreeWidth(
  storage: Pick<Storage, 'setItem'>,
  repoPath: string,
  width: number
): void {
  storage.setItem(
    reviewFileTreeWidthStorageKey(repoPath),
    String(normalizeReviewFileTreeWidth(width))
  );
}

function reviewFileTreeStorageKey(repoPath: string): string {
  return `${REVIEW_FILE_TREE_STORAGE_PREFIX}${encodeURIComponent(repoPath)}`;
}

function reviewFileTreeWidthStorageKey(repoPath: string): string {
  return `${REVIEW_FILE_TREE_WIDTH_STORAGE_PREFIX}${encodeURIComponent(repoPath)}`;
}
