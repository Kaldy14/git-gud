import { describe, expect, it } from 'vitest';

import {
  loadPullRequestReviewDrafts,
  removeSubmittedDraftsFromStorage,
  retainUnsubmittedOrFailedDrafts,
  savePullRequestReviewDrafts,
  type PullRequestReviewDraft
} from './pullRequestReviewDrafts';

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => { items.delete(key); },
    setItem: (key, value) => { items.set(key, value); }
  };
}

const draft = (id: string): PullRequestReviewDraft =>
  ({ id, kind: 'file', path: 'a.ts', body: id, createdAt: '2026-01-01T00:00:00Z' });

describe('pull request review draft submission', () => {
  it('removes only successful drafts from the submitted snapshot', () => {
    const drafts = [
      { id: 'submitted-success' },
      { id: 'submitted-failure' },
      { id: 'added-while-submitting' }
    ];

    expect(
      retainUnsubmittedOrFailedDrafts(
        drafts,
        new Set(['submitted-success', 'submitted-failure']),
        new Set(['submitted-failure'])
      )
    ).toEqual([
      { id: 'submitted-failure' },
      { id: 'added-while-submitting' }
    ]);
  });
});

describe('removeSubmittedDraftsFromStorage', () => {
  it('removes posted drafts from storage even when no component state is left to update', () => {
    const storage = memoryStorage();
    savePullRequestReviewDrafts(storage, 'key', [draft('posted'), draft('failed'), draft('later')]);
    savePullRequestReviewDrafts(storage, 'other', [draft('posted')]);

    const remaining = removeSubmittedDraftsFromStorage(storage, 'key', new Set(['posted', 'failed']), new Set(['failed']));

    expect(remaining.map((entry) => entry.id)).toEqual(['failed', 'later']);
    expect(loadPullRequestReviewDrafts(storage, 'key').map((entry) => entry.id)).toEqual(['failed', 'later']);
    expect(loadPullRequestReviewDrafts(storage, 'other')).toHaveLength(1);
  });

  it('clears the key once every draft was posted', () => {
    const storage = memoryStorage();
    savePullRequestReviewDrafts(storage, 'key', [draft('posted')]);
    removeSubmittedDraftsFromStorage(storage, 'key', new Set(['posted']), new Set());
    expect(storage.getItem('key')).toBeNull();
  });
});
