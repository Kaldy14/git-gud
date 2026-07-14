import type { CommitGraphRow } from '@shared/types';

export type CommitSearchIndexEntry = {
  row: CommitGraphRow;
  searchableText: string;
};

export function buildCommitSearchIndex(rows: readonly CommitGraphRow[]): CommitSearchIndexEntry[] {
  return rows.flatMap((row) =>
    row.node.kind === 'wip'
      ? []
      : [
          {
            row,
            searchableText: normalizeCommitSearchText([row.sha, row.subject, row.body ?? ''].join('\n'))
          }
        ]
  );
}

export function findCommitSearchMatches(index: readonly CommitSearchIndexEntry[], query: string): CommitGraphRow[] {
  const normalizedQuery = normalizeCommitSearchText(query);

  if (!normalizedQuery) {
    return [];
  }

  return index.filter((entry) => entry.searchableText.includes(normalizedQuery)).map((entry) => entry.row);
}

function normalizeCommitSearchText(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}
