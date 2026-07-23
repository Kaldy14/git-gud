import type { GitStatusEntry } from '@pierre/trees';

import type { VisibleReviewUnit } from './reviewFilters';

export type ReviewFileTreeEntry = GitStatusEntry & {
  path: string;
};

const REVIEW_FILE_TREE_STORAGE_PREFIX = 'git-gud:review-file-tree:v1:';

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
