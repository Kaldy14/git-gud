import { describe, expect, it } from 'vitest';

import type { CommitGraphRow } from '@shared/types';

import { buildCommitSearchIndex, findCommitSearchMatches } from './commitSearch';

const rows: CommitGraphRow[] = [
  commit('20ba435977e1aaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'ITE-470: Add kiosk welcome banner', 'Adds brand-country kiosk welcome\ncopy.'),
  commit('b'.repeat(40), 'NO_TASK: Organize administration menu', 'Reorders navigation groups.'),
  commit('wip', '// WIP', undefined, 'wip')
];
const index = buildCommitSearchIndex(rows);

describe('commit graph search', () => {
  it('matches abbreviated SHAs without case sensitivity', () => {
    expect(findCommitSearchMatches(index, '20BA4359').map((row) => row.sha)).toEqual([rows[0]?.sha]);
  });

  it('matches commit subjects and body descriptions', () => {
    expect(findCommitSearchMatches(index, 'WELCOME BANNER').map((row) => row.sha)).toEqual([rows[0]?.sha]);
    expect(findCommitSearchMatches(index, 'kiosk welcome copy').map((row) => row.sha)).toEqual([rows[0]?.sha]);
    expect(findCommitSearchMatches(index, 'navigation groups').map((row) => row.sha)).toEqual([rows[1]?.sha]);
  });

  it('ignores blank queries and the working-directory row', () => {
    expect(findCommitSearchMatches(index, '   ')).toEqual([]);
    expect(findCommitSearchMatches(index, 'wip')).toEqual([]);
  });
});

function commit(
  sha: string,
  subject: string,
  body?: string,
  kind: CommitGraphRow['node']['kind'] = 'commit'
): CommitGraphRow {
  return {
    sha,
    parentShas: [],
    subject,
    body,
    author: { name: 'Test Author', initials: 'TA', color: '#123456' },
    dateLabel: 'Today',
    node: { lane: 0, kind },
    rails: [],
    files: []
  };
}
