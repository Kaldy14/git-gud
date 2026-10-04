import { describe, expect, it } from 'vitest';

import type { CommitGraphPage, CommitGraphRow } from '@shared/types';

import {
  canLoadMoreCommitGraph,
  commitGraphAvatarCandidates,
  commitGraphAvatarSignature,
  initialCommitGraphLimit,
  mergeCommitGraphAvatarUrls,
  nextCommitGraphLimit
} from './commitGraphPaging';

const shaA = 'a'.repeat(40);
const shaB = 'b'.repeat(40);
const shaC = 'c'.repeat(40);

describe('commit graph paging', () => {
  it('starts cold repositories with a small page, then follows the configured page size', () => {
    expect(initialCommitGraphLimit(1500)).toBe(50);
    expect(nextCommitGraphLimit(50, 1500)).toBe(1500);
    expect(nextCommitGraphLimit(1500, 1500)).toBe(3000);
    expect(nextCommitGraphLimit(50, 250)).toBe(250);
    expect(nextCommitGraphLimit(11000, 4000)).toBe(12000);
  });

  it('honors backend hasMore and stops at the settings maximum', () => {
    expect(canLoadMoreCommitGraph(page({ limit: 50, hasMore: true }))).toBe(true);
    expect(canLoadMoreCommitGraph(page({ limit: 50, hasMore: false }))).toBe(false);
    expect(canLoadMoreCommitGraph(page({ limit: 12000, hasMore: true }))).toBe(false);
    expect(canLoadMoreCommitGraph(undefined)).toBe(false);
  });
});

describe('commit graph avatars', () => {
  it('requests one real commit per author and prioritizes commits on remote refs', () => {
    const candidates = commitGraphAvatarCandidates([
      row('wip', 'wip', 'Ada@Example.com'),
      row(shaA, 'commit', 'Ada@Example.com'),
      row(shaB, 'merge', 'ada@example.com', [{ label: 'origin/main', kind: 'remote' }]),
      row(shaC, 'commit', 'bob@example.com'),
      row('stash@{0}', 'stash', 'stash@example.com'),
      row('d'.repeat(40), 'commit', undefined)
    ]);

    expect(candidates).toEqual([
      { sha: shaB, email: 'ada@example.com', hasRemoteRef: true },
      { sha: shaC, email: 'bob@example.com', hasRemoteRef: false }
    ]);
    expect(commitGraphAvatarSignature(candidates)).toBe('ada@example.com\nbob@example.com');
  });

  it('upgrades matching authors while keeping the existing avatar as fallback', () => {
    const original = page({
      rows: [
        row(shaA, 'commit', 'Ada@Example.com', [], 'https://gravatar.example/ada'),
        row(shaB, 'commit', 'bob@example.com', [], 'https://gravatar.example/bob')
      ]
    });

    const merged = mergeCommitGraphAvatarUrls(original, { 'ada@example.com': 'https://github.example/ada' });

    expect(merged.rows[0]?.author).toMatchObject({
      avatarUrl: 'https://github.example/ada',
      fallbackAvatarUrl: 'https://gravatar.example/ada'
    });
    expect(merged.rows[1]).toBe(original.rows[1]);
    expect(merged.limit).toBe(original.limit);
    expect(mergeCommitGraphAvatarUrls(original, undefined)).toBe(original);
    expect(mergeCommitGraphAvatarUrls(merged, { 'ada@example.com': 'https://github.example/ada' })).toBe(merged);
  });
});

function page(overrides: Partial<CommitGraphPage>): CommitGraphPage {
  return {
    repoPath: '/repo',
    loadedAt: 'now',
    rows: [],
    limit: 50,
    loadedCommitCount: 50,
    hasMore: true,
    nextLimit: 1550,
    ...overrides
  };
}

function row(
  sha: string,
  kind: CommitGraphRow['node']['kind'],
  email: string | undefined,
  refs: CommitGraphRow['refs'] = [],
  avatarUrl?: string
): CommitGraphRow {
  return {
    sha,
    parentShas: [],
    subject: sha,
    author: { name: 'Author', email, initials: 'A', color: '#000000', avatarUrl },
    dateLabel: 'now',
    node: { lane: 0, kind },
    rails: [],
    refs,
    files: []
  };
}
